import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
import {transaction} from './database.mjs';
import {recordVerifiedPayment,createOrder,CommerceError} from './commerce.mjs';
import {deliveryPayload} from './delivery.mjs';
import {boundedBody} from './request-guards.mjs';
export const signEvent=(secret,timestamp,raw)=>createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex');
function same(a,b){return typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function requirePartner(auth,config){if(!config?.apiKey||!same(auth,'Bearer '+config.apiKey))throw new CommerceError('غير مصرح.',401);}
const validString=(s,min=1,max=150)=>typeof s==='string'&&s.length>=min&&s.length<=max;
export async function paymentCallback(request,db,config,{now=Date.now()}={}){
 const response=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(!config||config.mode!=='sandbox')return response({error:'التكامل غير مفعّل.'},503);
 try{
 if(request.method!=='POST')throw new CommerceError('طريقة غير مسموحة.',405);
 const raw=await boundedBody(request,8192),ts=request.headers.get('x-znet-timestamp'),signature=request.headers.get('x-znet-signature');
 if(!/^\d{10}$/.test(ts||'')||Math.abs(Math.floor(now/1000)-Number(ts))>300||!same(signature,signEvent(config.webhookSecret,ts,raw)))throw new CommerceError('توقيع غير صالح أو منتهي.',401);
 const e=JSON.parse(raw);if(e?.type!=='payment.succeeded'||e.currency!=='YER'||e.merchantId!==config.merchantId||!validString(e.eventId)||!validString(e.paymentId)||!validString(e.orderId)||!Number.isSafeInteger(e.amount)||e.amount<1)throw new CommerceError('بيانات إشعار الدفع غير صالحة.');
 const hash=createHash('sha256').update(raw).digest('hex');
 const result=transaction(db.sql,()=>{
 const o=db.sql.prepare('SELECT provider,customer_ref FROM orders WHERE id=?').get(e.orderId);if(!o||o.provider!==config.id||o.customer_ref!==e.customerRef)throw new CommerceError('مرجع الطلب لا يطابق هذا التكامل.',404);
 const old=db.sql.prepare('SELECT payload_hash FROM webhook_receipts WHERE provider=? AND event_id=?').get(config.id,e.eventId);if(old&&old.payload_hash!==hash)throw new CommerceError('معرف الإشعار مستخدم لمحتوى مختلف.',409);
 const r=recordVerifiedPayment(db,{provider:config.id,reference:e.paymentId,orderId:e.orderId,amount:e.amount},{withinTransaction:true});
 if(!old)db.sql.prepare('INSERT INTO webhook_receipts VALUES(?,?,?,?,?)').run(config.id,e.eventId,hash,e.orderId,now);
 return {...r,eventReplayed:!!old};
 });return response(result);
 }catch(e){return response({error:e instanceof CommerceError?e.message:'تعذر قبول الإشعار.'},e instanceof CommerceError?e.status:400)}
}
export function partnerOrder(db,authorization,config,owner,{networkId,categoryId,requestKey,customerRef,phone}){
 requirePartner(authorization,config);if(config.mode!=='sandbox')throw new CommerceError('التكامل غير مفعّل.',503);
 if(!validString(customerRef,8,120)||typeof phone!=='string'||!/^\+?9677\d{8}$/.test(phone))throw new CommerceError('مرجع العميل أو رقم الهاتف غير صالح.');
 // owner is resolved by a trusted service binding, never accepted from public JSON.
 const o=createOrder(db,owner,{networkId,categoryId,requestKey},500,{provider:config.id,customerRef,phone,vaultKey:config.vaultKey});
 return {orderId:o.id,amount:o.amount,currency:'YER',status:o.status,expiresAt:o.expires_at,mode:'sandbox'};
}
export function walletResult(db,authorization,config,orderId,customerRef){requirePartner(authorization,config);
 const o=db.sql.prepare('SELECT * FROM orders WHERE id=? AND provider=? AND customer_ref=?').get(orderId,config.id,customerRef);if(!o)throw new CommerceError('الطلب غير موجود.',404);
 const job=db.sql.prepare("SELECT id,status FROM delivery_jobs WHERE order_id=? AND channel='wallet'").get(orderId);
 if(o.status!=='paid'||!job||!['available','delivered'].includes(job.status))return {orderId,status:o.status,delivery:'not_ready',mode:'sandbox'};
 const payload=deliveryPayload(db,orderId,config.vaultKey);
 db.sql.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),o.network_id,'provider:'+config.id,'WALLET_RESULT_READ','عرض نتيجة الطلب '+orderId,Date.now());
 return {orderId,status:'paid',delivery:job.status,username:payload.username,password:payload.password,mode:'sandbox'};
}
export function walletAcknowledge(db,authorization,config,orderId,customerRef){requirePartner(authorization,config);const now=Date.now();return transaction(db.sql,()=>{
 const o=db.sql.prepare('SELECT id FROM orders WHERE id=? AND provider=? AND customer_ref=?').get(orderId,config.id,customerRef);if(!o)throw new CommerceError('الطلب غير موجود.',404);
 const j=db.sql.prepare("SELECT id,status FROM delivery_jobs WHERE order_id=? AND channel='wallet'").get(orderId);if(!j||!['available','delivered'].includes(j.status))throw new CommerceError('النتيجة غير جاهزة.',409);
 db.sql.prepare("UPDATE delivery_jobs SET status='delivered',acknowledged_at=COALESCE(acknowledged_at,?),updated_at=? WHERE id=?").run(now,now,j.id);return {ok:true};
 });}
