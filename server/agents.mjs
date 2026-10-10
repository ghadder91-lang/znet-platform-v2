import {randomUUID} from 'node:crypto';
import {transaction} from './database.mjs';

function reject(message,status=400){throw Object.assign(new Error(message),{status})}
function requireAdmin(db,actor){
 if(!actor?.userId||!db.sql.prepare("SELECT id FROM auth_users WHERE id=? AND role='admin'").get(actor.userId))reject('صلاحية المدير مطلوبة',403);
}
function safeId(value){if(typeof value!=='string'||value.length<1||value.length>100)reject('معرف غير صالح');return value}
function safeKey(value){if(typeof value!=='string'||value.length<16||value.length>100)reject('معرف الطلب غير صالح');return value}
function safeAmount(value){if(!Number.isSafeInteger(value)||value===0||Math.abs(value)>1000000000)reject('مبلغ غير صالح');return value}
function reasonText(value){if(typeof value!=='string'||value.trim().length<10||value.length>500)reject('سبب العملية يجب أن يكون من 10 إلى 500 حرف');return value.trim()}
export function agentBalance(db,actor,agentId){
 safeId(agentId);
 const agent=db.sql.prepare('SELECT * FROM agents WHERE id=?').get(agentId);
 if(!agent)reject('الوكيل غير موجود',404);
 if(agent.account_id!==actor?.userId)requireAdmin(db,actor);
 return db.sql.prepare('SELECT * FROM agent_balances WHERE agent_id=?').get(agentId);
}
export function createAgent(db,actor,{accountId,requestKey},now=Date.now()){
 requireAdmin(db,actor);safeId(accountId);safeKey(requestKey);
 return transaction(db.sql,()=>{
  requireAdmin(db,actor);
  if(!db.sql.prepare('SELECT id FROM auth_users WHERE id=?').get(accountId))reject('الحساب غير موجود',404);
  const existing=db.sql.prepare('SELECT * FROM agents WHERE account_id=?').get(accountId);
  if(existing)return existing;
  const id=randomUUID();
  db.sql.prepare('INSERT INTO agents(id,account_id,created_at) VALUES(?,?,?)').run(id,accountId,now);
  db.sql.prepare('INSERT INTO agent_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),id,actor.userId,'CREATE','إنشاء حساب وكيل معتمد من الإدارة',now);
  return db.sql.prepare('SELECT * FROM agents WHERE id=?').get(id);
 });
}
export function adjustAgent(db,actor,{agentId,action,amountMinor,creditLimitMinor,expectedVersion,requestKey,reason},now=Date.now()){
 requireAdmin(db,actor);safeId(agentId);safeKey(requestKey);reason=reasonText(reason);
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)reject('إصدار غير صالح');
 if(!['deposit','adjustment','repayment','set_credit_limit','suspend','resume'].includes(action))reject('عملية غير مدعومة');
 if(['deposit','adjustment','repayment'].includes(action)){
  safeAmount(amountMinor);
  if(action!=='adjustment'&&amountMinor<0)reject('يجب أن يكون المبلغ موجبًا');
 }
 if(action==='set_credit_limit'&&(!Number.isSafeInteger(creditLimitMinor)||creditLimitMinor<0||creditLimitMinor>1000000000))reject('حد ائتماني غير صالح');
 return transaction(db.sql,()=>{
  requireAdmin(db,actor);
  const agent=db.sql.prepare('SELECT * FROM agents WHERE id=?').get(agentId);
  if(!agent)reject('الوكيل غير موجود',404);
  const prior=db.sql.prepare('SELECT * FROM agent_audit WHERE agent_id=? AND action=? AND reason=?').get(agentId,'REQUEST:'+requestKey,reason);
  if(prior)reject('معرف طلب مستخدم مسبقًا',409);
  if(agent.version!==expectedVersion)reject('تغيرت بيانات الوكيل؛ حدّث الصفحة',409);
  const bal=db.sql.prepare('SELECT * FROM agent_balances WHERE agent_id=?').get(agentId);
  let limit=agent.credit_limit_minor,status=agent.status;
  if(['deposit','adjustment','repayment'].includes(action)){
   if(bal.spending_power_minor+amountMinor<0)reject('سيتجاوز الرصيد الحد الائتماني',409);
   db.sql.prepare('INSERT INTO agent_entries VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),agentId,action,amountMinor,reason,requestKey,actor.userId,now);
  }else if(action==='set_credit_limit'){
   if(bal.balance_minor+creditLimitMinor<0)reject('الحد الجديد أقل من المديونية',409);
   limit=creditLimitMinor;
  }else if(action==='suspend'){if(status==='suspended')reject('الوكيل موقوف بالفعل',409);status='suspended'}
  else{if(status==='active')reject('الوكيل نشط بالفعل',409);status='active'}
  db.sql.prepare('UPDATE agents SET credit_limit_minor=?,status=?,version=version+1 WHERE id=?').run(limit,status,agentId);
  db.sql.prepare('INSERT INTO agent_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),agentId,actor.userId,'REQUEST:'+requestKey,reason,now);
  return {agentId,status,version:agent.version+1,...db.sql.prepare('SELECT balance_minor,credit_limit_minor,spending_power_minor FROM agent_balances WHERE agent_id=?').get(agentId)};
 });
}
