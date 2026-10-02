import {execFileSync} from 'node:child_process';
import {createCipheriv,createHash,randomBytes,scryptSync} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';

const db=process.env.D1_DATABASE||'near-cash-db';
const bucket=process.env.R2_BUCKET;
const prefix=(process.env.R2_PREFIX||'near-cash/d1').replace(/\/+$/,'');
const pass=process.env.BACKUP_KEY;
if(!bucket||!pass) throw new Error('R2_BUCKET and BACKUP_KEY are required');
const work='.backup-work'; mkdirSync(work,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const sql=join(work,`near-cash-${stamp}.sql`), enc=join(work,`near-cash-${stamp}.sql.enc`), meta=join(work,`near-cash-${stamp}.json`);
try {
  execFileSync('npx',['wrangler','d1','export',db,'--remote','--output',sql],{stdio:'inherit'});
  const plaintext=readFileSync(sql);
  const salt=randomBytes(16),iv=randomBytes(12),key=scryptSync(pass,salt,32);
  const cipher=createCipheriv('aes-256-gcm',key,iv); const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]); const tag=cipher.getAuthTag();
  const envelope=Buffer.concat([Buffer.from('NCB1'),salt,iv,tag,ciphertext]);
  writeFileSync(enc,envelope);
  const sha256=createHash('sha256').update(envelope).digest('hex');
  const m={format:'NearCash-D1-Backup-v1',database:db,createdAt:new Date().toISOString(),sha256,bytes:envelope.length,encrypted:true,cipher:'AES-256-GCM',kdf:'scrypt'};
  writeFileSync(meta,JSON.stringify(m,null,2));
  execFileSync('npx',['wrangler','r2','object','put',`${bucket}/${prefix}/${enc.split('/').pop()}`,'--file',enc],{stdio:'inherit'});
  execFileSync('npx',['wrangler','r2','object','put',`${bucket}/${prefix}/${meta.split('/').pop()}`,'--file',meta],{stdio:'inherit'});
  // Keep a rolling 30-day encrypted backup set. Deletion is by object age only;
  // metadata and encrypted payloads are removed together.
  try {
    const raw=execFileSync('npx',['wrangler','r2','object','list',bucket,'--prefix',prefix+'/','--json'],{encoding:'utf8'});
    const parsed=JSON.parse(raw), objects=Array.isArray(parsed)?parsed:(parsed.objects||[]);
    const cutoff=Date.now()-30*86400000;
    for(const o of objects){
      const key=String(o.key||''); const when=Date.parse(o.uploaded||o.createdAt||'');
      if(key && Number.isFinite(when) && when<cutoff) execFileSync('npx',['wrangler','r2','object','delete',`${bucket}/${key}`],{stdio:'inherit'});
    }
  } catch(e) { console.warn('backup retention cleanup skipped:',e.message); }
  console.log(JSON.stringify(m));
} finally { for(const f of [sql,enc,meta]){try{rmSync(f)}catch{}} }
