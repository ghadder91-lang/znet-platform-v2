import {randomUUID,createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import {openDatabase} from './database.mjs';
import {vaultKey} from './config.mjs';
import {deriveSandboxKey} from './vault.mjs';
import {handleCore} from './core.mjs';
import {partnerOrder,paymentCallback,signEvent,walletResult,walletAcknowledge} from './partner-protocol.mjs';
import {runDeliveryBatch,sandboxSmsAdapter} from './delivery.mjs';
import {CommerceError} from './commerce.mjs';
export function sandboxContext(){
 if(process.env.SANDBOX_ENABLED!=='true')throw new CommerceError('مختبر الربط غير مفعّل. اضبط SANDBOX_ENABLED=true على الخادم.',503);
 const path=process.env.SANDBOX_DATABASE_PATH||'./data/sandbox.sqlite';if(resolve(path)===resolve(process.env.DATABASE_PATH||'./data/znet.sqlite'))throw new CommerceError('قاعدة المختبر يجب أن تكون منفصلة.',503);
 globalThis.__znetSandbox??=openDatabase(path);const key=deriveSandboxKey(vaultKey()),derive=label=>createHmac('sha256',Buffer.from(key,'base64')).update(label).digest('hex');
 return {db:globalThis.__znetSandbox,config:{id:'sandbox',mode:'sandbox',merchantId:'znet-sandbox',vaultKey:key,apiKey:derive('api-key'),webhookSecret:derive('webhook')}};
}
async function core(db,actor,config,op,data){const r=await handleCore(new Request('https://sandbox.local/api/core',{method:'POST',headers:{origin:'https://sandbox.local','content-type':'application/json'},body:JSON.stringify({op,...data})}),db,actor,{vaultKey:config.vaultKey});const d=await r.json();if(!r.ok)throw new CommerceError(d.error,r.status);return d;}
export async function ensureLab(db,actor,config){
 let n=db.sql.prepare('SELECT * FROM networks WHERE owner_id=? LIMIT 1').get(actor.userId);
 if(!n){const r=await core(db,actor,config,'createNetwork',{name:'شبكة اختبار الربط',phone:'770000000',province:'مختبر',district:'تجريبي'});db.sql.prepare("UPDATE networks SET status='active' WHERE id=?").run(r.id);n=db.sql.prepare('SELECT * FROM networks WHERE id=?').get(r.id);}
 let c=db.sql.prepare('SELECT * FROM categories WHERE network_id=? LIMIT 1').get(n.id);
 if(!c){const r=await core(db,actor,config,'createCategory',{networkId:n.id,name:'كرت اختبار 500',price:500,dataMb:500,hours:5,validDays:3,lowThreshold:2});c=db.sql.prepare('SELECT * FROM categories WHERE id=?').get(r.id);}
 return {network:n,category:c};
}
function ownOrder(db,actor,id){const o=db.sql.prepare('SELECT o.* FROM orders o JOIN networks n ON n.id=o.network_id WHERE o.id=? AND n.owner_id=?').get(id,actor.userId);if(!o)throw new CommerceError('طلب الاختبار غير موجود.',404);return o;}
export function labState(db,actor){const n=db.sql.prepare('SELECT id FROM networks WHERE owner_id=? LIMIT 1').get(actor.userId);if(!n)return {ready:false,orders:[],stock:0};
 db.sql.prepare("UPDATE orders SET status='expired' WHERE network_id=? AND status='pending' AND expires_at<=?").run(n.id,Date.now());
 const orders=db.sql.prepare('SELECT id,amount,status,created_at FROM orders WHERE network_id=? ORDER BY created_at DESC LIMIT 30').all(n.id);
 for(const o of orders){o.deliveries=db.sql.prepare('SELECT channel,status,attempts,last_error,next_at,acknowledged_at FROM delivery_jobs WHERE order_id=?').all(o.id);o.attemptLog=db.sql.prepare('SELECT a.attempt,a.result,a.error_code,a.created_at,j.channel FROM delivery_attempts a JOIN delivery_jobs j ON a.job_id=j.id WHERE j.order_id=? ORDER BY a.created_at DESC LIMIT 10').all(o.id);}
 const totals=db.sql.prepare('SELECT account,SUM(debit) debit,SUM(credit) credit FROM ledger_entries WHERE network_id=? GROUP BY account').all(n.id);
 return {ready:true,orders,stock:db.sql.prepare("SELECT COUNT(*) n FROM vouchers WHERE network_id=? AND status='available'").get(n.id).n,totals};
}
export async function labAction(db,actor,config,data){
 const auth='Bearer '+config.apiKey;
 if(data.op==='seed'){const s=await ensureLab(db,actor,config);const count=db.sql.prepare('SELECT COUNT(*) n FROM vouchers WHERE network_id=?').get(s.network.id).n;if(count>=100)throw new CommerceError('الحد 100 كرت تجريبي لهذا الحساب.');await core(db,actor,config,'import',{networkId:s.network.id,categoryId:s.category.id,raw:Array.from({length:10},()=>('TEST-'+randomUUID())+',test-only').join('\n'),requestKey:randomUUID()});return {ok:true};}
 if(data.op==='create'){const s=await ensureLab(db,actor,config);if(![0,1,5].includes(data.smsFailures))throw new CommerceError('سيناريو غير صالح.');
 const o=partnerOrder(db,auth,config,actor,{networkId:s.network.id,categoryId:s.category.id,requestKey:data.requestKey,customerRef:'customer-'+actor.userId,phone:'+967770000000'});db.sql.prepare('INSERT OR IGNORE INTO sandbox_controls VALUES(?,?)').run(o.orderId,data.smsFailures);return o;
 }
 const order=ownOrder(db,actor,data.orderId);
 if(data.op==='pay'){
  const event={eventId:'evt-'+order.id,paymentId:'pay-'+order.id,type:'payment.succeeded',merchantId:config.merchantId,orderId:order.id,customerRef:order.customer_ref,currency:'YER',amount:order.amount};
  const raw=JSON.stringify(event),ts=String(Math.floor(Date.now()/1000));const r=await paymentCallback(new Request('https://sandbox.local/api/partners/sandbox/payments',{method:'POST',headers:{'x-znet-timestamp':ts,'x-znet-signature':signEvent(config.webhookSecret,ts,raw)},body:raw}),db,config);const d=await r.json();if(!r.ok)throw new CommerceError(d.error,r.status);return d;
 }
 if(data.op==='run')return runDeliveryBatch(db,{vaultKey:config.vaultKey,smsAdapter:sandboxSmsAdapter(db),orderId:order.id});
 if(data.op==='wallet'){const result=walletResult(db,auth,config,order.id,order.customer_ref);if(result.username)walletAcknowledge(db,auth,config,order.id,order.customer_ref);return result;}
 throw new CommerceError('عملية غير معروفة.');
}
