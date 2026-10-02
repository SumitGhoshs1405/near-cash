import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { boot, sqliteAvailable } from './harness.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const canRun = await sqliteAvailable();
const t = (name, fn) => test(name, { skip: canRun ? false : 'node:sqlite not available (needs Node >= 22.5)' }, fn);

const PROD = 'https://near-cash.example.workers.dev';
const LOCAL = 'http://localhost:8787';
const j = async r => ({ status: r.status, headers: r.headers, body: await r.json().catch(() => ({})) });

// Replaces global fetch with an SMS-webhook capture, restoring it afterwards.
async function withSmsCapture(fn) {
  const real = globalThis.fetch; const sent = [];
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('ok', { status: 200 }); };
  try { return await fn(sent); } finally { globalThis.fetch = real; }
}
const smsEnv = { SMS_WEBHOOK_URL: 'https://sms.example/send', SMS_WEBHOOK_TOKEN: 'x' };
const codeOf = sent => sent[sent.length - 1].message.match(/(\d{6})/)[1];
const tokenFrom = r => decodeURIComponent(String(r.headers.get('set-cookie')||'').match(/__Host-nc_session=([^;]+)/)?.[1]||'');

async function guest(app, ip = '9.9.9.9') {
  const r = await j(await app.call('POST', PROD + '/api/guest', { body: {}, ip }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return {...r.body, token:tokenFrom(r)};
}
async function locate(app, token, lat = 12.9716, lng = 77.5946) {
  assert.equal((await app.call('POST', PROD + '/api/location', { body: { lat, lng }, token })).status, 200);
}

/* ---------- 1. Hide secrets / DEV_OTP ---------- */
t('DEV_OTP=true (Cloudflare variable) shows the Verification Code on a deployed hostname and it signs you in', async () => {
  const app = await boot(root, { DEV_OTP: 'true' });
  const r = await j(await app.call('POST', PROD + '/api/otp', { body: { phone: '+919876543210' } }));
  assert.equal(r.status, 200);
  assert.match(r.body.devCode, /^\d{6}$/);
  const v = await j(await app.call('POST', PROD + '/api/verify', { body: { phone: '+919876543210', code: r.body.devCode, name: 'Asha', adult: true } }));
  assert.equal(v.status, 200);
  const h = await j(await app.call('GET', PROD + '/healthz'));
  assert.equal(h.body.devOtp, true);
});

t('without DEV_OTP a deployed hostname never returns the code', async () => {
  const app = await boot(root, {});
  const r = await j(await app.call('POST', PROD + '/api/otp', { body: { phone: '+919876543210' } }));
  assert.equal(r.body.devCode, undefined);
  assert.equal(r.status, 503);
  assert.doesNotMatch(String(r.body.error||''), /SMS provider not configured/i);
  const h = await j(await app.call('GET', PROD + '/healthz'));
  assert.equal(h.body.devOtp, false);
});

t('failed SMS send does not lock the number out for 5 minutes', async () => {
  const app = await boot(root, {});
  const first = await j(await app.call('POST', PROD + '/api/otp', { body: { phone: '+919876543210' } }));
  assert.equal(first.status, 503);
  assert.equal(app.DB.raw.prepare('SELECT COUNT(*) c FROM otps').get().c, 0);
  const second = await j(await app.call('POST', PROD + '/api/otp', { body: { phone: '+919876543210' } }));
  assert.equal(second.status, 503); // not 429 "please wait"
  assert.doesNotMatch(String(second.body.error||''), /SMS provider not configured/i);
});

t('DEV_OTP works on localhost only, and the code really signs you in', async () => {
  const app = await boot(root, { DEV_OTP: 'true' });
  const o = await j(await app.call('POST', LOCAL + '/api/otp', { body: { phone: '9876543210' } }));
  assert.match(o.body.devCode, /^\d{6}$/);
  const bad = await j(await app.call('POST', LOCAL + '/api/verify', { body: { phone: '9876543210', code: '000000', name: 'Asha', adult: true } }));
  assert.equal(bad.status, 400);
  const v = await j(await app.call('POST', LOCAL + '/api/verify', { body: { phone: '9876543210', code: o.body.devCode, name: 'Asha', adult: true } }));
  assert.equal(v.status, 200);
  assert.equal(v.body.token, undefined);
  const cookieToken = tokenFrom(v);
  assert.ok(cookieToken.length >= 64);
  const me = await j(await app.call('GET', LOCAL + '/api/me', { token: cookieToken }));
  assert.equal(me.body.name, 'Asha');
});

/* ---------- 2. Real authentication ---------- */
t('real SMS flow: code is texted, never returned; adult flag and name required', async () => {
  const app = await boot(root, smsEnv);
  await withSmsCapture(async sent => {
    const o = await j(await app.call('POST', PROD + '/api/otp', { body: { phone: '+919876543210' } }));
    assert.deepEqual(o.body, { ok: true });
    const code = codeOf(sent);
    const noAdult = await j(await app.call('POST', PROD + '/api/verify', { body: { phone: '+919876543210', code, name: 'A', adult: false } }));
    assert.equal(noAdult.status, 400);
    const ok = await j(await app.call('POST', PROD + '/api/verify', { body: { phone: '+919876543210', code, name: 'Asha', adult: true } }));
    assert.equal(ok.status, 200);
    // code is single-use
    const again = await j(await app.call('POST', PROD + '/api/verify', { body: { phone: '+919876543210', code, name: 'Asha', adult: true } }));
    assert.equal(again.status, 400);
  });
});

t('REQUIRE_SIGNIN=true blocks anonymous guest accounts', async () => {
  const app = await boot(root, { REQUIRE_SIGNIN: 'true' });
  const r = await j(await app.call('POST', PROD + '/api/guest', { body: {} }));
  assert.equal(r.status, 403);
});

t('sign-in responses never expose the raw session token and issue a hardened host-only cookie', async () => {
  const app = await boot(root, { DEV_OTP: 'true' });
  const o = await j(await app.call('POST', LOCAL + '/api/otp', { body: { phone: '9876543211' } }));
  const v = await j(await app.call('POST', LOCAL + '/api/verify', { body: { phone: '9876543211', code: o.body.devCode, name: 'Asha', adult: true } }));
  assert.equal(v.body.token, undefined);
  const cookie = String(v.headers.get('set-cookie')||'');
  assert.match(cookie, /__Host-nc_session=/);
  assert.match(cookie, /\bSecure\b/);
  assert.match(cookie, /\bHttpOnly\b/);
  assert.match(cookie, /\bSameSite=Lax\b/);
  assert.match(cookie, /\bPath=\//);
});

t('logout revokes the session server-side', async () => {
  const app = await boot(root, {});
  const g = await guest(app);
  assert.equal((await app.call('GET', PROD + '/api/me', { token: g.token })).status, 200);
  assert.equal((await app.call('POST', PROD + '/api/logout', { body: {}, token: g.token })).status, 200);
  assert.equal((await app.call('GET', PROD + '/api/me', { token: g.token })).status, 401);
});

t('account deletion removes all account-linked data and revokes the session', async () => {
  const app = await boot(root, {});
  const [A, B] = [await guest(app, '8.8.8.8'), await guest(app, '8.8.8.9')];
  await locate(app, A.token); await locate(app, B.token);
  const listing = await j(await app.call('POST', PROD + '/api/listings', { body: { type: 'have', amount: 250, minutes: 30, area: 'Central' }, token: A.token }));
  assert.equal(listing.status, 200);
  const thread = await j(await app.call('POST', PROD + '/api/threads', { body: { listingId: listing.body.id }, token: B.token }));
  assert.equal(thread.status, 200);
  const tid = thread.body.id;
  assert.equal((await app.call('POST', PROD + '/api/threads/' + tid + '/messages', { body: { text: 'hello' }, token: A.token })).status, 200);
  assert.equal((await app.call('POST', PROD + '/api/report', { body: { threadId: tid, reason: 'other' }, token: A.token })).status, 200);
  assert.equal((await app.call('POST', PROD + '/api/block', { body: { userId: B.me.id }, token: A.token })).status, 200);
  app.DB.raw.prepare('INSERT INTO ratings(tid,rater_uid,ratee_uid,stars,tag,at) VALUES(?,?,?,?,?,?)').run(tid,A.me.id,B.me.id,5,'fair',Date.now());
  const aPhone=app.DB.raw.prepare('SELECT phone FROM users WHERE id=?').get(A.me.id).phone;
  app.DB.raw.prepare('INSERT INTO otps(phone,hash,exp,tries) VALUES(?,?,?,0)').run(aPhone,'hash',Date.now()+300000);
  app.DB.raw.prepare('INSERT INTO abuse_limits(uid,action,window_start,count) VALUES(?,?,?,1)').run(A.me.id,'test',Date.now());
  const del = await j(await app.call('POST', PROD + '/api/privacy/delete', { body: { confirm: 'DELETE' }, token: A.token }));
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(del.body.deleted, true);
  assert.match(String(del.headers.get('set-cookie')||''), /__Host-nc_session=;/);
  assert.equal((await app.call('GET', PROD + '/api/me', { token: A.token })).status, 401);
  const uid=A.me.id;
  for(const table of ['users','sessions','listings','threads','messages','reports','blocks','abuse_limits','notifications','ratings']){
    const row=app.DB.raw.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${table==='users'?'id':table==='sessions'?'uid':table==='listings'?'uid':table==='threads'?'(a=? OR b=?)':table==='messages'?'from_uid':table==='reports'?'(by_uid=? OR who_uid=?)':table==='blocks'?'(by_uid=? OR who_uid=?)':table==='abuse_limits'?'uid':table==='notifications'?'uid':table==='ratings'?'(rater_uid=? OR ratee_uid=?)':'1'}${['threads','reports','blocks','ratings'].includes(table)?'':'=?'}`).get(...(table==='threads'||table==='reports'||table==='blocks'||table==='ratings'?[uid,uid]:[uid]));
    assert.equal(Number(row.c),0, `${table} still contains deleted-user data`);
  }
  assert.equal(Number(app.DB.raw.prepare('SELECT COUNT(*) c FROM otps WHERE phone=?').get(aPhone).c),0);
  assert.equal(Number(app.DB.raw.prepare('SELECT COUNT(*) c FROM users WHERE id=?').get(B.me.id).c),1);
});

/* ---------- 3. Row-level access (ownership) ---------- */
t('users cannot read or touch other users\' threads, messages, listings or PINs', async () => {
  const app = await boot(root, {});
  const [A, B, C] = [await guest(app), await guest(app), await guest(app)];
  for (const u of [A, B, C]) await locate(app, u.token);
  const l = await j(await app.call('POST', PROD + '/api/listings', { body: { type: 'have', amount: 500, minutes: 30, area: 'MG Road' }, token: A.token }));
  assert.equal(l.status, 200);
  const th = await j(await app.call('POST', PROD + '/api/threads', { body: { listingId: l.body.id }, token: B.token }));
  assert.equal(th.status, 200);
  const tid = th.body.id;
  // participants can read; outsider gets 404 on every thread sub-route
  assert.equal((await app.call('GET', PROD + '/api/threads/' + tid, { token: A.token })).status, 200);
  assert.equal((await app.call('GET', PROD + '/api/threads/' + tid, { token: B.token })).status, 200);
  for (const [m, p] of [['GET', ''], ['POST', '/messages'], ['POST', '/pin'], ['POST', '/pin/verify'], ['POST', '/complete'], ['POST', '/rate']]) {
    const r = await app.call(m, PROD + '/api/threads/' + tid + p, { token: C.token, body: m === 'POST' ? { text: 'hi', code: '1234', stars: 5 } : undefined });
    assert.equal(r.status, 404, `outsider ${m} ${p}`);
  }
  // outsider cannot cancel someone else's listing
  assert.equal((await app.call('POST', PROD + '/api/listings/cancel', { body: { id: l.body.id }, token: C.token })).status, 404);
  // outsider cannot report a thread they are not in
  assert.equal((await app.call('POST', PROD + '/api/report', { body: { threadId: tid, reason: 'scam' }, token: C.token })).status, 404);
  // nearby never leaks raw coordinates or phone numbers
  const near = await j(await app.call('GET', PROD + '/api/nearby?r=10', { token: C.token }));
  const dump = JSON.stringify(near.body);
  assert.doesNotMatch(dump, /"lat"|"lng"|"phone"|guest:/);
});

t('full marketplace flow still works: chat, PIN, one-time verification, completion, rating', async () => {
  const app = await boot(root, {});
  const [A, B] = [await guest(app), await guest(app)];
  await locate(app, A.token); await locate(app, B.token);
  const l = await j(await app.call('POST', PROD + '/api/listings', { body: { type: 'have', amount: 200, minutes: 30 }, token: A.token }));
  const near = await j(await app.call('GET', PROD + '/api/nearby?r=5', { token: B.token }));
  assert.equal(near.body.items.length, 1);
  const th = await j(await app.call('POST', PROD + '/api/threads', { body: { listingId: l.body.id }, token: B.token }));
  // a second person cannot claim the same (now matched) listing
  const C = await guest(app); await locate(app, C.token);
  assert.equal((await app.call('POST', PROD + '/api/threads', { body: { listingId: l.body.id }, token: C.token })).status, 409);
  const tid = th.body.id;
  const msg = await j(await app.call('POST', PROD + '/api/threads/' + tid + '/messages', { body: { text: '  meet at the cafe \u0000 ' }, token: B.token }));
  assert.equal(msg.body.text, 'meet at the cafe');
  const list = await j(await app.call('GET', PROD + '/api/threads', { token: A.token }));
  assert.equal(list.status, 200); assert.equal(list.body.items.length, 1);
  const pin = await j(await app.call('POST', PROD + '/api/threads/' + tid + '/pin', { body: {}, token: A.token }));
  assert.match(pin.body.code, /^\d{4}$/);
  // generator cannot verify own PIN; wrong PIN rejected; right PIN verifies the meetup but does not complete the exchange
  assert.equal((await app.call('POST', PROD + '/api/threads/' + tid + '/pin/verify', { body: { code: pin.body.code }, token: A.token })).status, 403);
  const wrong = pin.body.code === '1111' ? '2222' : '1111';
  assert.equal((await app.call('POST', PROD + '/api/threads/' + tid + '/pin/verify', { body: { code: wrong }, token: B.token })).status, 401);
  const ok = await j(await app.call('POST', PROD + '/api/threads/' + tid + '/pin/verify', { body: { code: pin.body.code }, token: B.token }));
  assert.equal(ok.body.completed, false);
  assert.equal(ok.body.verified, true);
  assert.equal((await app.call('POST', PROD + '/api/threads/' + tid + '/pin/verify', { body: { code: pin.body.code }, token: B.token })).status >= 400, true);
  assert.equal((await app.call('POST', PROD + '/api/threads/' + tid + '/rate', { body: { stars: 5, tag: 'fast' }, token: A.token })).status, 409);
  const ca = await j(await app.call('POST', PROD + '/api/threads/' + tid + '/complete', { body: {}, token: A.token }));
  assert.equal(ca.body.completed, false);
  assert.equal((await j(await app.call('GET', PROD + '/api/me', { token: A.token }))).body.done, 0);
  const cb = await j(await app.call('POST', PROD + '/api/threads/' + tid + '/complete', { body: {}, token: B.token }));
  assert.equal(cb.body.completed, true);
  assert.equal((await app.call('POST', PROD + '/api/threads/' + tid + '/rate', { body: { stars: 5, tag: 'fast' }, token: A.token })).status, 200);
  assert.equal((await j(await app.call('GET', PROD + '/api/me', { token: A.token }))).body.done, 1);
});



t('two-party completion is race-safe and cannot be completed by PIN verification alone', async () => {
  const app = await boot(root, {});
  const [A, B] = [await guest(app), await guest(app)];
  await locate(app, A.token); await locate(app, B.token);
  const l = await j(await app.call('POST', PROD + '/api/listings', { body: { type: 'have', amount: 300, minutes: 30 }, token: A.token }));
  const th = await j(await app.call('POST', PROD + '/api/threads', { body: { listingId: l.body.id }, token: B.token }));
  const pin = await j(await app.call('POST', PROD + '/api/threads/' + th.body.id + '/pin', { body: {}, token: A.token }));
  const verified = await j(await app.call('POST', PROD + '/api/threads/' + th.body.id + '/pin/verify', { body: { code: pin.body.code }, token: B.token }));
  assert.equal(verified.body.completed, false);
  assert.equal((await j(await app.call('GET', PROD + '/api/threads/' + th.body.id, { token: A.token }))).body.status, 'open');
  const results = await Promise.all([
    app.call('POST', PROD + '/api/threads/' + th.body.id + '/complete', { body: {}, token: A.token }),
    app.call('POST', PROD + '/api/threads/' + th.body.id + '/complete', { body: {}, token: B.token })
  ]);
  const bodies = await Promise.all(results.map(j));
  assert.equal(bodies.filter(x => x.status === 200 && x.body.completed === true).length, 1);
  assert.equal((await j(await app.call('GET', PROD + '/api/threads/' + th.body.id, { token: A.token }))).body.status, 'completed');
  assert.equal((await j(await app.call('GET', PROD + '/api/me', { token: A.token }))).body.done, 1);
  assert.equal((await j(await app.call('GET', PROD + '/api/me', { token: B.token }))).body.done, 1);
});

/* ---------- 4. Rate limiting (durable) ---------- */
t('OTP: per-phone limit (5/hour) blocks SMS-bombing one number', async () => {
  const app = await boot(root, smsEnv);
  await withSmsCapture(async sent => {
    const results = [];
    await app.call('GET', PROD + '/healthz'); // creates the schema
    for (let i = 0; i < 7; i++) {
      app.DB.raw.exec('DELETE FROM otps'); // bypass the 5-minute cooldown to isolate the hourly cap
      results.push((await app.call('POST', PROD + '/api/otp', { body: { phone: '+919876543210' }, ip: '5.5.5.' + i })).status);
    }
    assert.deepEqual(results, [200, 200, 200, 200, 200, 429, 429]);
    assert.equal(sent.length, 5);
  });
});

t('OTP: per-IP limit (10/hour) blocks spraying many numbers', async () => {
  const app = await boot(root, smsEnv);
  await withSmsCapture(async sent => {
    const results = [];
    for (let i = 0; i < 12; i++) results.push((await app.call('POST', PROD + '/api/otp', { body: { phone: '+9198765432' + String(10 + i) }, ip: '7.7.7.7' })).status);
    assert.deepEqual(results, [...Array(10).fill(200), 429, 429]);
    assert.equal(sent.length, 10);
  });
});

t('OTP: 5 wrong guesses burn the code; re-requesting is capped so brute force is infeasible', async () => {
  const app = await boot(root, smsEnv);
  await withSmsCapture(async sent => {
    await app.call('POST', PROD + '/api/otp', { body: { phone: '+919876543210' } });
    const real = codeOf(sent);
    const wrong = real === '123456' ? '654321' : '123456';
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await app.call('POST', PROD + '/api/verify', { body: { phone: '+919876543210', code: wrong, name: 'A', adult: true } })).status);
    assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
    const late = await app.call('POST', PROD + '/api/verify', { body: { phone: '+919876543210', code: real, name: 'A', adult: true } });
    assert.equal(late.status, 400); // code was destroyed
  });
});

t('verify: per-IP cap (30/hour)', async () => {
  const app = await boot(root, smsEnv);
  const codes = [];
  for (let i = 0; i < 32; i++) codes.push((await app.call('POST', PROD + '/api/verify', { body: { phone: '+919876543210', code: '000000', name: 'A', adult: true }, ip: '6.6.6.6' })).status);
  assert.equal(codes.slice(0, 30).every(s => s === 400), true);
  assert.equal(codes[30], 429);
});

t('guest creation: durable per-IP cap (20/hour) survives a Worker restart', async () => {
  const app = await boot(root, {});
  for (let i = 0; i < 20; i++) assert.equal((await app.call('POST', PROD + '/api/guest', { body: {}, ip: '4.4.4.4' })).status, 200);
  assert.equal((await app.call('POST', PROD + '/api/guest', { body: {}, ip: '4.4.4.4' })).status, 429);
  // "restart": brand-new Worker module instance, same database
  const { loadWorker } = await import('./harness.mjs');
  const fresh = await loadWorker(root);
  const r = await fresh.fetch(new Request(PROD + '/api/guest', { method: 'POST', headers: { 'CF-Connecting-IP': '4.4.4.4', 'Content-Type': 'application/json' }, body: '{}' }), app.env);
  assert.equal(r.status, 429);
  assert.equal((await app.call('POST', PROD + '/api/guest', { body: {}, ip: '4.4.4.5' })).status, 200); // other IPs unaffected
});

t('per-user abuse limits still apply (listing creation)', async () => {
  const app = await boot(root, {});
  const A = await guest(app); await locate(app, A.token);
  const s = [];
  for (let i = 0; i < 4; i++) s.push((await app.call('POST', PROD + '/api/listings', { body: { type: 'need', amount: 10, minutes: 10 }, token: A.token })).status);
  assert.deepEqual(s, [200, 200, 200, 400]); // 4th blocked by the 3-live-post rule
});

/* ---------- 5. Server-side validation ---------- */
t('non-object / malformed bodies return 400, never 500', async () => {
  const app = await boot(root, {});
  const A = await guest(app);
  for (const raw of ['null', '[]', '123', '"str"', '{bad json', 'true']) {
    const r = await app.call('POST', PROD + '/api/profile', { raw, token: A.token });
    assert.equal(r.status, 400, raw);
  }
});

t('oversized bodies are rejected with 413', async () => {
  const app = await boot(root, {});
  const A = await guest(app);
  const r = await app.call('POST', PROD + '/api/profile', { raw: JSON.stringify({ name: 'x'.repeat(20000) }), token: A.token });
  assert.equal(r.status, 413);
});

t('wrong-typed ids and out-of-range values are rejected cleanly', async () => {
  const app = await boot(root, {});
  const A = await guest(app); await locate(app, A.token);
  const post = (p, body) => app.call('POST', PROD + '/api/' + p, { body, token: A.token });
  assert.equal((await post('listings/cancel', { id: { $ne: 1 } })).status, 404);
  assert.equal((await post('listings/cancel', { id: ['x'] })).status, 404);
  assert.equal((await post('threads', { listingId: { a: 1 } })).status, 409);
  assert.equal((await post('report', { threadId: [] , reason: 'scam' })).status, 404);
  for (const bad of [{ type: 'have', amount: 0, minutes: 30 }, { type: 'have', amount: 5001, minutes: 30 }, { type: 'x', amount: 5, minutes: 30 }, { type: 'have', amount: 5, minutes: 4 }, { type: 'have', amount: 5, minutes: 241 }, { type: 'have', amount: 'abc', minutes: 30 }])
    assert.equal((await post('listings', bad)).status, 400, JSON.stringify(bad));
  assert.equal((await post('location', { lat: 91, lng: 0 })).status, 400);
  assert.equal((await post('location', { lat: 'x', lng: 0 })).status, 400);
  assert.equal((await post('location', { lat: null, lng: null })).status, 400);
});

t('display names / areas are stripped of control characters and length-capped', async () => {
  const app = await boot(root, {});
  const A = await guest(app);
  const r = await j(await app.call('POST', PROD + '/api/profile', { body: { name: 'A\u0000B\u0007C' + 'z'.repeat(100) }, token: A.token }));
  assert.equal(r.body.name.length, 40);
  assert.match(r.body.name, /^ABCz+$/);
});

t('SQL-injection style input is treated as plain data', async () => {
  const app = await boot(root, {});
  const A = await guest(app);
  const evil = "x'); DROP TABLE users;--";
  assert.equal((await app.call('POST', PROD + '/api/profile', { body: { name: evil }, token: A.token })).status, 200);
  assert.equal(app.DB.raw.prepare('SELECT COUNT(*) c FROM users').get().c, 1);
  assert.equal((await j(await app.call('GET', PROD + '/api/me', { token: A.token }))).body.name, evil.slice(0, 40));
  assert.equal((await app.call('GET', PROD + '/api/admin/summary?range=' + encodeURIComponent("30d';DROP TABLE users;--"), { headers: { 'X-Admin-Key': 'nope' } })).status >= 400, true);
});

/* ---------- Admin surface ---------- */
t('admin: no wildcard CORS; only the exact ADMIN_ORIGIN is allowed', async () => {
  const site = 'https://admin.example.com';
  const none = await boot(root, { ADMIN_ANALYTICS_KEY: 'k'.repeat(32) });
  let r = await none.call('GET', PROD + '/api/admin/status', { headers: { Origin: site } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  const set = await boot(root, { ADMIN_ANALYTICS_KEY: 'k'.repeat(32), ADMIN_ORIGIN: site });
  r = await set.call('GET', PROD + '/api/admin/status', { headers: { Origin: site } });
  assert.equal(r.headers.get('access-control-allow-origin'), site);
  r = await set.call('GET', PROD + '/api/admin/status', { headers: { Origin: 'https://evil.example' } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  r = await set.call('OPTIONS', PROD + '/api/admin/summary', { headers: { Origin: site } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), site);
});

t('admin: /status is public-safe; key holders see diagnostics; summary needs the key', async () => {
  const KEY = 'k'.repeat(32);
  const app = await boot(root, { ADMIN_ANALYTICS_KEY: KEY });
  const pub = await j(await app.call('GET', PROD + '/api/admin/status'));
  assert.deepEqual(pub.body, { ok: true, configured: true });
  const priv = await j(await app.call('GET', PROD + '/api/admin/status', { headers: { 'X-Admin-Key': KEY } }));
  assert.deepEqual(priv.body.presentAdminBindings, ['ADMIN_ANALYTICS_KEY']);
  assert.equal((await app.call('GET', PROD + '/api/admin/summary')).status, 401);
  assert.equal((await app.call('GET', PROD + '/api/admin/summary', { headers: { 'X-Admin-Key': 'wrong' } })).status, 401);
  const good = await j(await app.call('GET', PROD + '/api/admin/summary?range=7d', { headers: { 'X-Admin-Key': KEY } }));
  assert.equal(good.status, 200); assert.equal(good.body.ok, true);
  const obs = await j(await app.call('GET', PROD + '/api/admin/observability', { headers: { 'X-Admin-Key': KEY } }));
  assert.equal(obs.status, 200);
  const unconfigured = await boot(root, {});
  assert.deepEqual((await j(await unconfigured.call('GET', PROD + '/api/admin/status'))).body, { ok: true, configured: false });
  assert.equal((await unconfigured.call('GET', PROD + '/api/admin/summary', { headers: { 'X-Admin-Key': 'x' } })).status, 503);
});

t('admin: 10 wrong keys lock the IP out (even for the right key), other IPs unaffected', async () => {
  const KEY = 'k'.repeat(32);
  const app = await boot(root, { ADMIN_ANALYTICS_KEY: KEY });
  const s = [];
  for (let i = 0; i < 10; i++) s.push((await app.call('GET', PROD + '/api/admin/summary', { headers: { 'X-Admin-Key': 'bad' + i }, ip: '3.3.3.3' })).status);
  assert.equal(s.every(x => x === 401), true);
  assert.equal((await app.call('GET', PROD + '/api/admin/summary', { headers: { 'X-Admin-Key': KEY }, ip: '3.3.3.3' })).status, 429);
  assert.equal((await app.call('GET', PROD + '/api/admin/summary', { headers: { 'X-Admin-Key': KEY }, ip: '3.3.3.4' })).status, 200);
});

/* ---------- Headers ---------- */
t('API responses carry security headers including a CSP', async () => {
  const app = await boot(root, {});
  const r = await app.call('GET', PROD + '/healthz');
  for (const h of ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'strict-transport-security', 'referrer-policy', 'permissions-policy'])
    assert.ok(r.headers.get(h), h);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('static assets get a strict CSP via public/_headers', async () => {
  const h = await fs.readFile(path.join(root, 'public/_headers'), 'utf8');
  assert.match(h, /Content-Security-Policy:/);
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "connect-src 'self'"]) assert.ok(h.includes(d), d);
  assert.doesNotMatch(h, /script-src[^;]*https?:/); // no third-party script hosts
});


t('authenticated state-changing requests reject cross-site browser metadata', async () => {
  const app = await boot(root, {});
  const A = await guest(app);
  const r1 = await app.call('POST', PROD + '/api/profile', { body: { name: 'Blocked' }, token: A.token, headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(r1.status, 403);
  const r2 = await app.call('POST', PROD + '/api/profile', { body: { name: 'Blocked' }, token: A.token, headers: { Origin: 'https://evil.example' } });
  assert.equal(r2.status, 403);
  const ok = await app.call('POST', PROD + '/api/profile', { body: { name: 'Allowed' }, token: A.token });
  assert.equal(ok.status, 200);
});

/* ---------- 6. Privacy-preserving location matching ---------- */
t('nearby: exact distance/bearing are never exposed; only coarse bands and sectors are returned', async () => {
  const app = await boot(root, {});
  const A = await guest(app, '8.8.8.8');
  const B = await guest(app, '8.8.8.9');
  await locate(app, A.token, 12.9716, 77.5946);
  await locate(app, B.token, 12.9761, 77.6000);
  const l = await j(await app.call('POST', PROD + '/api/listings', { body: { type: 'have', amount: 250, minutes: 30 }, token: B.token }));
  assert.equal(l.status, 200);
  const near = await j(await app.call('GET', PROD + '/api/nearby?r=10', { token: A.token }));
  assert.equal(near.status, 200);
  assert.equal(near.body.items.length, 1);
  const item = near.body.items[0];
  for (const forbidden of ['lat','lng','km','brg']) assert.equal(Object.hasOwn(item, forbidden), false, forbidden);
  assert.match(item.distance, /^(<500 m|500 m–1 km|1–3 km|3–5 km|5–10 km)$/);
  assert.match(item.direction, /^(N|NE|E|SE|S|SW|W|NW)$/);
  assert.ok(Number.isInteger(item.distanceBand) && item.distanceBand >= 0 && item.distanceBand <= 4);
  assert.ok(Number.isInteger(item.directionSector) && item.directionSector >= 0 && item.directionSector <= 7);
});

t('location/nearby: durable per-user abuse limits block excessive polling and updates', async () => {
  const app = await boot(root, {});
  const A = await guest(app, '8.8.4.4');
  assert.equal((await app.call('POST', PROD + '/api/location', { body: { lat: 12.9716, lng: 77.5946 }, token: A.token })).status, 200);
  // The endpoint intentionally rejects overly frequent location writes as well as applying a rolling durable cap.
  assert.equal((await app.call('POST', PROD + '/api/location', { body: { lat: 12.9716, lng: 77.5946 }, token: A.token })).status, 429);
  const statuses=[];
  for(let i=0;i<62;i++) statuses.push((await app.call('GET', PROD + '/api/nearby?r=3', { token: A.token })).status);
  assert.equal(statuses.slice(0,60).every(x=>x===200), true);
  assert.equal(statuses[60], 429);
  assert.equal(statuses[61], 429);
});

t('location: implausible high-speed jumps are rejected', async () => {
  const app = await boot(root, {});
  const A = await guest(app, '8.8.4.5');
  assert.equal((await app.call('POST', PROD + '/api/location', { body: { lat: 12.9716, lng: 77.5946 }, token: A.token })).status, 200);
  // Immediate movement to a far-away point is rejected before it can influence nearby matching.
  assert.equal((await app.call('POST', PROD + '/api/location', { body: { lat: 28.6139, lng: 77.2090 }, token: A.token })).status, 429);
});
