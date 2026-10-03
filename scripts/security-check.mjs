#!/usr/bin/env node
// Offline security gate. Fails (exit 1) if a known-dangerous configuration or a leaked secret is found.
// Run: npm run security
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const problems = [];
const fail = m => problems.push(m);
const read = f => fs.readFile(path.join(root, f), 'utf8');

// 1. wrangler config: no DEV_OTP, sign-in required
const wr = (await read('wrangler.jsonc')).replace(/^\s*\/\/.*$/gm, '');
let cfg; try { cfg = JSON.parse(wr); } catch (e) { fail('wrangler.jsonc is not valid JSON: ' + e.message); cfg = {}; }
const vars = cfg.vars || {};
if (String(vars.DEV_OTP).toLowerCase() === 'true') fail('wrangler.jsonc sets DEV_OTP=true in plain config; keep DEV_OTP in the Cloudflare dashboard/secret instead.');
if (vars.REQUIRE_SIGNIN !== 'false') fail('wrangler.jsonc must set vars.REQUIRE_SIGNIN to "false" so the app can start a guest session on the home screen.');
for (const k of Object.keys(vars)) if (/SECRET|TOKEN|PASSWORD|API_?KEY|AUTH|SID|PRIVATE/i.test(k)) fail(`wrangler.jsonc vars.${k} looks like a secret; use "wrangler secret put ${k}" instead.`);

// 2. worker source guards
const worker = await read('src/index.js');
if (/Access-Control-Allow-Origin"\]\s*=\s*"\*"/.test(worker)) fail('Worker sets a wildcard Access-Control-Allow-Origin.');
if (!/devOtpOn/.test(worker)) fail('Worker no longer has the DEV_OTP switch (devOtpOn).');
if (!/Content-Security-Policy/.test(worker)) fail('Worker API responses lack a Content-Security-Policy header.');
if (/env\.DEV_OTP===\"true\"\)return json\(\{ok:true,devCode/.test(worker)) fail('Worker returns devCode without going through devOtpOn.');
if (!/location_update/.test(worker) || !/nearby_query/.test(worker) || !/location-ip:/.test(worker) || !/nearby-ip:/.test(worker)) fail('Location and nearby endpoints lack durable per-user/IP abuse limits.');
if (!/__Host-nc_session/.test(worker)) fail('Session cookie should use the __Host- prefix.');
if (/return json\(\{token[,}]/.test(worker)) fail('Authenticated sign-in responses must not expose the raw session token; use the HttpOnly cookie.');
if (!/__Host-nc_session/.test(worker) || !/Secure; HttpOnly; SameSite=Lax/.test(worker)) fail('Session cookie must remain Secure, HttpOnly, SameSite=Lax.');
if (!/distanceBand/.test(worker) || !/directionSector/.test(worker)) fail('Nearby responses must use coarse distance/direction privacy buckets.');
if (!/Cross-Origin-Opener-Policy/.test(worker) || !/Cross-Origin-Resource-Policy/.test(worker)) fail('Worker responses must include cross-origin isolation protections.');
if (!/equalHex/.test(worker)) fail('Security-sensitive hash comparisons must use the constant-work helper.');
if (!/DELETE FROM reports WHERE who_uid=\? OR by_uid=\?/.test(worker)) fail('Account deletion must remove reports created by and targeting the deleted account.');
if (!/DELETE FROM messages WHERE tid IN \(SELECT id FROM threads WHERE a=\? OR b=\?\)/.test(worker)) fail('Account deletion must remove all messages in the deleted account\'s threads.');
if (!/DELETE FROM ratings WHERE tid IN \(SELECT id FROM threads WHERE a=\? OR b=\?\) OR rater_uid=\? OR ratee_uid=\?/.test(worker)) fail('Account deletion must remove ratings linked to the deleted account.');
if (!/DELETE FROM otps WHERE phone=\?/.test(worker)) fail('Account deletion must remove OTP material keyed by the deleted account\'s phone.');
if (!/Set-Cookie.*clearSessionCookie|clearSessionCookie\(\)/.test(worker)) fail('Account deletion must clear the authenticated session cookie.');
if (/LIMIT 200.*threads|SELECT id FROM threads WHERE a=\? OR b=\?.*LIMIT 200/.test(worker)) fail('Account deletion must not cap thread cleanup at 200 rows.');
if (/items\.push\(\{[^}]*\bkm:|items\.push\(\{[^}]*\bbrg:/.test(worker)) fail('Nearby response must not expose precise km/brg fields.');

// 3. static headers
const headers = await read('public/_headers').catch(() => '');
if (!/Content-Security-Policy:/.test(headers)) fail('public/_headers is missing or has no Content-Security-Policy.');
for (const d of ["object-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "Cross-Origin-Opener-Policy: same-origin", "Cross-Origin-Resource-Policy: same-origin"]) if (!headers.includes(d)) fail(`CSP is missing ${d}.`);

const sw = await read('public/sw.js');
if (!/near-cash-v22/.test(sw)) fail('Service worker cache must be version-bumped for the guest-home release.');

// 4. git hygiene
const gi = await read('.gitignore').catch(() => '');
for (const need of ['.dev.vars', '.env', 'node_modules']) if (!gi.includes(need)) fail(`.gitignore must ignore ${need}.`);

// 5. secret scan across text files
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler']);
const TEXT = /\.(js|mjs|cjs|json|jsonc|html|css|md|txt|yml|yaml|toml|sql|webmanifest|svg|vars|example)$|^\.[a-z.]+$|^_headers$/i;
const PATTERNS = [
  ['Twilio Account SID', /\bAC[0-9a-f]{32}\b/],
  ['Twilio API key SID', /\bSK[0-9a-f]{32}\b/],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Stripe live key', /\b[sr]k_live_[0-9A-Za-z]{16,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['GitHub token', /\bgh[pousr]_[0-9A-Za-z]{36,}\b/],
  ['Slack token', /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/],
  ['Hard-coded bearer token', /Bearer\s+[A-Za-z0-9._-]{32,}/],
  ['Secret assignment', /\b(?:TWILIO_AUTH_TOKEN|ADMIN_ANALYTICS_KEY|ADMIN_KEY|SMS_WEBHOOK_TOKEN)\s*[:=]\s*["'][^"']{8,}["']/],
];
async function* walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full); else yield full;
  }
}
const SELF = path.join(root, 'scripts/security-check.mjs');
for await (const file of walk(root)) {
  if (file === SELF || !TEXT.test(path.basename(file))) continue;
  const rel = path.relative(root, file);
  if (/^\.dev\.vars$/.test(rel)) { fail('.dev.vars must not be shipped/committed.'); continue; }
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  for (const [name, re] of PATTERNS) if (re.test(text)) fail(`Possible ${name} in ${rel}`);
}

if (problems.length) {
  console.error('\nSECURITY CHECK FAILED:\n' + problems.map(p => ' - ' + p).join('\n') + '\n');
  process.exit(1);
}
console.log('security-check: all checks passed');
