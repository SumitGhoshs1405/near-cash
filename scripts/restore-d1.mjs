import {execFileSync} from 'node:child_process';
import {createDecipheriv,createHash,scryptSync} from 'node:crypto';
import {readFileSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';

const file=process.argv[2];
const db=process.env.D1_DATABASE||'near-cash-db';
const pass=process.env.BACKUP_KEY;
if(!file||!pass) throw new Error('Usage: BACKUP_KEY=... node scripts/restore-d1.mjs backup.enc');
const env=readFileSync(file); if(env.subarray(0,4).toString()!=='NCB1') throw new Error('Invalid backup format');
const salt=env.subarray(4,20),iv=env.subarray(20,32),tag=env.subarray(32,48),ciphertext=env.subarray(48);
const key=scryptSync(pass,salt,32),dec=createDecipheriv('aes-256-gcm',key,iv);dec.setAuthTag(tag);
const sql=join('.backup-work','restore.sql');
mkdirSync('.backup-work',{recursive:true});
writeFileSync(sql,Buffer.concat([dec.update(ciphertext),dec.final()]));
try { execFileSync('npx',['wrangler','d1','execute',db,'--remote','--file',sql],{stdio:'inherit'}); } finally {try{rmSync(sql)}catch{}}
console.log(`Restore applied to ${db}. Run the post-restore checks in docs/internal/08-business-continuity-and-recovery.md.`);
