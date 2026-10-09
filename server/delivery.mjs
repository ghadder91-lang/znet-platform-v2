import {randomUUID} from 'node:crypto';
import {transaction} from './database.mjs';
import {unsealValue} from './vault.mjs';
const maxAttempts=5,leaseMs=60000;
export function enqueueDeliveries(sql,orderId,now){for(const channel of ['wallet','sms'])sql.prepare("INSERT OR IGNORE INTO delivery_jobs(id,order_id,channel,status,next_at,created_at,updated_at) VALUES(?,?,?,'pending',?,?,?)").run(randomUUID(),orderId,channel,now,now,now);}
export function deliveryPayload(db,orderId,vaultKey){const o=db.sql.prepare("SELECT o.*,v.sealed FROM orders o JOIN vouchers v ON v.id=o.voucher_id WHERE o.id=? AND o.status='paid'").get(orderId);if(!o)throw Error('ORDER_NOT_PAID');const card=unsealValue(o.sealed,vaultKey,o.network_id+':'+o.voucher_id);const destination=o.destination_sealed?unsealValue(o.destination_sealed,vaultKey,'order:'+o.id):{};return {orderId:o.id,provider:o.provider,customerRef:o.customer_ref,phone:destination.phone,...card};}
export async function runDeliveryBatch(db,{vaultKey,smsAdapter,now=Date.now(),limit=20,orderId=null}){
 // Claim before any external work. A crashed process's lease expires; the same job id
 // is the provider idempotency key on every attempt, including uncertain outcomes.
 const jobs=transaction(db.sql,()=>{
  const exhausted=db.sql.prepare("SELECT * FROM delivery_jobs WHERE status='processing' AND lease_until<=? AND attempts>=? AND (? IS NULL OR order_id=?)").all(now,maxAttempts,orderId,orderId);
  for(const j of exhausted){db.sql.prepare("UPDATE delivery_jobs SET status='dead',last_error='LEASE_EXHAUSTED',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now,j.id);db.sql.prepare('INSERT INTO incidents VALUES(?,?,?,?,?,?)').run(randomUUID(),db.sql.prepare('SELECT network_id FROM orders WHERE id=?').get(j.order_id).network_id,j.order_id,'DELIVERY_'+j.channel.toUpperCase()+'_LEASE_EXHAUSTED','open',now);}
  const rows=db.sql.prepare("SELECT * FROM delivery_jobs WHERE ((status IN ('pending','retry') AND next_at<=?) OR (status='processing' AND lease_until<=?)) AND attempts<? AND (? IS NULL OR order_id=?) ORDER BY next_at,id LIMIT ?").all(now,now,maxAttempts,orderId,orderId,Math.min(50,Math.max(1,limit)));
  return rows.map(j=>{const token=randomUUID();db.sql.prepare("UPDATE delivery_jobs SET status='processing',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?").run(token,now+leaseMs,now,j.id);return {...j,lease_token:token,attempts:j.attempts+1};});
 });
 for(const j of jobs){let result='available',error=null;
  try{const payload=deliveryPayload(db,j.order_id,vaultKey);
   if(j.channel==='sms'){if(!smsAdapter)throw Error('SMS_NOT_CONFIGURED');const receipt=await smsAdapter.send({idempotencyKey:j.id,...payload});if(!receipt||receipt.status!=='delivered')throw Error('SMS_DELIVERY_UNCONFIRMED');result='delivered';}
  }catch(e){error=['SMS_NOT_CONFIGURED','SMS_DELIVERY_UNCONFIRMED','SIMULATED_SMS_FAILURE'].includes(e?.message)?e.message:'DELIVERY_FAILED';result=j.attempts>=maxAttempts?'dead':'retry';}
  transaction(db.sql,()=>{const changed=db.sql.prepare('UPDATE delivery_jobs SET status=?,next_at=?,lease_token=NULL,lease_until=NULL,last_error=?,updated_at=? WHERE id=? AND status=? AND lease_token=?').run(result,now+Math.min(3600000,30000*2**(j.attempts-1)),error,now,j.id,'processing',j.lease_token);if(!changed.changes)return;
   db.sql.prepare('INSERT INTO delivery_attempts VALUES(?,?,?,?,?,?)').run(randomUUID(),j.id,j.attempts,result,error,now);
   if(result==='dead'){const n=db.sql.prepare('SELECT network_id FROM orders WHERE id=?').get(j.order_id);db.sql.prepare('INSERT INTO incidents VALUES(?,?,?,?,?,?)').run(randomUUID(),n.network_id,j.order_id,'DELIVERY_'+j.channel.toUpperCase()+'_FAILED','open',now);}
  });
 }
 return {processed:jobs.length};
}
export function sandboxSmsAdapter(db){return {async send(payload){const result=transaction(db.sql,()=>{
 const existing=db.sql.prepare('SELECT receipt_id FROM delivery_receipts WHERE job_id=?').get(payload.idempotencyKey);if(existing)return {status:'delivered',receiptId:existing.receipt_id,simulated:true};
 const failures=db.sql.prepare('SELECT sms_failures FROM sandbox_controls WHERE order_id=?').get(payload.orderId)?.sms_failures||0;
 if(failures>0){db.sql.prepare('UPDATE sandbox_controls SET sms_failures=sms_failures-1 WHERE order_id=?').run(payload.orderId);return {failed:true};}
 const receipt='sandbox-'+randomUUID();db.sql.prepare('INSERT INTO delivery_receipts VALUES(?,?,?)').run(payload.idempotencyKey,receipt,Date.now());return {status:'delivered',receiptId:receipt,simulated:true};
 });if(result.failed)throw Error('SIMULATED_SMS_FAILURE');return result;}}}
