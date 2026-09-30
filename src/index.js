import { DurableObject } from "cloudflare:workers";

const SCHEMA=["CREATE TABLE IF NOT EXISTS users (\n  id TEXT PRIMARY KEY,\n  phone TEXT NOT NULL UNIQUE,\n  name TEXT NOT NULL,\n  done INTEGER NOT NULL DEFAULT 0,\n  lat REAL,\n  lng REAL,\n  at INTEGER,\n  created INTEGER NOT NULL\n)", "CREATE TABLE IF NOT EXISTS sessions (\n  token_hash TEXT PRIMARY KEY,\n  uid TEXT NOT NULL,\n  exp INTEGER NOT NULL,\n  FOREIGN KEY(uid) REFERENCES users(id) ON DELETE CASCADE\n)", "CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(exp)", "CREATE TABLE IF NOT EXISTS otps (\n  phone TEXT PRIMARY KEY,\n  hash TEXT NOT NULL,\n  exp INTEGER NOT NULL,\n  tries INTEGER NOT NULL DEFAULT 0\n)", "CREATE TABLE IF NOT EXISTS listings (\n  id TEXT PRIMARY KEY,\n  uid TEXT NOT NULL,\n  type TEXT NOT NULL CHECK(type IN ('have','need')),\n  amount INTEGER NOT NULL,\n  exp INTEGER NOT NULL,\n  status TEXT NOT NULL DEFAULT 'open',\n  FOREIGN KEY(uid) REFERENCES users(id) ON DELETE CASCADE\n)", "CREATE INDEX IF NOT EXISTS idx_listings_open ON listings(status, exp)", "CREATE INDEX IF NOT EXISTS idx_listings_uid ON listings(uid)", "CREATE TABLE IF NOT EXISTS threads (\n  id TEXT PRIMARY KEY,\n  lid TEXT NOT NULL,\n  amount INTEGER NOT NULL,\n  type TEXT NOT NULL,\n  a TEXT NOT NULL,\n  b TEXT NOT NULL,\n  status TEXT NOT NULL DEFAULT 'open',\n  confirmed TEXT NOT NULL DEFAULT '[]',\n  created INTEGER NOT NULL,\n  pin_hash TEXT,\n  pin_by TEXT,\n  pin_exp INTEGER,\n  pin_tries INTEGER NOT NULL DEFAULT 0,\n  pin_verified INTEGER NOT NULL DEFAULT 0,\n  FOREIGN KEY(a) REFERENCES users(id) ON DELETE CASCADE,\n  FOREIGN KEY(b) REFERENCES users(id) ON DELETE CASCADE\n)", "CREATE INDEX IF NOT EXISTS idx_threads_user_a ON threads(a, created)", "CREATE INDEX IF NOT EXISTS idx_threads_user_b ON threads(b, created)", "CREATE TABLE IF NOT EXISTS messages (\n  id TEXT PRIMARY KEY,\n  tid TEXT NOT NULL,\n  from_uid TEXT NOT NULL,\n  text TEXT NOT NULL,\n  at INTEGER NOT NULL,\n  FOREIGN KEY(tid) REFERENCES threads(id) ON DELETE CASCADE,\n  FOREIGN KEY(from_uid) REFERENCES users(id) ON DELETE CASCADE\n)", "CREATE INDEX IF NOT EXISTS idx_messages_tid ON messages(tid, at)", "CREATE TABLE IF NOT EXISTS reports (\n  id TEXT PRIMARY KEY,\n  by_uid TEXT NOT NULL,\n  who_uid TEXT NOT NULL,\n  tid TEXT NOT NULL,\n  reason TEXT NOT NULL,\n  at INTEGER NOT NULL,\n  last_json TEXT NOT NULL\n)", "CREATE TABLE IF NOT EXISTS blocks (\n  by_uid TEXT NOT NULL,\n  who_uid TEXT NOT NULL,\n  PRIMARY KEY(by_uid, who_uid)\n)", "CREATE TABLE IF NOT EXISTS abuse_limits (\n  uid TEXT NOT NULL,\n  action TEXT NOT NULL,\n  window_start INTEGER NOT NULL,\n  count INTEGER NOT NULL DEFAULT 0,\n  PRIMARY KEY(uid, action, window_start),\n  FOREIGN KEY(uid) REFERENCES users(id) ON DELETE CASCADE\n)", "CREATE INDEX IF NOT EXISTS idx_abuse_limits_uid ON abuse_limits(uid, action, window_start)", "CREATE TABLE IF NOT EXISTS notifications (\n  id TEXT PRIMARY KEY,\n  uid TEXT NOT NULL,\n  kind TEXT NOT NULL,\n  text TEXT NOT NULL,\n  ref TEXT,\n  at INTEGER NOT NULL,\n  read INTEGER NOT NULL DEFAULT 0,\n  FOREIGN KEY(uid) REFERENCES users(id) ON DELETE CASCADE\n)", "CREATE INDEX IF NOT EXISTS idx_notifications_uid ON notifications(uid, at)", "CREATE TABLE IF NOT EXISTS observability_events (\n  id TEXT PRIMARY KEY,\n  at INTEGER NOT NULL,\n  kind TEXT NOT NULL,\n  route TEXT NOT NULL,\n  status INTEGER NOT NULL,\n  request_id TEXT NOT NULL,\n  message TEXT NOT NULL\n)", "CREATE INDEX IF NOT EXISTS idx_observability_at ON observability_events(at)", "CREATE INDEX IF NOT EXISTS idx_observability_kind_at ON observability_events(kind, at)", "CREATE TABLE IF NOT EXISTS analytics_events (\n  id TEXT PRIMARY KEY,\n  at INTEGER NOT NULL,\n  event TEXT NOT NULL,\n  client_id TEXT NOT NULL,\n  screen TEXT,\n  meta_json TEXT NOT NULL DEFAULT '{}'\n)", "CREATE INDEX IF NOT EXISTS idx_analytics_at ON analytics_events(at)", "CREATE INDEX IF NOT EXISTS idx_analytics_event_at ON analytics_events(event, at)", "CREATE INDEX IF NOT EXISTS idx_users_at ON users(at)", "CREATE INDEX IF NOT EXISTS idx_listings_exp_status ON listings(status, exp)", "CREATE INDEX IF NOT EXISTS idx_threads_status_created ON threads(status, created)", "CREATE INDEX IF NOT EXISTS idx_notifications_uid_read_at ON notifications(uid, read, at)", "CREATE INDEX IF NOT EXISTS idx_reports_by_tid_at ON reports(by_uid, tid, at)", "CREATE TABLE IF NOT EXISTS ratings (\n  tid TEXT NOT NULL,\n  rater_uid TEXT NOT NULL,\n  ratee_uid TEXT NOT NULL,\n  stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),\n  tag TEXT,\n  at INTEGER NOT NULL,\n  PRIMARY KEY(tid, rater_uid),\n  FOREIGN KEY(tid) REFERENCES threads(id) ON DELETE CASCADE,\n  FOREIGN KEY(rater_uid) REFERENCES users(id) ON DELETE CASCADE,\n  FOREIGN KEY(ratee_uid) REFERENCES users(id) ON DELETE CASCADE\n)", "CREATE INDEX IF NOT EXISTS idx_ratings_ratee ON ratings(ratee_uid)", "CREATE INDEX IF NOT EXISTS idx_ratings_tid ON ratings(tid)", "CREATE TABLE IF NOT EXISTS rate_limits (\n  k TEXT NOT NULL,\n  window_start INTEGER NOT NULL,\n  count INTEGER NOT NULL DEFAULT 0,\n  PRIMARY KEY(k, window_start)\n)", "CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start)"];
let schemaReady=false;
// Column additions for DBs created before the meetup-PIN feature existed. SQLite has no
// "ADD COLUMN IF NOT EXISTS", so these are run one at a time and a "duplicate column" failure
// (already applied) is swallowed; any other failure is logged but never blocks boot.
const MIGRATIONS=[
  "ALTER TABLE threads ADD COLUMN pin_hash TEXT",
  "ALTER TABLE threads ADD COLUMN pin_by TEXT",
  "ALTER TABLE threads ADD COLUMN pin_exp INTEGER",
  "ALTER TABLE threads ADD COLUMN pin_tries INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE threads ADD COLUMN pin_verified INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE listings ADD COLUMN area TEXT",
];
async function ensureSchema(env){if(schemaReady)return;await env.DB.batch(SCHEMA.map(q=>env.DB.prepare(q)));for(const q of MIGRATIONS){try{await env.DB.prepare(q).run();}catch(e){if(!/duplicate column/i.test(e&&e.message||""))console.error("migration",q,e&&e.message);}}schemaReady=true;}
const apiHits=new Map();
const clientIp=req=>String(req.headers.get("CF-Connecting-IP")||req.headers.get("CF-Connecting-IPV6")||"?").slice(0,80);
const rateLimit=(key,limit,windowMs)=>{const now=Date.now();if(apiHits.size>5000){for(const [k,v] of apiHits)if(v.r<=now)apiHits.delete(k);}const h=apiHits.get(key);if(!h||h.r<=now){apiHits.set(key,{c:1,r:now+windowMs});return {ok:true,retry:0};}h.c+=1;return h.c<=limit?{ok:true,retry:0}:{ok:false,retry:Math.max(1,Math.ceil((h.r-now)/1000))};};
const securityHeaders={"X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"strict-origin-when-cross-origin","Permissions-Policy":"camera=(), microphone=(), geolocation=(self)","Strict-Transport-Security":"max-age=31536000; includeSubDomains","Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'; base-uri 'none'","Cache-Control":"no-store"};
const json = (o, status=200, extra={}) => new Response(JSON.stringify(o), {status, headers:{"Content-Type":"application/json; charset=utf-8", ...securityHeaders, ...extra}});
const err = (m,c=400) => { const e=new Error(m); e.status=c; throw e; };
const id = () => crypto.randomUUID().replaceAll("-", "").slice(0,16);
const requestId = () => crypto.randomUUID();
const safeObsMessage = value => String(value||"").replace(/[\r\n\t]+/g," ").replace(/\s{2,}/g," ").slice(0,240);
async function recordObs(env,{kind,route,status,requestId,message}){
  try{
    await env.DB.prepare("INSERT INTO observability_events(id,at,kind,route,status,request_id,message) VALUES(?,?,?,?,?,?,?)")
      .bind(id(),Date.now(),String(kind||"unknown").slice(0,40),String(route||"/").slice(0,160),Number(status||500),String(requestId||"").slice(0,80),safeObsMessage(message)).run();
    // Keep the operational event table bounded without making every request pay a cleanup cost.
    if(Math.random()<0.01) await env.DB.prepare("DELETE FROM observability_events WHERE at<?").bind(Date.now()-30*86400000).run().catch(()=>{});
  }catch(e){ console.error("observability",e&&e.message||e); }
}
async function sha(s){ const b=await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))); return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join(""); }
const clean=v=>String(v??"").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,"");
// DEV_OTP (code shown in the API response) is honoured ONLY when the request host is local, so a stray DEV_OTP=true in production can never expose sign-in codes.
const devOtpOn=(env,url)=>env.DEV_OTP==="true"&&/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
const escPhone = s => String(s||"").replace(/[\s-]/g,"");
const rad = x => x*Math.PI/180;
const dist=(a,b)=>{const h=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;return 12742*Math.asin(Math.sqrt(h));};
const bearing=(a,b)=>{const y=Math.sin(rad(b.lng-a.lng))*Math.cos(rad(b.lat)),x=Math.cos(rad(a.lat))*Math.sin(rad(b.lat))-Math.sin(rad(a.lat))*Math.cos(rad(b.lat))*Math.cos(rad(b.lng-a.lng));return(Math.atan2(y,x)*180/Math.PI+360)%360;};
async function repOf(env,uid){const r=await env.DB.prepare("SELECT AVG(stars) a,COUNT(*) c FROM ratings WHERE ratee_uid=?").bind(uid).first();return{avg:(r&&r.a)||0,count:(r&&r.c)||0};}
const badgesFor=(u,rep)=>{const b=[];if(u.phone&&!String(u.phone).startsWith("guest:"))b.push("verified");if((u.done||0)>=5&&((rep&&rep.avg)||0)>=4.5)b.push("trusted");if((u.done||0)===0)b.push("new");return b;};
const pubU=(u,rep)=>({id:u.id,name:u.name,done:u.done||0,rating:rep?Math.round((rep.avg||0)*10)/10:0,ratingCount:rep?(rep.count||0):0,badges:badgesFor(u,rep||{avg:0,count:0})});
const readBody=async req=>{let t=await req.text(); if(t.length>10000)err("Request too large",413); let v;try{v=t?JSON.parse(t):{}}catch{err("Invalid JSON",400)}if(v===null||typeof v!=="object"||Array.isArray(v))err("Invalid JSON",400);return v};
const parseRow = r => r ? {...r} : null;
const normPhone=(env,p)=>{p=String(p||"").replace(/[\s-]/g,"");return p[0]==="+"?p:/^\d{10}$/.test(p)?"+"+(env.DEFAULT_COUNTRY_CODE||"91")+p:"+"+p;};
async function sendSms(env,to,code){
  if(env.TWILIO_ACCOUNT_SID&&env.TWILIO_AUTH_TOKEN&&env.TWILIO_FROM){const r=await fetch("https://api.twilio.com/2010-04-01/Accounts/"+env.TWILIO_ACCOUNT_SID+"/Messages.json",{method:"POST",headers:{Authorization:"Basic "+btoa(env.TWILIO_ACCOUNT_SID+":"+env.TWILIO_AUTH_TOKEN),"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({To:to,From:env.TWILIO_FROM,Body:"Your Near Cash code is "+code})});if(!r.ok){console.error("Twilio error",r.status,await r.text());err("Could not send the code",502);}return;}
const u=env.SMS_WEBHOOK_URL;if(!u)err("SMS provider not configured",501);const r=await fetch(u,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+(env.SMS_WEBHOOK_TOKEN||"")},body:JSON.stringify({to,message:"Your Near Cash code is "+code})});if(!r.ok)err("Could not send the code",502);}
async function getUser(env,req){
  const auth=String(req.headers.get("Authorization")||"");
  if(!/^Bearer\s+[^\s]+$/i.test(auth)){await recordObs(env,{kind:"auth_failure",route:"/api/authenticated",status:401,requestId:requestId(),message:"Missing or malformed Bearer token"});err("Please sign in",401);}
  const tok=auth.replace(/^Bearer\s+/i,"").trim();
  const h=await sha(tok);
  const r=await env.DB.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.uid WHERE s.token_hash=? AND s.exp>? LIMIT 1").bind(h,Date.now()).first();
  if(!r){await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(h).run().catch(()=>{});await recordObs(env,{kind:"auth_failure",route:"/api/authenticated",status:401,requestId:requestId(),message:"Expired or invalid session"});err("Please sign in",401);}
  return {u:r,tok,h};
}
async function blocked(env,a,b){return !!await env.DB.prepare("SELECT 1 FROM blocks WHERE (by_uid=? AND who_uid=?) OR (by_uid=? AND who_uid=?) LIMIT 1").bind(a,b,b,a).first();}
async function userActionLimit(env,uid,action,limit,windowMs){
  const start=Math.floor(Date.now()/windowMs)*windowMs;
  const r=await env.DB.prepare("INSERT INTO abuse_limits(uid,action,window_start,count) VALUES(?,?,?,1) ON CONFLICT(uid,action,window_start) DO UPDATE SET count=count+1 RETURNING count").bind(uid,action,start).first();
  const count=Number(r&&r.count||0);
  if(count>limit)err("Too many requests. Please try again later.",429);
  if((Math.random()*100)<1) await env.DB.prepare("DELETE FROM abuse_limits WHERE window_start<?").bind(Date.now()-86400000).run().catch(()=>{});
}
// Durable (D1) limiter keyed by any string (IP, phone...). Unlike the in-memory rateLimit it survives redeploys and is shared by every Worker instance.
async function keyLimit(env,key,limit,windowMs){
  const now=Date.now(),start=Math.floor(now/windowMs)*windowMs;
  const r=await env.DB.prepare("INSERT INTO rate_limits(k,window_start,count) VALUES(?,?,1) ON CONFLICT(k,window_start) DO UPDATE SET count=count+1 RETURNING count").bind(String(key).slice(0,160),start).first();
  if(Math.random()*100<1) await env.DB.prepare("DELETE FROM rate_limits WHERE window_start<?").bind(now-86400000).run().catch(()=>{});
  return {ok:Number(r&&r.count||0)<=limit,retry:Math.max(1,Math.ceil((start+windowMs-now)/1000))};
}
async function keyLocked(env,key,limit,windowMs){
  const start=Math.floor(Date.now()/windowMs)*windowMs;
  const r=await env.DB.prepare("SELECT count FROM rate_limits WHERE k=? AND window_start=?").bind(String(key).slice(0,160),start).first();
  return Number(r&&r.count||0)>=limit;
}
// Returns null when the X-Admin-Key is valid, otherwise a ready-to-return Response. Failed keys are counted per IP and lock that IP out after 10 misses/hour.
async function adminKeyCheck(env,req,configuredValue,route){
  const ip=clientIp(req),FK="admin-fail:"+ip;
  if(await keyLocked(env,FK,10,3600000)){const rid=requestId();await recordObs(env,{kind:"rate_limited",route,status:429,requestId:rid,message:"Admin key lockout"});return adminJson(env,req,{error:"Too many failed attempts. Try again later.",requestId:rid},429);}
  const supplied=String(req.headers.get("X-Admin-Key")||"");
  if(!supplied)return adminJson(env,req,{error:"Admin key required"},401);
  const [expectedHash,suppliedHash]=await Promise.all([sha(configuredValue),sha(supplied)]);
  if(expectedHash!==suppliedHash){await keyLimit(env,FK,10,3600000);return adminJson(env,req,{error:"Invalid admin key"},401);}
  return null;
}
async function notify(env,uid,kind,text,ref){try{await env.DB.prepare("INSERT INTO notifications(id,uid,kind,text,ref,at,read) VALUES(?,?,?,?,?,?,0)").bind(id(),uid,kind,String(text).slice(0,160),ref||null,Date.now()).run();await push(env,uid,{t:"notif"});}catch(e){console.error("notify",e&&e.message);}}
async function push(env,uid,event){const stub=env.USER_STREAM.get(env.USER_STREAM.idFromName(uid));await stub.fetch("https://stream/push",{method:"POST",body:JSON.stringify(event)}).catch(()=>{});}
const adminCors=(env,req)=>{
  const origin=String(req.headers.get("Origin")||"");
  const allowed=String(env.ADMIN_ORIGIN||"").trim();
  const h={"Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"X-Admin-Key,Accept,Content-Type","Cache-Control":"no-store","Vary":"Origin"};
  // Cross-origin browser access only for the exact ADMIN_ORIGIN. Unset = same-origin only (no wildcard).
  if(allowed&&origin===allowed)h["Access-Control-Allow-Origin"]=allowed;
  return h;
};
const adminJson = (env,req,o,status=200) => json(o,status,adminCors(env,req));
const getAdminAnalyticsKey = (env) => {
  // Primary production secret. The aliases keep older Cloudflare deployments compatible
  // if the secret was accidentally created under one of the legacy names.
  // Reflect.get is used instead of plain env[name] bracket access: Cloudflare's Workers
  // runtime implements `env` via an internal Proxy, and there is a documented class of bug
  // where the Proxy's get trap can return undefined for a binding that genuinely exists —
  // Reflect.get bypasses that and is the known workaround.
  const names = ["ADMIN_ANALYTICS_KEY", "ADMIN_ANALYTICS_K", "ADMIN_KEY"];
  for (const name of names) {
    let raw;
    try { raw = Reflect.get(env, name); } catch { raw = env[name]; }
    const value = String(raw || "").trim();
    if (value) return {value, name};
  }
  return {value:"", name:null};
};
// Diagnostic only: lists env binding *names* (never values) that look admin/analytics-related.
// This is what lets you see a typo'd, mis-cased, or missing secret from /api/admin/status
// without ever exposing the secret itself. Reflect.ownKeys is used for the same Proxy-safety
// reason as above — Object.keys can miss properties that a plain enumeration trap hides.
const adminEnvHints = (env) => {
  try {
    const keys = new Set([...Object.keys(env||{}), ...Reflect.ownKeys(env||{}).filter(k=>typeof k==="string")]);
    return {matches:[...keys].filter(k=>/ADMIN|ANALYTICS/i.test(k)).sort(), totalBindings:keys.size};
  } catch { return {matches:[], totalBindings:0}; }
};
async function analyticsEvent(env,req,b){
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const event=String(b.event||"").trim().slice(0,50);
  const clientId=String(b.clientId||"").trim().slice(0,80);
  const screen=String(b.screen||"").trim().slice(0,60);
  const allowed=new Set(["page_view","need_cash_opened","have_cash_opened","post_created","matches_viewed","match_requested","match_accepted","activity_viewed","exchange_confirmed","safety_viewed","profile_viewed","location_enabled","search_used"]);
  if(!allowed.has(event)||!/^[A-Za-z0-9_-]{16,80}$/.test(clientId))return json({error:"Invalid analytics event"},400);
  let meta={};
  if(b.meta&&typeof b.meta==="object"&&!Array.isArray(b.meta)){
    for(const k of Object.keys(b.meta).slice(0,8)){const v=b.meta[k];if(["string","number","boolean"].includes(typeof v))meta[String(k).slice(0,30)]=typeof v==="string"?v.slice(0,80):v;}
  }
  await env.DB.prepare("INSERT INTO analytics_events(id,at,event,client_id,screen,meta_json) VALUES(?,?,?,?,?,?)").bind(id(),Date.now(),event,clientId,screen,JSON.stringify(meta)).run();
  if(Math.random()<0.02)await env.DB.prepare("DELETE FROM analytics_events WHERE at<?").bind(Date.now()-90*86400000).run().catch(()=>{});
  return json({ok:true},201);
}
async function privacyExport(env,req,u){
  if(req.method!=="GET")return json({error:"Method not allowed"},405);
  const [profile,listings,threads,notifications,reports,blocks] = await Promise.all([
    env.DB.prepare("SELECT id,phone,name,done,created,lat,lng,at FROM users WHERE id=?").bind(u.id).first(),
    env.DB.prepare("SELECT id,type,amount,exp,status FROM listings WHERE uid=? ORDER BY exp DESC LIMIT 200").bind(u.id).all(),
    env.DB.prepare("SELECT id,lid,amount,type,status,confirmed,created,pin_exp,pin_verified FROM threads WHERE a=? OR b=? ORDER BY created DESC LIMIT 200").bind(u.id,u.id).all(),
    env.DB.prepare("SELECT id,kind,text,ref,at,read FROM notifications WHERE uid=? ORDER BY at DESC LIMIT 200").bind(u.id).all(),
    env.DB.prepare("SELECT id,who_uid,tid,reason,at FROM reports WHERE by_uid=? ORDER BY at DESC LIMIT 200").bind(u.id).all(),
    env.DB.prepare("SELECT who_uid FROM blocks WHERE by_uid=? ORDER BY who_uid LIMIT 200").bind(u.id).all()
  ]);
  return json({ok:true,exportedAt:Date.now(),account:profile||null,listings:listings.results||[],threads:threads.results||[],notifications:notifications.results||[],reports:reports.results||[],blocks:blocks.results||[]});
}
async function privacyLocationDelete(env,req,u){
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  await env.DB.prepare("UPDATE users SET lat=NULL,lng=NULL,at=NULL WHERE id=?").bind(u.id).run();
  return json({ok:true});
}
async function privacyDelete(env,req,u,b){
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  if(String(b.confirm||"")!=="DELETE")err('Type DELETE to permanently remove your Near Cash account',400);
  const tids=await env.DB.prepare("SELECT id FROM threads WHERE a=? OR b=? LIMIT 200").bind(u.id,u.id).all();
  const ids=(tids.results||[]).map(x=>String(x.id)).filter(Boolean);
  const stmts=[];
  if(ids.length){
    const q=ids.map(()=>'?').join(',');
    stmts.push(env.DB.prepare(`DELETE FROM messages WHERE tid IN (${q})`).bind(...ids));
    stmts.push(env.DB.prepare(`DELETE FROM reports WHERE tid IN (${q})`).bind(...ids));
    stmts.push(env.DB.prepare(`DELETE FROM threads WHERE id IN (${q})`).bind(...ids));
  }
  stmts.push(
    env.DB.prepare("DELETE FROM listings WHERE uid=?").bind(u.id),
    env.DB.prepare("DELETE FROM notifications WHERE uid=?").bind(u.id),
    env.DB.prepare("DELETE FROM abuse_limits WHERE uid=?").bind(u.id),
    env.DB.prepare("DELETE FROM sessions WHERE uid=?").bind(u.id),
    env.DB.prepare("DELETE FROM blocks WHERE by_uid=? OR who_uid=?").bind(u.id,u.id),
    env.DB.prepare("DELETE FROM reports WHERE by_uid=?").bind(u.id),
    env.DB.prepare("DELETE FROM users WHERE id=?").bind(u.id)
  );
  await env.DB.batch(stmts);
  return json({ok:true,deleted:true});
}
const RANGE_PRESETS = {
  "24h":  {ms:24*3600000,   bucket:"hour",  fmt:"%Y-%m-%d %H:00", label:"Last 24 hours"},
  "7d":   {ms:7*86400000,   bucket:"day",   fmt:"%Y-%m-%d",       label:"Last 7 days"},
  "30d":  {ms:30*86400000,  bucket:"day",   fmt:"%Y-%m-%d",       label:"Last 30 days"},
  "365d": {ms:365*86400000, bucket:"month", fmt:"%Y-%m",          label:"Last 365 days"}
};
const resolveRange = url => { const raw = String(url.searchParams.get("range")||"30d").toLowerCase(); return RANGE_PRESETS[raw] ? raw : "30d"; };
// Builds the full ordered list of bucket keys for the chosen window (even ones with zero
// activity), in UTC to match SQLite's strftime(...,'unixepoch') which is UTC by default.
function bucketKeys(cfg, now){
  const keys=[];
  if(cfg.bucket==="hour"){
    const start=Math.floor(now/3600000)*3600000;
    for(let i=23;i>=0;i--) keys.push(new Date(start-i*3600000).toISOString().slice(0,13).replace("T"," ")+":00");
  } else if(cfg.bucket==="day"){
    const days=cfg.ms/86400000, start=Math.floor(now/86400000)*86400000;
    for(let i=days-1;i>=0;i--) keys.push(new Date(start-i*86400000).toISOString().slice(0,10));
  } else {
    const d0=new Date(now), y0=d0.getUTCFullYear(), m0=d0.getUTCMonth();
    for(let i=11;i>=0;i--) keys.push(new Date(Date.UTC(y0,m0-i,1)).toISOString().slice(0,7));
  }
  return keys;
}
const seriesMap = rows => { const m={}; for(const r of (rows&&rows.results)||[]) m[r.b]=Number(r.c||0); return m; };
const seriesQuery = (env,table,timeCol,since,fmt,extraWhere="") => env.DB.prepare(`SELECT strftime('${fmt}', ${timeCol}/1000,'unixepoch') b, COUNT(*) c FROM ${table} WHERE ${timeCol}>=?${extraWhere} GROUP BY b ORDER BY b`).bind(since).all();
const withDelta = (curr,prev) => { curr=Number(curr||0); prev=Number(prev||0); const pct = prev>0 ? Math.round(((curr-prev)/prev)*1000)/10 : (curr>0?100:0); return {value:curr,prev,pct}; };
async function adminSummary(env,req,url){
  if(req.method === "OPTIONS") return new Response(null,{status:204,headers:{...securityHeaders,...adminCors(env,req)}});
  if(req.method !== "GET") return adminJson(env,req,{error:"Method not allowed"},405);
  const configured = getAdminAnalyticsKey(env);
  if(!configured.value){
    const hints=adminEnvHints(env);
    const extra=hints.matches.length?` Found these admin-related bindings instead: ${hints.matches.join(", ")}.`:` No admin-related bindings were found on this Worker (it has ${hints.totalBindings} binding(s) total).`;
    return adminJson(env,req,{error:"Admin analytics is not configured. Add the Production secret ADMIN_ANALYTICS_KEY to the near-cash Worker, then redeploy."+extra,expectedNames:["ADMIN_ANALYTICS_KEY","ADMIN_ANALYTICS_K","ADMIN_KEY"],presentAdminBindings:hints.matches,totalBindings:hints.totalBindings},503);
  }
  const denied = await adminKeyCheck(env,req,configured.value,"/api/admin/summary");
  if(denied) return denied;
  const rangeKey = resolveRange(url), cfg = RANGE_PRESETS[rangeKey];
  const now = Date.now(), since = now-cfg.ms, prevSince = since-cfg.ms;
  const [
    totalUsersRow,newUsersRow,prevNewUsersRow,active24hRow,activeInRangeRow,
    openListingsRow,openHaveRow,openNeedRow,
    threadsRow,prevThreadsRow,completedRow,prevCompletedRow,
    messagesRow,prevMessagesRow,reportsRow,prevReportsRow,locationUsersRow,
    errorsRangeRow,errors24hRow,rateLimitedRangeRow,authFailuresRangeRow,
    analyticsRangeRow,uniqueClientsRangeRow,topAnalyticsRows,topRoutesRows,
    ratingsRow,ratingsBreakdownRows,
    usersSeriesRows,threadsSeriesRows,completedSeriesRows,messagesSeriesRows,reportsSeriesRows,analyticsSeriesRows
  ] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) c FROM users").first(),
    env.DB.prepare("SELECT COUNT(*) c FROM users WHERE created>=?").bind(since).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM users WHERE created>=? AND created<?").bind(prevSince,since).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM users WHERE COALESCE(at,created)>=?").bind(now-86400000).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM users WHERE COALESCE(at,created)>=?").bind(since).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM listings WHERE status='open' AND exp>=?").bind(now).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM listings WHERE status='open' AND exp>=? AND type='have'").bind(now).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM listings WHERE status='open' AND exp>=? AND type='need'").bind(now).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM threads WHERE created>=?").bind(since).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM threads WHERE created>=? AND created<?").bind(prevSince,since).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM threads WHERE status='completed' AND created>=?").bind(since).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM threads WHERE status='completed' AND created>=? AND created<?").bind(prevSince,since).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM messages WHERE at>=?").bind(since).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM messages WHERE at>=? AND at<?").bind(prevSince,since).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM reports WHERE at>=?").bind(since).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM reports WHERE at>=? AND at<?").bind(prevSince,since).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM users WHERE lat IS NOT NULL AND lng IS NOT NULL AND COALESCE(at,created)>=?").bind(since).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM observability_events WHERE kind='server_error' AND at>=?").bind(since).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM observability_events WHERE kind='server_error' AND at>=?").bind(now-86400000).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM observability_events WHERE kind='rate_limited' AND at>=?").bind(since).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM observability_events WHERE kind='auth_failure' AND at>=?").bind(since).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM analytics_events WHERE at>=?").bind(since).first(),
    env.DB.prepare("SELECT COUNT(DISTINCT client_id) c FROM analytics_events WHERE at>=?").bind(since).first(),
    env.DB.prepare("SELECT event,COUNT(*) c FROM analytics_events WHERE at>=? GROUP BY event ORDER BY c DESC LIMIT 40").bind(since).all(),
    env.DB.prepare("SELECT route AS path,COUNT(*) c FROM observability_events WHERE at>=? GROUP BY route ORDER BY c DESC LIMIT 20").bind(since).all(),
    env.DB.prepare("SELECT COUNT(*) c, AVG(stars) a FROM ratings WHERE at>=?").bind(since).first(),
    env.DB.prepare("SELECT stars,COUNT(*) c FROM ratings WHERE at>=? GROUP BY stars ORDER BY stars DESC").bind(since).all(),
    seriesQuery(env,"users","created",since,cfg.fmt),
    seriesQuery(env,"threads","created",since,cfg.fmt),
    seriesQuery(env,"threads","created",since,cfg.fmt," AND status='completed'"),
    seriesQuery(env,"messages","at",since,cfg.fmt),
    seriesQuery(env,"reports","at",since,cfg.fmt),
    seriesQuery(env,"analytics_events","at",since,cfg.fmt)
  ]);
  const analyticsMap = {}; for(const r of (topAnalyticsRows.results||[])) analyticsMap[r.event]=Number(r.c||0);
  const totals = {
    totalUsers:Number(totalUsersRow?.c||0), newUsers:Number(newUsersRow?.c||0),
    activeUsers24h:Number(active24hRow?.c||0), activeUsersInRange:Number(activeInRangeRow?.c||0),
    openListings:Number(openListingsRow?.c||0), openListingsHave:Number(openHaveRow?.c||0), openListingsNeed:Number(openNeedRow?.c||0),
    connections:Number(threadsRow?.c||0), completedExchanges:Number(completedRow?.c||0),
    completionRate: threadsRow?.c ? Math.round((Number(completedRow?.c||0)/Number(threadsRow.c))*1000)/10 : 0,
    messages:Number(messagesRow?.c||0), reports:Number(reportsRow?.c||0),
    locationEnabledUsers:Number(locationUsersRow?.c||0),
    errors:Number(errorsRangeRow?.c||0), errors24h:Number(errors24hRow?.c||0),
    rateLimited:Number(rateLimitedRangeRow?.c||0), authFailures:Number(authFailuresRangeRow?.c||0),
    analyticsEvents:Number(analyticsRangeRow?.c||0), uniqueClients:Number(uniqueClientsRangeRow?.c||0),
    ratingsCount:Number(ratingsRow?.c||0), ratingsAvg: ratingsRow&&ratingsRow.a ? Math.round(ratingsRow.a*10)/10 : 0
  };
  const deltas = {
    newUsers:withDelta(newUsersRow?.c,prevNewUsersRow?.c),
    connections:withDelta(threadsRow?.c,prevThreadsRow?.c),
    completedExchanges:withDelta(completedRow?.c,prevCompletedRow?.c),
    messages:withDelta(messagesRow?.c,prevMessagesRow?.c),
    reports:withDelta(reportsRow?.c,prevReportsRow?.c)
  };
  const funnel = [
    {event:"page_view",label:"Visitors",c:analyticsMap.page_view||0},
    {event:"sign_up",label:"Sign-ups",c:totals.newUsers},
    {event:"location_enabled",label:"Location enabled",c:analyticsMap.location_enabled||totals.locationEnabledUsers},
    {event:"listing_opened",label:"Need/Have cash opened",c:(analyticsMap.need_cash_opened||0)+(analyticsMap.have_cash_opened||0)},
    {event:"matches_viewed",label:"Matches viewed",c:analyticsMap.matches_viewed||0},
    {event:"match_requested",label:"Match requested",c:analyticsMap.match_requested||0},
    {event:"connection_started",label:"Connections started",c:totals.connections},
    {event:"exchange_completed",label:"Completed exchanges",c:totals.completedExchanges}
  ];
  const keys = bucketKeys(cfg,now);
  const um=seriesMap(usersSeriesRows), tm=seriesMap(threadsSeriesRows), cm=seriesMap(completedSeriesRows), mm=seriesMap(messagesSeriesRows), rm=seriesMap(reportsSeriesRows), am=seriesMap(analyticsSeriesRows);
  const series = keys.map(k=>({bucket:k,newUsers:um[k]||0,connections:tm[k]||0,completedExchanges:cm[k]||0,messages:mm[k]||0,reports:rm[k]||0,analyticsEvents:am[k]||0}));
  return adminJson(env,req,{
    ok:true,range:rangeKey,rangeLabel:cfg.label,bucket:cfg.bucket,since,generatedAt:now,
    totals,deltas,funnel,
    topAnalyticsEvents:topAnalyticsRows.results||[],
    topRoutes:topRoutesRows.results||[],
    ratings:{count:totals.ratingsCount,avg:totals.ratingsAvg,breakdown:ratingsBreakdownRows.results||[]},
    observability:{errors:totals.errors,errors24h:totals.errors24h,rateLimited:totals.rateLimited,authFailures:totals.authFailures},
    series
  },200);
}
async function api(env,req,p,url){
  if(p==="admin/status") {
    const rl=await keyLimit(env,"admin-status:"+clientIp(req),30,60000);
    if(!rl.ok){const rid=requestId();await recordObs(env,{kind:"rate_limited",route:"/api/admin/status",status:429,requestId:rid,message:"Admin status rate limit"});return adminJson(env,req,{error:"Too many requests",retryAfter:rl.retry,requestId:rid},429);}
    if(req.method === "OPTIONS") return new Response(null,{status:204,headers:{...securityHeaders,...adminCors(env,req)}});
    if(req.method !== "GET") return adminJson(env,req,{error:"Method not allowed"},405);
    const configured = getAdminAnalyticsKey(env);
    // Public callers only learn whether the admin secret is configured. Binding names are shown only to a caller holding the valid admin key.
    if(!configured.value||!req.headers.get("X-Admin-Key"))return adminJson(env,req,{ok:true,configured:!!configured.value});
    const denied=await adminKeyCheck(env,req,configured.value,"/api/admin/status");
    if(denied)return denied;
    const hints = adminEnvHints(env);
    return adminJson(env,req,{ok:true,configured:true,source:configured.name||null,expectedNames:["ADMIN_ANALYTICS_KEY","ADMIN_ANALYTICS_K","ADMIN_KEY"],presentAdminBindings:hints.matches,totalBindings:hints.totalBindings});
  }
  if(p==="admin/observability") {
    const rl=await keyLimit(env,"admin-observability:"+clientIp(req),30,60000);
    if(!rl.ok){const rid=requestId();await recordObs(env,{kind:"rate_limited",route:"/api/admin/observability",status:429,requestId:rid,message:"Admin observability rate limit"});return adminJson(env,req,{error:"Too many requests",retryAfter:rl.retry,requestId:rid},429);}
    if(req.method === "OPTIONS") return new Response(null,{status:204,headers:{...securityHeaders,...adminCors(env,req)}});
    if(req.method !== "GET") return adminJson(env,req,{error:"Method not allowed"},405);
    const configured=getAdminAnalyticsKey(env);
    if(!configured.value)return adminJson(env,req,{error:"Admin analytics is not configured"},503);
    const denied=await adminKeyCheck(env,req,configured.value,"/api/admin/observability");
    if(denied)return denied;
    const since=Date.now()-24*86400000;
    const [counts,recent]=await Promise.all([
      env.DB.prepare("SELECT kind,COUNT(*) AS c FROM observability_events WHERE at>=? GROUP BY kind ORDER BY c DESC").bind(since).all(),
      env.DB.prepare("SELECT at,kind,route,status,request_id AS requestId,message FROM observability_events ORDER BY at DESC LIMIT 50").all()
    ]);
    return adminJson(env,req,{ok:true,rangeHours:24,generatedAt:Date.now(),counts:counts.results||[],recent:recent.results||[]},200);
  }
  if(p==="admin/summary") {
    const rl=await keyLimit(env,"admin:"+clientIp(req),60,60000);
    if(!rl.ok){const rid=requestId();await recordObs(env,{kind:"rate_limited",route:"/api/admin/summary",status:429,requestId:rid,message:"Admin summary rate limit"});return adminJson(env,req,{error:"Too many requests",retryAfter:rl.retry,requestId:rid},429);}
    return adminSummary(env,req,url);
  }
  const m=req.method, b=m==="POST"?await readBody(req):{};
  if(p==="analytics"&&m==="POST"){
    const rl=rateLimit("analytics:"+clientIp(req),30,60000);
    if(!rl.ok){const rid=requestId();await recordObs(env,{kind:"rate_limited",route:"/api/analytics",status:429,requestId:rid,message:"Analytics rate limit"});return json({error:"Too many analytics events",retryAfter:rl.retry,requestId:rid},429);}
    return analyticsEvent(env,req,b);
  }
  const publicRl=rateLimit("api:"+clientIp(req)+":"+p.split("/")[0],60,60000);
  if(!publicRl.ok){const rid=requestId();await recordObs(env,{kind:"rate_limited",route:"/api/"+p,status:429,requestId:rid,message:"API rate limit"});return json({error:"Too many requests. Please try again shortly.",requestId:rid},429);}
  if(p==="guest"&&m==="POST"){
    if(env.REQUIRE_SIGNIN==="true")err("Sign in required",403);
    if(!(await keyLimit(env,"guest-ip:"+clientIp(req),20,3600000)).ok)err("Too many new accounts from this network. Try again later.",429);
    const uid=id(),name="Guest "+String(crypto.getRandomValues(new Uint32Array(1))[0]%9000+1000);
    await env.DB.prepare("INSERT INTO users(id,phone,name,done,created) VALUES(?,?,?,?,?)").bind(uid,"guest:"+uid,name,0,Date.now()).run();
    const token=crypto.randomUUID()+crypto.randomUUID(),h=await sha(token);
    await env.DB.prepare("INSERT INTO sessions(token_hash,uid,exp) VALUES(?,?,?)").bind(h,uid,Date.now()+2592e6).run();
    await notify(env,uid,"account","Account created. Welcome, "+name+"!");return json({token,me:{id:uid,name,done:0}});
  }
  if(p==="otp"&&m==="POST"){
    const ph=normPhone(env,b.phone); if(!/^\+\d{11,14}$/.test(ph))err("Enter a valid phone number");
    const dev=devOtpOn(env,url);
    if(!dev){
      if(!(await keyLimit(env,"otp-ip:"+clientIp(req),10,3600000)).ok)err("Too many code requests from this network. Try again later.",429);
      if(!(await keyLimit(env,"otp-phone:"+ph,5,3600000)).ok)err("Too many code requests for this number. Try again later.",429);
    }
    const old=await env.DB.prepare("SELECT phone FROM otps WHERE phone=? AND exp>? ").bind(ph,Date.now()).first();
    if(old&&!dev)err("Please wait before requesting another code",429);
    const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%900000+100000), h=await sha(code+ph);
    await env.DB.prepare("INSERT INTO otps(phone,hash,exp,tries) VALUES(?,?,?,0) ON CONFLICT(phone) DO UPDATE SET hash=excluded.hash,exp=excluded.exp,tries=0").bind(ph,h,Date.now()+300000).run();
    if(dev)return json({ok:true,devCode:code});
    try{await sendSms(env,ph,code);}catch(e){await env.DB.prepare("DELETE FROM otps WHERE phone=?").bind(ph).run().catch(()=>{});throw e;}
    return json({ok:true});
  }
  if(p==="verify"&&m==="POST"){
    if(!(await keyLimit(env,"verify-ip:"+clientIp(req),30,3600000)).ok)err("Too many attempts from this network. Try again later.",429);
    const ph=normPhone(env,b.phone), o=await env.DB.prepare("SELECT * FROM otps WHERE phone=?").bind(ph).first();
    if(!o||o.exp<Date.now())err("Code expired. Request a new one.");
    if(o.tries>=5){await env.DB.prepare("DELETE FROM otps WHERE phone=?").bind(ph).run();err("Too many attempts. Request a new code.",429);}
    await env.DB.prepare("UPDATE otps SET tries=tries+1 WHERE phone=?").bind(ph).run();
    if(o.hash!==await sha(String(b.code)+ph))err("That code is wrong");
    if(b.adult!==true)err("You must be 18 or older");
    let u=await env.DB.prepare("SELECT * FROM users WHERE phone=?").bind(ph).first(); const nm=clean(b.name).trim().slice(0,40); if(!u&&!nm)err("Enter your name");
    await env.DB.prepare("DELETE FROM otps WHERE phone=?").bind(ph).run();
    if(!u){u={id:id(),phone:ph,name:nm,done:0,created:Date.now()};await env.DB.prepare("INSERT INTO users(id,phone,name,done,created) VALUES(?,?,?,?,?)").bind(u.id,u.phone,u.name,0,u.created).run();}
    const token=crypto.randomUUID()+crypto.randomUUID(), h=await sha(token);await env.DB.prepare("INSERT INTO sessions(token_hash,uid,exp) VALUES(?,?,?)").bind(h,u.id,Date.now()+2592e6).run();
    return json({token,me:pubU(u,await repOf(env,u.id))});
  }
  const {u,h:sessionHash}=await getUser(env,req);
  if(p==="logout"&&m==="POST"){await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(sessionHash).run();return json({ok:true});}
  if(p==="profile"&&m==="POST"){const nm=clean(b.name).trim().slice(0,40);if(!nm)err("Enter a name");await env.DB.prepare("UPDATE users SET name=? WHERE id=?").bind(nm,u.id).run();await notify(env,u.id,"profile","Your display name is now "+nm+".");return json({ok:true,name:nm});}
  if(p==="privacy/export"&&m==="GET")return privacyExport(env,req,u);
  if(p==="privacy/location/delete"&&m==="POST")return privacyLocationDelete(env,req,u);
  if(p==="privacy/delete"&&m==="POST")return privacyDelete(env,req,u,b);
  if(p==="notifications"&&m==="GET"){const r=await env.DB.prepare("SELECT id,kind,text,ref,at,read FROM notifications WHERE uid=? ORDER BY at DESC LIMIT 100").bind(u.id).all();const c=await env.DB.prepare("SELECT COUNT(*) c FROM notifications WHERE uid=? AND read=0").bind(u.id).first();return json({items:r.results||[],unread:(c&&c.c)||0});}
  if(p==="notifications/read"&&m==="POST"){await env.DB.prepare("UPDATE notifications SET read=1 WHERE uid=? AND read=0").bind(u.id).run();return json({ok:true});}
  if(p==="me")return json(pubU(u,await repOf(env,u.id)));
  if(p==="stream"){
    const stub=env.USER_STREAM.get(env.USER_STREAM.idFromName(u.id));
    return stub.fetch(new Request("https://stream/stream"));
  }
  if(p==="location"&&m==="POST"){
    const la=b.lat,lo=b.lng;if(typeof la!=="number"||typeof lo!=="number"||!Number.isFinite(la)||!Number.isFinite(lo)||Math.abs(la)>90||Math.abs(lo)>180)err("Invalid location");
    await env.DB.prepare("UPDATE users SET lat=?,lng=?,at=? WHERE id=?").bind(+la.toFixed(4),+lo.toFixed(4),Date.now(),u.id).run();if(u.lat==null)await notify(env,u.id,"location","Location is on. You can now see cash nearby.");return json({ok:true});
  }
  if(p==="nearby"){
    const R=Math.min(+url.searchParams.get("r")||3,10), now=Date.now();
    const mine=await env.DB.prepare("SELECT id,type,amount,exp,status FROM listings WHERE uid=? AND status='open' AND exp>? ORDER BY exp").bind(u.id,now).all();
    if(u.lat==null)return json({items:[],mine:mine.results||[]});
    const rows=await env.DB.prepare("SELECT l.*,u.name,u.done,u.lat,u.lng,r.avg_stars,r.rating_count FROM listings l JOIN users u ON u.id=l.uid LEFT JOIN (SELECT ratee_uid,AVG(stars) avg_stars,COUNT(*) rating_count FROM ratings GROUP BY ratee_uid) r ON r.ratee_uid=u.id WHERE l.status='open' AND l.exp>? AND l.uid<>? LIMIT 500").bind(now,u.id).all();
    const items=[]; for(const l of rows.results||[]){if(l.lat==null||await blocked(env,u.id,l.uid))continue;const d=dist(u,l);const rating=Math.round((l.avg_stars||0)*10)/10,ratingCount=l.rating_count||0,trusted=(l.done||0)>=5&&rating>=4.5;if(d<=R)items.push({id:l.id,type:l.type,amount:l.amount,mins:Math.ceil((l.exp-now)/60000),km:Math.max(.01,Math.round(d*100)/100),brg:Math.round(bearing(u,l)),name:l.name,done:l.done||0,rating,ratingCount,trusted,area:l.area||''});}
    items.sort((a,b)=>a.km-b.km);return json({items,mine:mine.results||[]});
  }
  if(p==="listings"&&m==="POST"){
    await userActionLimit(env,u.id,"listing_create",10,10*60000);
    if(u.lat==null)err("Turn on location first");const amt=Math.floor(+b.amount),mins=Math.floor(+b.minutes);if(!["have","need"].includes(b.type)||!(amt>=1&&amt<=5000)||!(mins>=5&&mins<=240))err("Invalid post");
    const count=await env.DB.prepare("SELECT COUNT(*) c FROM listings WHERE uid=? AND status='open' AND exp>?").bind(u.id,Date.now()).first();if((count?.c||0)>=3)err("You can have up to 3 live posts");
    const l={id:id(),uid:u.id,type:b.type,amount:amt,exp:Date.now()+mins*60000,status:"open",area:clean(b.area).trim().slice(0,60)};await env.DB.prepare("INSERT INTO listings(id,uid,type,amount,exp,status,area) VALUES(?,?,?,?,?,?,?)").bind(l.id,l.uid,l.type,l.amount,l.exp,l.status,l.area||null).run();await notify(env,u.id,"post",(l.type==="have"?"Your cash offer of ₹":"Your cash request of ₹")+l.amount+" is live for "+mins+" min.",l.id);await broadcastListings(env);return json(l);
  }
  if(p==="listings/cancel"&&m==="POST"){
    const l=await env.DB.prepare("SELECT * FROM listings WHERE id=? AND uid=? AND status='open'").bind(String(b.id||"").slice(0,64),u.id).first();if(!l)err("Not found",404);await env.DB.prepare("UPDATE listings SET status='cancelled' WHERE id=?").bind(l.id).run();await notify(env,u.id,"post","You cancelled your ₹"+l.amount+" post.");await broadcastListings(env);return json({ok:true});
  }
  if(p==="threads"&&m==="POST"){
    await userActionLimit(env,u.id,"connect",20,10*60000);
    const l=await env.DB.prepare("SELECT * FROM listings WHERE id=? AND status='open' AND exp>?").bind(String(b.listingId||"").slice(0,64),Date.now()).first();if(!l||l.uid===u.id||await blocked(env,u.id,l.uid))err("This post is no longer available",409);
    const t={id:id(),lid:l.id,amount:l.amount,type:l.type,a:l.uid,b:u.id,status:"open",confirmed:"[]",created:Date.now()};
    const claimed=await env.DB.prepare("UPDATE listings SET status='matched' WHERE id=? AND status='open' AND exp>? AND uid<>?").bind(l.id,Date.now(),u.id).run();
    if(Number(claimed?.meta?.changes||0)!==1)err("This post is no longer available",409);
    try{await env.DB.prepare("INSERT INTO threads(id,lid,amount,type,a,b,status,confirmed,created) VALUES(?,?,?,?,?,?,?,?,?)").bind(t.id,t.lid,t.amount,t.type,t.a,t.b,t.status,t.confirmed,t.created).run();}
    catch(e){await env.DB.prepare("UPDATE listings SET status='open' WHERE id=? AND status='matched'").bind(l.id).run().catch(()=>{});throw e;}
    const own=await env.DB.prepare("SELECT name FROM users WHERE id=?").bind(l.uid).first();await notify(env,l.uid,"connect",u.name+(l.type==="have"?" requested your ₹":" offered cash for your ₹")+l.amount+(l.type==="have"?" cash. Open the chat to coordinate.":" request. Open the chat to coordinate."),t.id);await notify(env,u.id,"connect","You connected with "+(own&&own.name||"a user")+" for ₹"+l.amount+".",t.id);await broadcastListings(env);await push(env,l.uid,{t:"thread"});return json({id:t.id});
  }
  if(p==="threads"){
    const rows=await env.DB.prepare("SELECT t.*, ua.id a_id,ua.name a_name,ua.done a_done, ub.id b_id,ub.name b_name,ub.done b_done, ra.avg_stars a_avg,ra.rating_count a_cnt, rb.avg_stars b_avg,rb.rating_count b_cnt, (SELECT 1 FROM ratings WHERE tid=t.id AND rater_uid=?) rated_mine, (SELECT text FROM messages m WHERE m.tid=t.id ORDER BY m.at DESC LIMIT 1) last FROM threads t JOIN users ua ON ua.id=t.a JOIN users ub ON ub.id=t.b LEFT JOIN (SELECT ratee_uid,AVG(stars) avg_stars,COUNT(*) rating_count FROM ratings GROUP BY ratee_uid) ra ON ra.ratee_uid=ua.id LEFT JOIN (SELECT ratee_uid,AVG(stars) avg_stars,COUNT(*) rating_count FROM ratings GROUP BY ratee_uid) rb ON rb.ratee_uid=ub.id WHERE t.a=? OR t.b=? ORDER BY t.created DESC LIMIT 100").bind(u.id,u.id,u.id).all();
    return json({items:(rows.results||[]).map(t=>{const mine=t.a===u.id;const rating=Math.round(((mine?t.b_avg:t.a_avg)||0)*10)/10,ratingCount=(mine?t.b_cnt:t.a_cnt)||0;return{id:t.id,amount:t.amount,status:t.status,other:{id:mine?t.b_id:t.a_id,name:mine?t.b_name:t.a_name,done:(mine?t.b_done:t.a_done)||0,rating,ratingCount,trusted:((mine?t.b_done:t.a_done)||0)>=5&&rating>=4.5},last:t.last?t.last.slice(0,60):"",canRate:t.status==="completed"&&!t.rated_mine};})});
  }
  const P=p.split('/');
  if(P[0]==="threads"&&P[1]){
    const t=await env.DB.prepare("SELECT * FROM threads WHERE id=? AND (a=? OR b=?)").bind(P[1],u.id,u.id).first();if(!t)err("Not found",404);const oid=t.a===u.id?t.b:t.a;const o=await env.DB.prepare("SELECT id,name,phone,done FROM users WHERE id=?").bind(oid).first();
    if(!P[2]){const msgs=await env.DB.prepare("SELECT id,tid,from_uid AS \"from\",text,at FROM messages WHERE tid=? ORDER BY at DESC LIMIT 200").bind(t.id).all();const confirmed=JSON.parse(t.confirmed||"[]");
      const pinActive=!!(t.pin_hash&&t.pin_exp&&t.pin_exp>Date.now());
      const pin=pinActive?{active:true,mine:t.pin_by===u.id,exp:t.pin_exp,triesLeft:Math.max(0,5-(t.pin_tries||0))}:{active:false,mine:false,exp:null,triesLeft:5};
      pin.verified=!!t.pin_verified;
      const [rep,myRatingRow]=await Promise.all([repOf(env,oid),env.DB.prepare("SELECT stars FROM ratings WHERE tid=? AND rater_uid=?").bind(t.id,u.id).first()]);
      return json({id:t.id,amount:t.amount,status:t.status,confirmed,other:pubU(o,rep),pin,myRating:myRatingRow?myRatingRow.stars:null,canRate:t.status==="completed"&&!myRatingRow,msgs:(msgs.results||[]).reverse()});}
    if(P[2]==="messages"&&m==="POST"){
      await userActionLimit(env,u.id,"message",30,60*1000);
      const text=clean(b.text).trim().slice(0,500);if(!text)err("Type a message");if(t.status!=="open"||await blocked(env,u.id,oid))err("This chat is closed",409);
      const idm=id(),at=Date.now();await env.DB.prepare("INSERT INTO messages(id,tid,from_uid,text,at) VALUES(?,?,?,?,?)").bind(idm,t.id,u.id,text,at).run();const msg={id:idm,tid:t.id,from:u.id,text,at};await push(env,oid,{t:"msg",threadId:t.id,msg,from:u.name});await notify(env,oid,"message","New message from "+u.name+": "+text.slice(0,60),t.id);return json(msg);
    }
    if(P[2]==="complete"&&m==="POST"){
      if(t.status!=="open")err("This exchange is closed",409);
      if(!t.pin_verified)err("Verify the meetup PIN together first, then confirm the exchange.",409);
      let confirmed=JSON.parse(t.confirmed||"[]");if(!confirmed.includes(u.id))confirmed.push(u.id);let status=t.status;if(confirmed.length===2)status="completed";
      const stmts=[env.DB.prepare("UPDATE threads SET confirmed=?,status=? WHERE id=?").bind(JSON.stringify(confirmed),status,t.id)];if(status==="completed"){stmts.push(env.DB.prepare("UPDATE users SET done=done+1 WHERE id IN (?,?)").bind(u.id,oid));}await env.DB.batch(stmts);const onm=await env.DB.prepare("SELECT name FROM users WHERE id=?").bind(oid).first();if(status==="completed"){await notify(env,u.id,"exchange","Exchange completed: ₹"+t.amount+" with "+(onm&&onm.name||"the other person")+".",t.id);await notify(env,oid,"exchange","Exchange completed: ₹"+t.amount+" with "+u.name+".",t.id);}else{await notify(env,oid,"exchange",u.name+" confirmed the ₹"+t.amount+" exchange. Confirm on your side to complete it.",t.id);await notify(env,u.id,"exchange","You confirmed the exchange. Waiting for the other person.",t.id);}await push(env,oid,{t:"thread"});return json({ok:true});
    }
    if(P[2]==="pin"&&!P[3]&&m==="POST"){
      await userActionLimit(env,u.id,"pin_generate",5,15*60000);
      // Generate a fresh one-time meetup PIN. Only the plaintext code is ever returned, and only
      // to the person who generated it, once. The server stores just a hash, never the code itself.
      if(t.status!=="open")err("This exchange is closed",409);
      const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%9000+1000);
      const hash=await sha(code+t.id), exp=Date.now()+15*60000;
      await env.DB.prepare("UPDATE threads SET pin_hash=?,pin_by=?,pin_exp=?,pin_tries=0,pin_verified=0 WHERE id=?").bind(hash,u.id,exp,t.id).run();
      await notify(env,oid,"safety",u.name+" generated a meetup PIN. Ask them for it in person to confirm you're both there.",t.id);
      await notify(env,u.id,"safety","Meetup PIN generated. Show or tell it to "+(o&&o.name||"the other person")+" in person — do not send it in chat.",t.id);
      await push(env,oid,{t:"thread"});
      return json({code,exp});
    }
    if(P[2]==="pin"&&P[3]==="verify"&&m==="POST"){
      await userActionLimit(env,u.id,"pin_verify",10,15*60000);
      if(t.status!=="open")err("This exchange is closed",409);
      if(!t.pin_hash||!t.pin_exp||t.pin_exp<Date.now())err("No active PIN. Ask them to generate a new one.",410);
      if(t.pin_by===u.id)err("Ask the other person to enter the PIN on their device.",403);
      if((t.pin_tries||0)>=5){await env.DB.prepare("UPDATE threads SET pin_hash=NULL,pin_by=NULL,pin_exp=NULL,pin_tries=0 WHERE id=?").bind(t.id).run();err("Too many attempts. Ask for a new PIN.",429);}
      const code=String(b.code||"").trim();
      if(!/^\d{4}$/.test(code))err("Enter the 4-digit PIN");
      const hash=await sha(code+t.id);
      if(hash!==t.pin_hash){
        const tries=(t.pin_tries||0)+1;
        if(tries>=5){await env.DB.prepare("UPDATE threads SET pin_hash=NULL,pin_by=NULL,pin_exp=NULL,pin_tries=0 WHERE id=?").bind(t.id).run();err("Wrong PIN. Too many attempts — ask for a new one.",429);}
        await env.DB.prepare("UPDATE threads SET pin_tries=? WHERE id=?").bind(tries,t.id).run();
        err("Wrong PIN. "+(5-tries)+" attempt"+(5-tries===1?"":"s")+" left.",401);
      }
      // Correct PIN: the PIN is single-use, so it is wiped immediately and cannot be replayed.
      // Both people being able to produce/enter it in person is itself proof the exchange happened,
      // so this closes the exchange out for both sides right away — no separate manual confirm step.
      const completed=await env.DB.prepare("UPDATE threads SET pin_hash=NULL,pin_by=NULL,pin_exp=NULL,pin_tries=0,pin_verified=1,confirmed=?,status='completed' WHERE id=? AND status='open' AND pin_hash=?").bind(JSON.stringify([t.a,t.b]),t.id,t.pin_hash).run();
      if(Number(completed?.meta?.changes||0)!==1)err("This exchange was already completed",409);
      await env.DB.prepare("UPDATE users SET done=done+1 WHERE id IN (?,?)").bind(t.a,t.b).run();
      await notify(env,u.id,"exchange","Meetup PIN verified — exchange completed: ₹"+t.amount+" with "+(o&&o.name||"the other person")+".",t.id);
      await notify(env,oid,"exchange","Meetup PIN verified by "+u.name+" — exchange completed: ₹"+t.amount+".",t.id);
      await push(env,oid,{t:"thread"});
      return json({ok:true,completed:true});
    }
    if(P[2]==="rate"&&m==="POST"){
      await userActionLimit(env,u.id,"rate",20,60*60000);
      if(t.status!=="completed")err("You can rate this exchange once it's completed.",409);
      const stars=Math.round(Number(b.stars));
      if(!(stars>=1&&stars<=5))err("Choose a rating from 1 to 5 stars.",400);
      const tag=["friendly","fast","punctual","fair","other"].includes(b.tag)?b.tag:null;
      await env.DB.prepare("INSERT INTO ratings(tid,rater_uid,ratee_uid,stars,tag,at) VALUES(?,?,?,?,?,?) ON CONFLICT(tid,rater_uid) DO UPDATE SET stars=excluded.stars,tag=excluded.tag,at=excluded.at").bind(t.id,u.id,oid,stars,tag,Date.now()).run();
      await notify(env,oid,"rating","You received a "+stars+"★ rating from "+u.name+".",t.id);
      return json({ok:true});
    }
  }
  if(p==="report"&&m==="POST"){
    await userActionLimit(env,u.id,"report",5,60*60000);
    const t=await env.DB.prepare("SELECT * FROM threads WHERE id=? AND (a=? OR b=?)").bind(String(b.threadId||"").slice(0,64),u.id,u.id).first();
    if(!t)err("Not found",404);
    const oid=t.a===u.id?t.b:t.a;
    if(!["scam","counterfeit","suspicious_funds","fraud","harassment","unsafe","impersonation","privacy","other"].includes(b.reason))err("Choose a reason");
    const recent=await env.DB.prepare("SELECT 1 FROM reports WHERE by_uid=? AND tid=? AND at>? LIMIT 1").bind(u.id,t.id,Date.now()-86400000).first();
    if(recent)err("You already reported this conversation recently",409);
    const last=await env.DB.prepare("SELECT id,tid,from_uid AS \"from\",text,at FROM messages WHERE tid=? ORDER BY at DESC LIMIT 20").bind(t.id).all();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO reports(id,by_uid,who_uid,tid,reason,at,last_json) VALUES(?,?,?,?,?,?,?)").bind(id(),u.id,oid,t.id,b.reason,Date.now(),JSON.stringify((last.results||[]).reverse())),
      env.DB.prepare("INSERT OR IGNORE INTO blocks(by_uid,who_uid) VALUES(?,?)").bind(u.id,oid),
      env.DB.prepare("UPDATE threads SET status='closed' WHERE status='open' AND ((a=? AND b=?) OR (a=? AND b=?))").bind(u.id,oid,oid,u.id)
    ]);
    await notify(env,u.id,"safety","Report submitted and the user was blocked. Our team can review it.",t.id);
    await push(env,oid,{t:"thread"});
    return json({ok:true});
  }
  if(p==="block"&&m==="POST"){
    await userActionLimit(env,u.id,"block",30,60*60000);
    const who=String(b.userId||"");if(who===u.id)err("You cannot block yourself",400);if(!await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(who).first())err("Not found",404);
    await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO blocks(by_uid,who_uid) VALUES(?,?)").bind(u.id,who),env.DB.prepare("UPDATE threads SET status='closed' WHERE status='open' AND ((a=? AND b=?) OR (a=? AND b=?))").bind(u.id,who,who,u.id)]);
    await notify(env,u.id,"safety","You blocked a user. You will no longer see each other.");return json({ok:true});}
  err("Not found",404);
}
async function broadcastListings(env){
  // Push a lightweight refresh signal to currently known user IDs. This is intentionally bounded for the free tier.
  const r=await env.DB.prepare("SELECT id FROM users WHERE at>? LIMIT 200").bind(Date.now()-86400000).all();await Promise.all((r.results||[]).map(x=>push(env,x.id,{t:"listings"})));
}
export class UserStream extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.env=env;this.clients=new Set();}
  async fetch(req){
    const u=new URL(req.url);
    if(u.pathname==="/push"){const e=await req.json();for(const c of [...this.clients]){try{c.controller.enqueue(new TextEncoder().encode("data: "+JSON.stringify(e)+"\n\n"));}catch{this.clients.delete(c);}}return new Response("ok");}
    if(u.pathname==="/stream"){
      const enc=new TextEncoder(), self=this;
      let hb;
      const stream=new ReadableStream({start(controller){const item={controller};self.clients.add(item);controller.enqueue(enc.encode("retry: 3000\n\n"));hb=setInterval(()=>{try{controller.enqueue(enc.encode(": hb\n\n"));}catch{clearInterval(hb);self.clients.delete(item);}},25000);},cancel(){clearInterval(hb);for(const c of self.clients){if(c.controller===undefined)continue;}}});
      return new Response(stream,{headers:{...securityHeaders,"Content-Type":"text/event-stream","Cache-Control":"no-cache","Connection":"keep-alive","X-Accel-Buffering":"no"}});
    }
    return new Response("Not found",{status:404});
  }
}
export default {async fetch(req,env){const url=new URL(req.url);if(url.pathname==="/index.html"){return Response.redirect(new URL("/",url),301);}if(url.pathname==="/healthz"){let db=false,schema=false,error=null;const rid=requestId();try{await ensureSchema(env);db=true;schema=!!await env.DB.prepare("SELECT name FROM sqlite_master WHERE name='otps'").first();}catch(e){error=String(e&&e.message||e).slice(0,160);await recordObs(env,{kind:"health_failure",route:"/healthz",status:503,requestId:rid,message:error});}return json({ok:db&&schema,v:12,db,schema,devOtp:devOtpOn(env,url),devOtpConfigured:env.DEV_OTP==="true",error,requestId:rid});}if(url.pathname.startsWith("/api/")){const rid=requestId();try{await ensureSchema(env);return await api(env,req,url.pathname.slice(5),url);}catch(e){const status=Number(e&&e.status)||500;if(!e.status){console.error("Worker error:",e&&e.stack||e);await recordObs(env,{kind:"server_error",route:url.pathname,status,requestId:rid,message:e&&e.message||"Unhandled server error"});}return json({error:e.status?e.message:"Server error",requestId:rid},status);}}const res=await env.ASSETS.fetch(req);const headers=new Headers(res.headers);for(const [k,v] of Object.entries(securityHeaders)){if(!headers.has(k))headers.set(k,v);}if(/^\/admin\.(html|js|css)$/.test(url.pathname)){headers.set("Cache-Control","no-store");}else if(res.ok&&url.pathname!=="/"&&url.pathname!=="/index.html"){headers.set("Cache-Control","public, max-age=300, stale-while-revalidate=86400");}else{headers.set("Cache-Control","no-cache");}headers.set("X-Content-Type-Options","nosniff");return new Response(res.body,{status:res.status,statusText:res.statusText,headers});}};
