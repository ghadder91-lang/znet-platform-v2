import {enqueueDeliveries} from './delivery.mjs';
import {sealValue} from './vault.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {transaction} from './database.mjs';
const id=()=>randomUUID();
export class CommerceError extends Error{constructor(message,status=400){super(message);this.status=status}}
function owned(sql,actor,networkId){const n=sql.prepare('SELECT * FROM networks WHERE id=? AND owner_id=?').get(networkId,actor.userId);if(!n)throw new CommerceError('الشبكة غير موجودة.',404);return n;}
export function createOrder(db,actor,{networkId,categoryId,requestKey},bps,partner=null){
 if(typeof requestKey!=='string'||requestKey.length<16||requestKey.length>80)throw new CommerceError('معرف الطلب غير صالح.');
 if(!Number.isSafeInteger(bps)||bps<0||bps>10000)throw new CommerceError('إعداد العمولة غير صالح.',503);
 return transaction(db.sql,()=>{const sql=db.sql,n=owned(sql,actor,networkId);if(n.status!=='active')throw new CommerceError('الشبكة لم تعتمد بعد.',409);if(n.suspended_at!==null)throw new CommerceError('الشبكة معلقة تشغيليًا؛ تواصل مع الإدارة.',409);
 const checkoutHash=partner?createHash('sha256').update(JSON.stringify([networkId,categoryId,partner.provider,partner.customerRef,partner.phone])).digest('hex'):null;
 const old=sql.prepare('SELECT * FROM orders WHERE network_id=? AND request_key=?').get(networkId,requestKey);if(old){if(old.category_id!==categoryId||old.checkout_hash!==checkoutHash)throw new CommerceError('معرف الطلب مستخدم لطلب مختلف.',409);return old;}
 const c=sql.prepare('SELECT * FROM categories WHERE id=? AND network_id=?').get(categoryId,networkId);if(!c)throw new CommerceError('الفئة غير موجودة.',404);
 if(!sql.prepare("SELECT id FROM vouchers WHERE category_id=? AND status='available' LIMIT 1").get(categoryId))throw new CommerceError('لا يوجد مخزون متاح.',409);
 const now=Date.now(),order=id();sql.prepare('INSERT INTO orders(id,network_id,category_id,request_key,amount,commission_bps,created_at,expires_at,provider,customer_ref,destination_sealed,checkout_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(order,networkId,categoryId,requestKey,c.price,bps,now,now+900000,partner?.provider||null,partner?.customerRef||null,partner?sealValue({phone:partner.phone},partner.vaultKey,'order:'+order):null,checkoutHash);
 sql.prepare('INSERT INTO operation_events VALUES(?,?,?,?,?)').run(id(),networkId,'ORDER_CREATED',order,now);return sql.prepare('SELECT * FROM orders WHERE id=?').get(order);
 });
}
// This entry point is internal. Only a provider adapter that has verified the callback
// signature, recipient, currency and provider transaction status may invoke it.
// No public HTTP route accepts "payment succeeded" from a browser.
export function recordVerifiedPayment(db,{provider,reference,orderId,amount},{withinTransaction=false}={}){
 if(!/^[a-z0-9_-]{2,40}$/.test(provider)||typeof reference!=='string'||reference.length<1||reference.length>150||!Number.isSafeInteger(amount)||amount<=0||amount>100000000)throw new CommerceError('حدث دفع غير صالح.');
 const commit=()=>{const sql=db.sql,old=sql.prepare('SELECT * FROM payment_events WHERE provider=? AND reference=?').get(provider,reference);
 if(old){if(old.order_id!==orderId||old.amount!==amount)throw new CommerceError('تعارض مرجع الدفع.',409);return {outcome:old.outcome,replayed:true};}
 const order=sql.prepare('SELECT * FROM orders WHERE id=?').get(orderId);if(!order)throw new CommerceError('الطلب غير موجود.',404);
 const now=Date.now();let reason=order.status!=='pending'?'ORDER_NOT_PENDING':now>order.expires_at?'PAYMENT_AFTER_EXPIRY':amount!==order.amount?'AMOUNT_MISMATCH':'';
 const network=sql.prepare('SELECT status,suspended_at FROM networks WHERE id=?').get(order.network_id);if(!reason&&network.status!=='active')reason='NETWORK_NOT_ACTIVE';if(!reason&&network.suspended_at!==null)reason='NETWORK_SUSPENDED';
 let card;if(!reason){card=sql.prepare("SELECT id FROM vouchers WHERE category_id=? AND network_id=? AND status='available' ORDER BY created_at,id LIMIT 1").get(order.category_id,order.network_id);if(!card)reason='STOCK_UNAVAILABLE';}
 const outcome=reason?'exception':'paid',journal=id();
 sql.prepare('INSERT INTO payment_events VALUES(?,?,?,?,?,?)').run(provider,reference,orderId,amount,outcome,now);
 sql.prepare('INSERT INTO journals VALUES(?,?,?,?,?)').run(journal,orderId,provider,reference,now);
 const entry=(account,debit,credit)=>{if(debit||credit)sql.prepare('INSERT INTO ledger_entries VALUES(?,?,?,?,?,?)').run(id(),journal,order.network_id,account,debit,credit);};
 entry('provider_receivable',amount,0);
 if(reason){entry('payment_suspense',0,amount);sql.prepare('INSERT INTO incidents VALUES(?,?,?,?,?,?)').run(id(),order.network_id,orderId,reason,'open',now);if(order.status!=='paid')sql.prepare("UPDATE orders SET status='payment_exception' WHERE id=?").run(orderId);}
 else{
 const commission=Math.floor(amount*order.commission_bps/10000);entry('network_payable',0,amount-commission);entry('platform_revenue',0,commission);
 const changed=sql.prepare("UPDATE vouchers SET status='sold' WHERE id=? AND status='available'").run(card.id);if(changed.changes!==1)throw Error('Allocation conflict');
 sql.prepare("UPDATE orders SET status='paid',voucher_id=?,paid_at=? WHERE id=?").run(card.id,now,orderId);
 // Update the persisted stock alert in the same transaction as allocation.
 sql.prepare(`UPDATE stock_alerts SET stock=(SELECT COUNT(*) FROM vouchers WHERE category_id=? AND status='available'),status=CASE WHEN (SELECT COUNT(*) FROM vouchers WHERE category_id=? AND status='available')<=threshold THEN 'open' ELSE 'resolved' END,read_at=CASE WHEN status='resolved' AND (SELECT COUNT(*) FROM vouchers WHERE category_id=? AND status='available')<=threshold THEN NULL ELSE read_at END,opened_at=CASE WHEN status='resolved' AND (SELECT COUNT(*) FROM vouchers WHERE category_id=? AND status='available')<=threshold THEN ? ELSE opened_at END,updated_at=? WHERE category_id=?`).run(order.category_id,order.category_id,order.category_id,order.category_id,now,now,order.category_id);
 }
 const sums=sql.prepare('SELECT SUM(debit) d,SUM(credit) c FROM ledger_entries WHERE journal_id=?').get(journal);if(sums.d!==sums.c)throw Error('Unbalanced journal');
 sql.prepare('INSERT INTO operation_events VALUES(?,?,?,?,?)').run(id(),order.network_id,reason?'PAYMENT_EXCEPTION':'CARD_SOLD',orderId,now);
 sql.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?)').run(id(),order.network_id,'provider:'+provider,reason?'PAYMENT_EXCEPTION':'CARD_SOLD',reason?'عملية دفع تحتاج مطابقة: '+orderId:'بيع كرت للطلب '+orderId,now);
 if(!reason&&order.provider&&order.destination_sealed)enqueueDeliveries(sql,orderId,now);
 return {outcome,orderId,incident:reason||null};
 };return withinTransaction?commit():transaction(db.sql,commit);
}
export function commerceOverview(db,actor,networkId,page=1){owned(db.sql,actor,networkId);if(!Number.isSafeInteger(page)||page<1||page>100000)throw new CommerceError('صفحة غير صالحة.');return transaction(db.sql,()=>{
 db.sql.prepare("UPDATE orders SET status='expired' WHERE network_id=? AND status='pending' AND expires_at<=?").run(networkId,Date.now());
 const rows=db.sql.prepare('SELECT id,amount,status,created_at,paid_at,voucher_id FROM orders WHERE network_id=? ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET ?').all(networkId,(page-1)*25);
 const totals=db.sql.prepare('SELECT account,SUM(debit) debit,SUM(credit) credit FROM ledger_entries WHERE network_id=? GROUP BY account').all(networkId);
 const incidents=db.sql.prepare("SELECT id,order_id,reason,created_at FROM incidents WHERE network_id=? AND status='open' ORDER BY created_at DESC LIMIT 25").all(networkId);
 return {rows,totals,incidents,page,total:db.sql.prepare('SELECT COUNT(*) n FROM orders WHERE network_id=?').get(networkId).n,paymentEnabled:false};
 });}
