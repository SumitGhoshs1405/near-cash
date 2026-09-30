// Runs the REAL src/index.js against an in-memory SQLite database (node:sqlite, Node >= 22.5)
// through a small D1-compatible shim, so security behaviour can be tested end to end offline.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function sqliteAvailable() {
  try { await import('node:sqlite'); return true; } catch { return false; }
}

class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...a) { this.args = a; return this; }
  _s() { return this.db.prepare(this.sql); }
  async first() { const r = this._s().get(...this.args); return r ? { ...r } : null; }
  async all() { return { results: this._s().all(...this.args).map(r => ({ ...r })) }; }
  async run() { const r = this._s().run(...this.args); return { success: true, meta: { changes: Number(r.changes) } }; }
}

export async function makeDb() {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  return {
    prepare: sql => new Stmt(db, sql),
    async batch(stmts) {
      db.exec('BEGIN');
      try { const out = []; for (const s of stmts) out.push(await s.run()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    raw: db,
  };
}

let n = 0;
export async function loadWorker(root) {
  let src = await fs.readFile(path.join(root, 'src/index.js'), 'utf8');
  const imp = 'import { DurableObject } from "cloudflare:workers";';
  if (!src.includes(imp)) throw new Error('DurableObject import line not found');
  src = src.replace(imp, 'const DurableObject = class { constructor(ctx, env) {} };');
  const file = path.join(os.tmpdir(), `nc-worker-${process.pid}-${Date.now()}-${n++}.mjs`);
  await fs.writeFile(file, src);
  return (await import(pathToFileURL(file).href)).default;
}

export function fakeStream() {
  return { idFromName: x => x, get: () => ({ fetch: async () => new Response('ok') }) };
}

export async function boot(root, vars = {}) {
  const worker = await loadWorker(root);
  const DB = await makeDb();
  const env = { DB, USER_STREAM: fakeStream(), ...vars };
  const call = (method, url, { body, token, ip = '9.9.9.9', headers = {}, raw } = {}) => {
    const h = { 'CF-Connecting-IP': ip, ...headers };
    if (token) h.Authorization = 'Bearer ' + token;
    if (body !== undefined || raw !== undefined) h['Content-Type'] = 'application/json';
    return worker.fetch(new Request(url, { method, headers: h, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined }), env);
  };
  return { worker, env, DB, call };
}
