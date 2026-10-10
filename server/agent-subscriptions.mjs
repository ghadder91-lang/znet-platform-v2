import {randomUUID} from 'node:crypto';
import {transaction} from './database.mjs';
function fail(message,status=400){throw Object.assign(new Error(message),{status})}
function id(v){if(typeof v!=='string'||v.length<1||v.length>100)fail('معرف غير صالح');return v}
function key(v){if(typeof v!=='string'||v.length<16||v.length>100)fail('معرف الطلب غير صالح');return v}
function admin(db,actor){if(!actor?.userId||!db.sql.prepare("SELECT id FROM auth_users WHERE id=? AND role='admin'").get(actor.userId))fail('صلاحية المدير مطلوبة',403)}
export function issueAgentSubscription(db,actor,{agentId,networkId,planId,requestKey},now=Date.now()){
 admin(db,actor);id(agentId);id(networkId);id(planId);key(requestKey);
 if(!Number.isSafeInteger(now)||now<0)fail('توقيت غير صالح');
 return transaction(db.sql,()=>{
  admin(db,actor);
  const existing=db.sql.prepare('SELECT * FROM agent_subscriptions WHERE agent_id=? AND request_key=?').get(agentId,requestKey);
  if(existing){if(existing.network_id!==networkId||existing.plan_id!==planId)fail('تعارض في معرف الطلب',409);return {...existing,replayed:true}}
  const a=db.sql.prepare('SELECT * FROM agents WHERE id=?').get(agentId);
  if(!a)fail('الوكيل غير موجود',404);
  if(a.status!=='active')fail('الوكيل موقوف',409);
  const n=db.sql.prepare('SELECT id,status,suspended_at FROM networks WHERE id=?').get(networkId);
  if(!n)fail('الشبكة غير موجودة',404);
  if(n.status!=='active'||n.suspended_at!==null)fail('الشبكة غير نشطة',409);
  const plan=db.sql.prepare('SELECT * FROM subscription_plans WHERE id=?').get(planId);
  if(!plan||plan.enabled!==1)fail('الباقة غير متاحة',409);
  const bal=db.sql.prepare('SELECT spending_power_minor FROM agent_balances WHERE agent_id=?').get(agentId);
  if(!Number.isSafeInteger(bal.spending_power_minor)||bal.spending_power_minor<plan.price_minor)fail('الرصيد المتاح لا يكفي',409);
  const latest=db.sql.prepare('SELECT MAX(ends_at) AS end_at FROM agent_subscriptions WHERE network_id=?').get(networkId);
  const starts=Math.max(now,latest.end_at||0),ends=starts+plan.duration_days*86400000;
  if(!Number.isSafeInteger(ends))fail('تاريخ انتهاء غير صالح');
  const subId=randomUUID();
  db.sql.prepare('INSERT INTO agent_subscriptions VALUES(?,?,?,?,?,?,?,?)').run(subId,agentId,networkId,planId,requestKey,starts,ends,now);
  if(plan.price_minor>0)db.sql.prepare('INSERT INTO agent_entries VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),agentId,'subscription_debit',-plan.price_minor,'اشتراك منصة زد نت: '+subId,requestKey,actor.userId,now);
  db.sql.prepare('INSERT INTO agent_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),agentId,actor.userId,'SUBSCRIPTION_ISSUED','إصدار اشتراك محاسبي '+subId,now);
  return {id:subId,agent_id:agentId,network_id:networkId,plan_id:planId,starts_at:starts,ends_at:ends,replayed:false,activationStatus:'NOT_CONNECTED'};
 });
}
