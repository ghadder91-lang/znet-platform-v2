import {randomUUID} from 'node:crypto';
import {transaction} from './database.mjs';
const DAY=86400000, OFFSET=10800000, INTERVAL=900000;
function fail(message,status=400){throw Object.assign(Error(message),{status})}
function integer(v,min,max){return Number.isSafeInteger(v)&&v>=min&&v<=max}
function network(db,actor,id){const n=db.sql.prepare('SELECT * FROM networks WHERE id=? AND owner_id=?').get(id,actor.userId);if(!n)fail('الشبكة غير موجودة',404);return n}
function category(db,networkId,id){const c=db.sql.prepare('SELECT * FROM categories WHERE id=? AND network_id=?').get(id,networkId);if(!c)fail('الفئة غير موجودة',404);return c}
function policy(db,c){return db.sql.prepare('SELECT * FROM inventory_policies WHERE category_id=?').get(c.id)||{category_id:c.id,network_id:c.network_id,enabled:0,target_days:2,max_stock:5000,max_replenish:500,version:0,next_at:0,updated_at:null}}
export function forecastWindow(createdAt,now){const end=Math.floor((now+OFFSET)/DAY)*DAY-OFFSET;const firstFullDay=Math.ceil((createdAt+OFFSET)/DAY)*DAY-OFFSET;const start=Math.min(end,Math.max(end-7*DAY,firstFullDay));return {start,end,days:Math.round((end-start)/DAY)}}
// A transparent trailing average, not a learned model. No inferred stockout dates
// are emitted until there are at least three full observation days and five sales.
export function calculateForecast({stock,sales,days,targetDays,maxStock,maxReplenish,threshold}){
 const ready=days>=3&&sales>=5, rate=days>0?sales/days:0;
 const desired=ready?Math.ceil(sales*targetDays/days):null;
 const needed=ready?Math.max(0,desired-stock):0;
 const suggested=ready?Math.max(0,Math.min(needed,maxReplenish,maxStock-stock)):0;
 const state=stock===0?'empty':!ready?(stock<=threshold?'low_static':'learning'):needed>0?'at_risk':'healthy';
 return {state,ready,stock,sales,days,dailyRate:ready?rate:null,coverageHours:ready?stock/rate*24:null,desired,needed,suggested,limited:suggested<needed,reason:ready?'trailing_average':days<3?'insufficient_days':'insufficient_sales'};
}
function snapshot(db,c,p,now){const w=forecastWindow(c.created_at,now);const stock=db.sql.prepare("SELECT COUNT(*) n FROM vouchers WHERE network_id=? AND category_id=? AND status='available'").get(c.network_id,c.id).n;
 const sales=db.sql.prepare("SELECT COUNT(*) n FROM orders WHERE network_id=? AND category_id=? AND status='paid' AND voucher_id IS NOT NULL AND paid_at>=? AND paid_at<?").get(c.network_id,c.id,w.start,w.end).n;
 return {...calculateForecast({stock,sales,days:w.days,targetDays:p.target_days,maxStock:p.max_stock,maxReplenish:p.max_replenish,threshold:c.low_threshold}),windowStart:w.start,windowEnd:w.end,asOf:now,method:'completed-days-average-v1',policy:{targetDays:p.target_days,maxStock:p.max_stock,maxReplenish:p.max_replenish,version:p.version}};
}
export function forecastView(db,actor,networkId,page=1,now=Date.now()){
 network(db,actor,networkId);if(!integer(page,1,100000))fail('رقم الصفحة غير صالح');
 return transaction(db.sql,()=>{const n=network(db,actor,networkId);const categories=db.sql.prepare('SELECT * FROM categories WHERE network_id=? ORDER BY created_at,id LIMIT 12 OFFSET ?').all(networkId,(page-1)*12);return {networkStatus:n.suspended_at!==null?'suspended':n.status,page,total:db.sql.prepare('SELECT COUNT(*) n FROM categories WHERE network_id=?').get(networkId).n,asOf:now,rows:categories.map(c=>{const p=policy(db,c);const history=db.sql.prepare('SELECT * FROM inventory_evaluations WHERE network_id=? AND category_id=? ORDER BY created_at DESC,id DESC LIMIT 5').all(networkId,c.id).map(r=>({...r,snapshot:JSON.parse(r.snapshot)}));return {id:c.id,name:c.name,price:c.price,policy:p,forecast:snapshot(db,c,p,now),history}})};});
}
export function savePolicy(db,actor,input,now=Date.now()){
 const {networkId,categoryId,enabled,targetDays,maxStock,maxReplenish,expectedVersion}=input;
 network(db,actor,networkId);if(typeof enabled!=='boolean'||!integer(targetDays,1,14)||!integer(maxStock,1,100000)||!integer(maxReplenish,1,10000)||maxReplenish>maxStock||!integer(expectedVersion,0,Number.MAX_SAFE_INTEGER))fail('تحقق من أيام التغطية وحدود المخزون والتجديد');
 return transaction(db.sql,()=>{const c=category(db,networkId,categoryId),p=policy(db,c);if(p.version!==expectedVersion)fail('تغيرت السياسة من جلسة أخرى. حدّث البيانات قبل الحفظ',409);
 const version=p.version+1;db.sql.prepare('INSERT INTO inventory_policies VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(category_id) DO UPDATE SET enabled=excluded.enabled,target_days=excluded.target_days,max_stock=excluded.max_stock,max_replenish=excluded.max_replenish,version=excluded.version,next_at=0,updated_at=excluded.updated_at').run(categoryId,networkId,Number(enabled),targetDays,maxStock,maxReplenish,version,0,now);
 db.sql.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?)').run(randomUUID(),networkId,actor.userId,'INVENTORY_POLICY_UPDATED',JSON.stringify({categoryId,enabled,targetDays,maxStock,maxReplenish,version}),now);return {version};});
}
function evaluate(db,c,p,source,now){
 const old=db.sql.prepare('SELECT * FROM inventory_evaluations WHERE category_id=? ORDER BY created_at DESC,id DESC LIMIT 1').get(c.id);
 if(old&&old.policy_version===p.version&&old.created_at+INTERVAL>now)return {id:old.id,replayed:true,snapshot:JSON.parse(old.snapshot)};
 const result=snapshot(db,c,p,now),id=randomUUID();db.sql.prepare('INSERT INTO inventory_evaluations VALUES(?,?,?,?,?,?,?)').run(id,c.network_id,c.id,p.version,source,JSON.stringify(result),now);
 db.sql.prepare('UPDATE inventory_policies SET next_at=? WHERE category_id=?').run(now+INTERVAL,c.id);
 // Bounded operational history: retain the newest 100 evaluations per category.
 db.sql.prepare('DELETE FROM inventory_evaluations WHERE category_id=? AND id NOT IN (SELECT id FROM inventory_evaluations WHERE category_id=? ORDER BY created_at DESC,id DESC LIMIT 100)').run(c.id,c.id);
 return {id,replayed:false,snapshot:result};
}
export function evaluatePolicy(db,actor,{networkId,categoryId},now=Date.now()){
 network(db,actor,networkId);return transaction(db.sql,()=>{const c=category(db,networkId,categoryId),p=policy(db,c);if(!p.version)fail('احفظ السياسة أولًا',409);return evaluate(db,c,p,'manual',now)});
}
export function runForecastBatch(db,{now=Date.now(),limit=100}={}){
 if(!integer(limit,1,100))fail('حجم الدفعة غير صالح');const due=db.sql.prepare("SELECT p.category_id FROM inventory_policies p JOIN networks n ON n.id=p.network_id WHERE p.enabled=1 AND p.next_at<=? AND n.status='active' AND n.suspended_at IS NULL ORDER BY p.next_at,p.category_id LIMIT ?").all(now,limit);
 let evaluated=0;for(const row of due){transaction(db.sql,()=>{const p=db.sql.prepare('SELECT p.* FROM inventory_policies p JOIN networks n ON n.id=p.network_id WHERE p.category_id=? AND p.enabled=1 AND p.next_at<=? AND n.status=\'active\' AND n.suspended_at IS NULL').get(row.category_id,now);if(!p)return;const c=category(db,p.network_id,p.category_id);const result=evaluate(db,c,p,'worker',now);if(!result.replayed)evaluated++;});}return {evaluated};
}
