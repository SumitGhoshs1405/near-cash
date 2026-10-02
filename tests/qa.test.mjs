import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const worker = await fs.readFile(path.join(root, 'src/index.js'), 'utf8');
const app = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
const live = await fs.readFile(path.join(root, 'public/live.js'), 'utf8');
const sw = await fs.readFile(path.join(root, 'public/sw.js'), 'utf8');
const schema = await fs.readFile(path.join(root, 'schema.sql'), 'utf8');

const has = (s, pattern) => assert.match(s, pattern);
const read = async file => fs.readFile(path.join(root, file), 'utf8');

 test('no URL token authentication regression', () => {
  assert.doesNotMatch(worker, /searchParams\.get\(['"]token['"]\)/);
  assert.doesNotMatch(app, /\/api\/stream\?token=/);
  assert.doesNotMatch(live, /\/api\/stream\?token=/);
});

test('Bearer authentication remains required', () => {
  has(worker, /Authorization/);
  has(worker, /Bearer\\s\+\[\^\\s\]\+/);
});

test('security headers remain present', () => {
  for (const header of [
    'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy',
    'Permissions-Policy', 'Strict-Transport-Security', 'Cache-Control'
  ]) has(worker, new RegExp(header));
});

test('request size and rate limiting protections remain present', () => {
  has(worker, /Request too large/);
  has(worker, /const rateLimit=/);
  has(worker, /userActionLimit/);
});

test('trust and safety tables exist', () => {
  for (const table of ['abuse_limits', 'reports', 'blocks']) {
    has(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
});

test('critical marketplace operations use abuse limits', () => {
  has(worker, /"listing_create"/);
  has(worker, /"connect"/);
  has(worker, /"message"/);
  has(worker, /"pin_generate"/);
  has(worker, /"report"/);
  has(worker, /"block"/);
});

test('match claiming is conditional and race-safe', () => {
  has(worker, /UPDATE listings SET status='matched' WHERE id=\? AND status='open'/);
  has(worker, /changes\|\|0\)!==1/);
});

test('meetup PIN is hashed and expires', () => {
  has(worker, /sha\(code\+t\.id\)/);
  has(worker, /pin_exp/);
  has(worker, /pin_tries/);
});

test('service worker has a versioned cache', () => {
  has(sw, /const C=['"]near-cash-/);
});

test('frontend contains no obvious secret material', () => {
  for (const source of [app, live, sw]) {
    assert.doesNotMatch(source, /TWILIO_AUTH_TOKEN|ADMIN_KEY|SMS_WEBHOOK_TOKEN/);
  }
});


test('production observability remains present', () => {
  has(worker, /observability_events/);
  has(worker, /\/api\/admin\/observability/);
  has(worker, /recordObs/);
  has(worker, /kind:"server_error"/);
});

test('product analytics remains privacy-minimized', () => {
  has(worker, /analytics_events/);
  has(worker, /p==="analytics"/);
  has(worker, /const allowed=new Set/);
  has(worker, /clientId/);
});

test('location privacy and disaster-recovery controls remain present', async () => {
  const worker=await read('src/index.js');
  const wrangler=await read('wrangler.jsonc');
  const backup=await read('scripts/backup-d1.mjs');
  const restore=await read('scripts/restore-d1.mjs');
  const recovery=await read('docs/internal/08-business-continuity-and-recovery.md');
  assert.match(worker,/LOCATION_TTL_MS=30\*60\*1000/);
  assert.match(worker,/UPDATE users SET lat=NULL,lng=NULL,at=NULL WHERE at IS NOT NULL/);
  assert.match(worker,/u\.at>=\?/);
  assert.match(wrangler,/\"crons\"\s*:\s*\[\"\*\/15 \* \* \* \*\"\]/);
  assert.match(backup,/aes-256-gcm/i);
  assert.match(backup,/sha256/i);
  assert.match(backup,/r2.*object.*put/i);
  assert.match(restore,/aes-256-gcm/i);
  assert.match(restore,/wrangler.*d1.*execute/i);
  assert.match(recovery,/Backup retention is 30 days/);
  assert.match(recovery,/Target RPO/);
});

test('privacy and account-data controls remain present', () => {
  has(worker, /p==="privacy\/export"/);
  has(worker, /p==="privacy\/location\/delete"/);
  has(worker, /p==="privacy\/delete"/);
  has(worker, /Type DELETE to permanently remove your Near Cash account/);
  has(worker, /DELETE FROM messages WHERE tid IN \(SELECT id FROM threads WHERE a=\? OR b=\?\)/);
  has(worker, /DELETE FROM ratings WHERE tid IN \(SELECT id FROM threads WHERE a=\? OR b=\?\) OR rater_uid=\? OR ratee_uid=\?/);
  has(worker, /DELETE FROM otps WHERE phone=\?/);
  has(worker, /clearSessionCookie\(\)/);
  has(live, /function deleteAccount\(\)/);
  has(live, /Type DELETE to permanently remove your account and all associated data/);
  has(live, /localStorage\.removeItem\(k\)/);
  has(live, /Delete account &amp; all data/);
});

test('account deletion is visually destructive and placed after logout', async () => {
  const css=await read('public/styles.css');
  has(live, /class=\"secondary full\"[^>]*onclick=\"logout\(\)\"/);
  has(live, /class=\"danger full\"[^>]*onclick=\"deleteAccount\(\)\"/);
  has(css, /\.danger\{background:#dc2626;color:#fff/);
});

test('PWA offline/update assets exist', async () => {
  const offline = await fs.readFile(path.join(root, 'public/offline.html'), 'utf8');
  const manifest = await fs.readFile(path.join(root, 'public/manifest.webmanifest'), 'utf8');
  has(offline, /offline/i);
  has(manifest, /name/);
  has(sw, /skipWaiting|clientsClaim/);
});

test('launch-readiness files exist', async () => {
  for (const file of ['privacy.html', 'terms.html', 'security.html', 'robots.txt']) {
    const value = await fs.readFile(path.join(root, 'public', file), 'utf8');
    assert.ok(value.length > 20, `${file} should not be empty`);
  }
});

test('schema includes consolidated analytics and observability tables', () => {
  has(schema, /CREATE TABLE IF NOT EXISTS analytics_events/);
  has(schema, /CREATE TABLE IF NOT EXISTS observability_events/);
});


test('homepage uses canonical root URL', () => {
  has(worker, /url\.pathname==="\/index\.html"/);
  has(worker, /Response\.redirect\(new URL\("\/",url\),301\)/);
});

test('web app manifest starts at canonical root', async () => {
  const manifest = await fs.readFile(path.join(root, 'public/manifest.webmanifest'), 'utf8');
  assert.match(manifest, /"start_url":\s*"\.\/"/);
  assert.doesNotMatch(manifest, /"start_url":\s*"[^"]*index\.html"/);
});

test('public legal documentation pack is complete and linked', async () => {
  const publicDocs = [
    'legal.html','privacy.html','terms.html','acceptable-use.html','safety-policy.html',
    'community-guidelines.html','report-abuse.html','grievance.html','cookies.html',
    'data-deletion.html','ip-policy.html','security.html'
  ];
  for (const file of publicDocs) {
    const value = await fs.readFile(path.join(root, 'public', file), 'utf8');
    assert.ok(value.length > 500, `${file} should contain substantive policy text`);
  }
  has(app, /legal\.html/);
  has(app, /privacy\.html/);
  has(app, /acceptable-use\.html/);
  has(app, /grievance\.html/);
  has(app, /security\.html/);
});

test('internal compliance controls are present', async () => {
  const files = [
    '00-COMPLIANCE-READ-ME.md','01-data-inventory-and-record-of-processing.md',
    '02-data-retention-schedule.md','03-incident-response-plan.md','04-abuse-and-moderation-sop.md',
    '05-lawful-requests-procedure.md','06-admin-access-control-policy.md',
    '07-vendor-and-processor-due-diligence.md','08-business-continuity-and-recovery.md',
    '09-legal-compliance-matrix.md','10-launch-gate-checklist.md','11-policy-change-log.md'
  ];
  for (const file of files) {
    const value = await fs.readFile(path.join(root, 'docs', 'internal', file), 'utf8');
    assert.ok(value.length > 200, `${file} should contain substantive controls`);
  }
});


test('legal pages have valid structure, working internal links and no stray characters', async () => {
  const dir = path.join(root, 'public');
  const pages = ['legal.html','privacy.html','terms.html','acceptable-use.html','safety-policy.html',
    'community-guidelines.html','report-abuse.html','grievance.html','cookies.html',
    'data-deletion.html','ip-policy.html','security.html'];
  const voids = new Set(['meta','link','br','img','hr','input']);
  for (const file of pages) {
    const html = await fs.readFile(path.join(dir, file), 'utf8');
    assert.match(html, /^<!doctype html>/i, `${file} doctype`);
    assert.equal((html.match(/<h1>/g) || []).length, 1, `${file} has exactly one h1`);
    assert.doesNotMatch(html, /&(?!amp;|lt;|gt;|quot;|#\d+;)/, `${file} has an unescaped ampersand`);
    const stack = [];
    for (const m of html.matchAll(/<(\/?)([a-z0-9]+)[^>]*>/gi)) {
      const [, close, tag] = m; const t = tag.toLowerCase();
      if (voids.has(t)) continue;
      if (close) assert.equal(stack.pop(), t, `${file}: unbalanced </${t}>`);
      else stack.push(t);
    }
    assert.deepEqual(stack, [], `${file}: unclosed tags`);
    for (const m of html.matchAll(/href="([^"#:]+)"/g)) {
      await fs.access(path.join(dir, m[1])).catch(() => assert.fail(`${file}: broken link ${m[1]}`));
    }
    assert.match(html, /nearcash\.info@gmail\.com/, `${file} shows the contact address`);
    assert.match(html, /28 September 2026/, `${file} shows the effective date`);
  }
});

test('security.txt meets RFC 9116 (Contact and Expires present)', async () => {
  const txt = await fs.readFile(path.join(root, 'public/.well-known/security.txt'), 'utf8');
  has(txt, /^Contact: mailto:nearcash\.info@gmail\.com$/m);
  has(txt, /^Expires: \d{4}-\d{2}-\d{2}T/m);
});
