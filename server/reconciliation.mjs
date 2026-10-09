import {randomUUID,createHash} from 'node:crypto';
import {transaction} from './database.mjs';
function fail(message,status=400){throw Object.assign(Error(message),{status})}
function owned(db,actor,id){if(!db.sql.prepare('SELECT id FROM networks WHERE id=? AND owner_id=?').get(id,actor.userId))fail('الشبكة غير موجودة',404)}
function day(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('التاريخ غير صالح');const utc=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(utc)||new Date(utc).toISOString().slice(0,10)!==value)fail('التاريخ غير صالح');return utc-10800000}
export function importStatement(db,actor,input){
 const {networkId,provider,from,to,complete=false,csv}=input;owned(db,actor,networkId);
 if(typeof provider!=='string'||! /^[a-zA-Z0-9_-]{2,40}$/.test(provider)||typeof complete!=='boolean')fail('بيانات المزود غير صالحة');
 const start=day(from),end=day(to)+86400000;if(end<=start||end-start>31*86400000||end>Date.now())fail('اختر فترة مكتملة سابقة لا تتجاوز 31 يومًا');
 if(typeof csv!=='string'||Buffer.byteLength(csv)>60000)fail('الملف أكبر من الحد المسموح');
 const lines=csv.replace(/^\uFEFF/,'').trim().split(/\r?\n/);if(lines.shift()!=='reference,amount,status'||lines.length>500)fail('استخدم نموذج CSV: reference,amount,status وبحد أقصى 500 سطر');
 const rows=lines.filter(Boolean).map((line,i)=>{const fields=line.split(',');const [reference,amount,status]=fields;if(fields.length!==3||! /^[A-Za-z0-9_.:-]{1,150}$/.test(reference)||! /^[1-9]\d{0,8}$/.test(amount)||Number(amount)>100000000||!['received','failed','pending'].includes(status))fail('سطر غير صالح: '+(i+2));return {reference,amount:Number(amount),status}});
 const digest=createHash('sha256').update(JSON.stringify({provider,start,end,complete,rows})).digest('hex');
 return transaction(db.sql,()=>{const old=db.sql.prepare('SELECT id FROM reconciliation_runs WHERE network_id=? AND digest=?').get(networkId,digest);if(old)return {id:old.id,replayed:true};
 const locals=db.sql.prepare('SELECT p.* FROM payment_events p JOIN orders o ON o.id=p.order_id WHERE o.network_id=? AND p.provider=? AND p.created_at>=? AND p.created_at<?').all(networkId,provider,start,end);
 const map=new Map(locals.map(p=>[p.reference,p])),counts=new Map();for(const r of rows)counts.set(r.reference,(counts.get(r.reference)||0)+1);
 const cases=[];let matched=0;const seen=new Set();for(const r of rows){if(seen.has(r.reference))continue;seen.add(r.reference);const local=map.get(r.reference);let reason=null;
 if(counts.get(r.reference)>1)reason='duplicate_reference';else if(!local)reason='missing_local';else if(local.amount!==r.amount)reason='amount_mismatch';else if(r.status!=='received')reason='status_mismatch';else matched++;
 if(reason)cases.push({reference:r.reference,reason,local:local?.amount??null,reported:r.amount});}
 if(complete)for(const p of locals)if(!seen.has(p.reference))cases.push({reference:p.reference,reason:'missing_provider',local:p.amount,reported:null});
 const id=randomUUID();db.sql.prepare('INSERT INTO reconciliation_runs VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,networkId,provider,digest,start,end,Number(complete),rows.length,matched,Date.now());
 for(const [i,r] of rows.entries())db.sql.prepare('INSERT INTO reconciliation_rows VALUES(?,?,?,?,?)').run(id,i+1,r.reference,r.amount,r.status);
 for(const c of cases)db.sql.prepare('INSERT INTO reconciliation_cases(id,run_id,reference,reason,local_amount,reported_amount) VALUES(?,?,?,?,?,?)').run(randomUUID(),id,c.reference,c.reason,c.local,c.reported);
 return {id,replayed:false};});
}
export function reconciliationView(db,actor,networkId,runId=''){owned(db,actor,networkId);const runs=db.sql.prepare('SELECT r.*, (SELECT COUNT(*) FROM reconciliation_cases c WHERE c.run_id=r.id AND c.state=\'open\') open_count FROM reconciliation_runs r WHERE network_id=? ORDER BY created_at DESC LIMIT 30').all(networkId);if(!runId)return {runs};const run=db.sql.prepare('SELECT * FROM reconciliation_runs WHERE id=? AND network_id=?').get(runId,networkId);if(!run)fail('المراجعة غير موجودة',404);return {runs,run,cases:db.sql.prepare('SELECT * FROM reconciliation_cases WHERE run_id=? ORDER BY reference').all(runId),reviews:db.sql.prepare('SELECT v.* FROM reconciliation_reviews v JOIN reconciliation_cases c ON c.id=v.case_id WHERE c.run_id=? ORDER BY v.created_at').all(runId)};}
export function reviewCase(db,actor,{networkId,caseId,version,note}){owned(db,actor,networkId);if(typeof note!=='string'||note.trim().length<10||note.length>1000||!Number.isInteger(version))fail('اكتب سبب المراجعة من 10 إلى 1000 حرف');return transaction(db.sql,()=>{const c=db.sql.prepare('SELECT c.* FROM reconciliation_cases c JOIN reconciliation_runs r ON r.id=c.run_id WHERE c.id=? AND r.network_id=?').get(caseId,networkId);if(!c)fail('الفرق غير موجود',404);if(c.version!==version||c.state!=='open')fail('تمت مراجعة هذا الفرق مسبقًا. حدّث الصفحة',409);db.sql.prepare("UPDATE reconciliation_cases SET state='reviewed',version=version+1 WHERE id=?").run(caseId);db.sql.prepare('INSERT INTO reconciliation_reviews VALUES(?,?,?,?,?)').run(randomUUID(),caseId,actor.userId,note.trim(),Date.now());return {id:c.run_id};});}
