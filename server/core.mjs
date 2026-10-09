import {consumeRequest,boundedBody,BodyTooLarge} from './request-guards.mjs';
const encoder=new TextEncoder();
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new HttpError(status,message)};
const str=(v,name,min=1,max=100)=>{if(typeof v!=='string'||v.trim().length<min||v.trim().length>max)fail(400,`تحقق من ${name}`);return v.trim()};
const num=(v,name,min=0,max=1000000)=>{if(!Number.isSafeInteger(v)||v<min||v>max)fail(400,`تحقق من ${name}`);return v};
const uid=()=>crypto.randomUUID();
const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
async function keys(secret){if(!secret)fail(503,'حماية المخزون غير مهيأة بعد. حاول لاحقًا.');const raw=bytes(secret);if(raw.length!==32)fail(503,'إعداد حماية المخزون غير صالح.');return {aes:await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']),hmac:await crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['sign'])};}
const hash=async(s,key)=>b64(await crypto.subtle.sign('HMAC',key,encoder.encode(s)));
async function seal(s,key,aad){const iv=crypto.getRandomValues(new Uint8Array(12));return b64(iv)+'.'+b64(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(aad)},key,encoder.encode(s)));}
async function unseal(s,key,aad){const [iv,data]=s.split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:encoder.encode(aad)},key,bytes(data)));}
// A single delimiter per file; quoted values retain their exact credential bytes.
function csvFields(line,delimiter){
 const fields=[];let value='',quoted=false,closed=false;
 for(let i=0;i<line.length;i++){
  const c=line[i];
  if(quoted){if(c==='"'){if(line[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=c;}
  else if(c===delimiter){fields.push(value);value='';closed=false;}
  else if(c==='"'){if(value||closed)throw new Error('quote');quoted=true;}
  else {if(closed)throw new Error('trailing');value+=c;}
 }
 if(quoted)throw new Error('unclosed');fields.push(value);return fields;
}
export function parseCards(raw){
 if(typeof raw!=='string'||raw.length>50000)fail(400,'الدفعة أكبر من الحد المسموح.');
 const lines=raw.replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());
 if(lines.length<1||lines.length>101)fail(400,'استورد من 1 إلى 100 كرت في الدفعة.');
 let delimiter=',',quoted=false;
 for(let i=0;i<lines[0].length;i++){const c=lines[0][i];if(c==='"'){if(quoted&&lines[0][i+1]==='"')i++;else quoted=!quoted;}else if(!quoted&&[',',';','\t'].includes(c)){delimiter=c;break;}}
 const records=[],invalid=[];
 lines.forEach((line,i)=>{try{
  const parts=csvFields(line,delimiter),[username,password='']=parts;
  if(i===0&&parts.length<=2&&/^(username|user|رقم الكرت|اسم المستخدم)$/i.test(username)&&(!parts[1]||/^(password|pass|كلمة المرور)$/i.test(parts[1])))return;
  if(parts.length>2||!username||username.length>64||password.length>64||!/^[a-zA-Z0-9_.@-]+$/.test(username)||/[\x00-\x1F]/.test(password))invalid.push(i+1);
  else records.push({username,password});
 }catch{invalid.push(i+1);}});
 if(invalid.length)fail(400,'صيغة غير صالحة في الأسطر: '+invalid.join('، '));
 if(!records.length||records.length>100)fail(400,'الدفعة يجب أن تحتوي من 1 إلى 100 كرت.');return records;
}
export function inventoryCsv(rows){const cell=value=>{let s=String(value??'');if(/^[\s]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};const lines=[['معرف الكرت','آخر 3 خانات','الفئة','السعر','الحالة','معرف الدفعة','تاريخ الإضافة'],...rows.map(r=>[r.id,'***'+r.suffix,r.category_name,r.price,r.status==='available'?'متاح':r.status==='sold'?'مباع':'موقوف',r.batch_id,new Date(r.created_at).toISOString()])];return '\uFEFF'+lines.map(row=>row.map(cell).join(',')).join('\r\n');}
export async function handleCore(request,db,actor,config={}){
const trace=uid(),json=(obj,status=200,extraHeaders={})=>Response.json(obj,{status,headers:{...extraHeaders,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-ID':trace}});
try{
 if(!actor?.userId||!actor?.email)fail(401,'سجل الدخول للوصول إلى حسابك.');
 if(!db)fail(503,'قاعدة البيانات غير متاحة الآن.');
 const write=request.method==='POST';if(!['GET','POST'].includes(request.method))fail(405,'طريقة غير مدعومة.');
 if(write){const origin=request.headers.get('origin');if(!origin||origin!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')fail(403,'مصدر الطلب غير مسموح.');if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'صيغة الطلب غير مدعومة.');}
 const query=new URL(request.url).searchParams;let body={};if(write){const text=await boundedBody(request);try{body=JSON.parse(text)}catch{fail(400,'طلب غير صالح.')}if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'طلب غير صالح.');}
 const op=write?body.op:query.get('op')||'bootstrap';const get=k=>write?body[k]:query.get(k);const now=Date.now();
 const budget=await consumeRequest(db,actor.userId,op,now);if(!budget.allowed)return json({error:`طلبات كثيرة خلال وقت قصير. حاول بعد ${budget.retryAfter} ثانية.`,retryAfter:budget.retryAfter,requestId:trace},429,{'Retry-After':String(budget.retryAfter)});
 const run=(sql,...args)=>db.prepare(sql).bind(...args);const one=(sql,...args)=>run(sql,...args).first();const all=async(sql,...args)=>(await run(sql,...args).all()).results;
 const admin=actor.role==='admin'||(config.adminEmails||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean).includes(actor.email.toLowerCase());
 const account=()=>run('INSERT INTO accounts(id,email,name,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name',actor.userId,actor.email,actor.displayName||actor.email,now);
 const log=(network,event,detail)=>run('INSERT INTO audit(id,network_id,actor_id,event,detail,created_at) VALUES(?,?,?,?,?,?)',uid(),network,actor.userId,event,detail,now);
 const syncStock=networkId=>run(`INSERT INTO stock_alerts(category_id,network_id,stock,threshold,status,opened_at,updated_at,read_at)
 SELECT c.id,c.network_id,(SELECT COUNT(*) FROM vouchers v WHERE v.category_id=c.id AND v.status='available'),c.low_threshold,
 CASE WHEN (SELECT COUNT(*) FROM vouchers v WHERE v.category_id=c.id AND v.status='available')<=c.low_threshold THEN 'open' ELSE 'resolved' END,?,?,NULL FROM categories c WHERE c.network_id=?
 ON CONFLICT(category_id) DO UPDATE SET stock=excluded.stock,threshold=excluded.threshold,status=excluded.status,
 opened_at=CASE WHEN stock_alerts.status='resolved' AND excluded.status='open' THEN excluded.opened_at ELSE stock_alerts.opened_at END,
 read_at=CASE WHEN stock_alerts.status='resolved' AND excluded.status='open' THEN NULL ELSE stock_alerts.read_at END,updated_at=excluded.updated_at
 WHERE stock_alerts.stock<>excluded.stock OR stock_alerts.threshold<>excluded.threshold OR stock_alerts.status<>excluded.status`,now,now,networkId);
 const own=async id=>{str(id,'الشبكة',1,80);const n=await one('SELECT * FROM networks WHERE id=? AND owner_id=?',id,actor.userId);if(!n)fail(404,'الشبكة غير موجودة أو لا تملك صلاحية الوصول.');return n};
 if(op==='bootstrap'&&!write){return json({user:{name:actor.displayName,email:actor.email},isAdmin:admin,networks:await all('SELECT n.*, (SELECT COUNT(*) FROM vouchers v WHERE v.network_id=n.id AND v.status=?) AS stock,(SELECT COUNT(*) FROM categories c WHERE c.network_id=n.id) AS category_count FROM networks n WHERE n.owner_id=? ORDER BY n.created_at DESC','available',actor.userId)});}
 if(op==='createNetwork'&&write){const name=str(body.name,'اسم الشبكة',2,80),phone=str(body.phone,'رقم الهاتف',9,16),province=str(body.province,'المحافظة',2,60),district=str(body.district,'المديرية',2,60);if(!/^\+?\d{9,15}$/.test(phone))fail(400,'رقم الهاتف غير صالح.');const total=await one('SELECT COUNT(*) n FROM networks WHERE owner_id=?',actor.userId);if(total.n>=20)fail(400,'الحد الحالي 20 شبكة لكل حساب.');const id=uid();await db.batch([account(),run('INSERT INTO networks(id,owner_id,name,phone,province,district,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',id,actor.userId,name,phone,province,district,'pending',now,now),log(id,'NETWORK_CREATED','تم إنشاء طلب شبكة')]);return json({id},201);}
 if(op==='admin'&&!write){if(!admin)fail(403,'هذه الصفحة مخصصة لإدارة المنصة.');return json({networks:await all('SELECT n.*,a.email AS owner_email FROM networks n JOIN accounts a ON n.owner_id=a.id ORDER BY n.created_at DESC LIMIT 200')});}
 if(op==='reviewNetwork'&&write){if(!admin)fail(403,'لا تملك صلاحية المراجعة.');const id=str(body.networkId,'الشبكة');if(!['active','rejected'].includes(body.status))fail(400,'حالة غير صالحة.');const n=await one('SELECT status,updated_at FROM networks WHERE id=?',id);if(!n)fail(404,'الشبكة غير موجودة.');const expected=num(body.expectedUpdatedAt,'نسخة الطلب',1,Number.MAX_SAFE_INTEGER);const reason=body.status==='rejected'?str(body.reason,'سبب الرفض',5,500):'';const result=await db.batch([run('UPDATE networks SET status=?,review_note=?,updated_at=? WHERE id=? AND updated_at=?',body.status,reason,Math.max(now,n.updated_at+1),id,expected),run('INSERT INTO audit(id,network_id,actor_id,event,detail,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1',uid(),id,actor.userId,'NETWORK_REVIEWED',body.status==='active'?'تم اعتماد الشبكة':'تم رفض الطلب: '+reason,now)]);if((result[0].meta?.changes??result[0].changes)!==1)fail(409,'تم تحديث الطلب من جلسة أخرى. حدّث القائمة قبل المراجعة.');return json({ok:true});}
 if(op==='reviewQueue'&&!write){if(!admin)fail(403,'هذه الصفحة مخصصة لإدارة المنصة.');const page=num(Number(get('page')||1),'رقم الصفحة',1,100000),args=[],clauses=['1=1'];if(get('status')){if(!['pending','active','rejected'].includes(get('status')))fail(400,'حالة غير صالحة.');clauses.push('n.status=?');args.push(get('status'));}if(get('search')){const search=str(get('search'),'البحث',1,80);clauses.push('(instr(n.name,?)>0 OR instr(n.phone,?)>0)');args.push(search,search);}const where=clauses.join(' AND ');return json({rows:await all('SELECT n.*,a.email AS owner_email FROM networks n JOIN accounts a ON n.owner_id=a.id WHERE '+where+' ORDER BY n.created_at DESC,n.id DESC LIMIT 25 OFFSET ?',...args,(page-1)*25),total:(await one('SELECT COUNT(*) n FROM networks n WHERE '+where,...args)).n,page});}
 if(op==='notifications'&&write){const owned=await all('SELECT id FROM networks WHERE owner_id=?',actor.userId);if(owned.length)await db.batch(owned.map(n=>syncStock(n.id)));const page=num(body.page??1,'رقم الصفحة',1,100000);const status=body.status||'open';if(!['open','resolved','all'].includes(status))fail(400,'حالة تنبيه غير صالحة.');const args=[actor.userId],where='n.owner_id=?'+(status==='all'?'':' AND s.status=?');if(status!=='all')args.push(status);return json({rows:await all('SELECT s.*,c.name AS category_name,n.name AS network_name FROM stock_alerts s JOIN networks n ON s.network_id=n.id JOIN categories c ON s.category_id=c.id WHERE '+where+' ORDER BY s.opened_at DESC,s.category_id DESC LIMIT 25 OFFSET ?',...args,(page-1)*25),total:(await one('SELECT COUNT(*) n FROM stock_alerts s JOIN networks n ON n.id=s.network_id WHERE '+where,...args)).n,page});}
 const network=await own(get('networkId'));
 if(op==='readAlert'&&write){const result=await run('UPDATE stock_alerts SET read_at=? WHERE network_id=? AND category_id=?',now,network.id,str(body.categoryId,'الفئة')).run();if((result.meta?.changes??result.changes)!==1)fail(404,'التنبيه غير موجود.');return json({ok:true});}
 if(op==='activity'&&!write){const page=num(Number(get('page')||1),'رقم الصفحة',1,100000),args=[network.id],clauses=['network_id=?'];if(get('search')){const text=str(get('search'),'البحث',1,100);clauses.push('instr(detail,?)>0');args.push(text);}if(get('event')){clauses.push('event=?');args.push(str(get('event'),'نوع الإجراء',1,50));}for(const key of ['from','to']){if(get(key)){const value=str(get(key),'التاريخ',10,10);const ms=Date.parse(value+'T00:00:00+03:00');if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(ms)||new Date(ms+3*3600000).toISOString().slice(0,10)!==value)fail(400,'التاريخ غير صالح.');clauses.push(key==='from'?'created_at>=?':'created_at<?');args.push(ms+(key==='to'?86400000:0));}}if(get('from')&&get('to')&&get('from')>get('to'))fail(400,'تاريخ البداية يجب أن يسبق النهاية.');const where=clauses.join(' AND ');return json({rows:await all('SELECT id,event,detail,created_at FROM audit WHERE '+where+' ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET ?',...args,(page-1)*25),total:(await one('SELECT COUNT(*) n FROM audit WHERE '+where,...args)).n,page});}

 if(op==='network'&&!write){const categories=await all('SELECT c.*,(SELECT COUNT(*) FROM vouchers v WHERE v.category_id=c.id AND v.status=?) AS stock FROM categories c WHERE network_id=? ORDER BY price','available',network.id);return json({network,categories,batches:await all('SELECT b.id,b.count,b.created_at,c.name AS category_name FROM batches b JOIN categories c ON c.id=b.category_id WHERE b.network_id=? ORDER BY b.created_at DESC LIMIT 50',network.id),audit:await all('SELECT id,event,detail,created_at FROM audit WHERE network_id=? ORDER BY created_at DESC LIMIT 50',network.id)});}
 if(['updateNetwork','resubmitNetwork'].includes(op)&&write){
 const name=str(body.name,'اسم الشبكة',2,80),phone=str(body.phone,'رقم الهاتف',9,16),province=str(body.province,'المحافظة',2,60),district=str(body.district,'المديرية',2,60);
 if(!/^\+?\d{9,15}$/.test(phone))fail(400,'رقم الهاتف غير صالح.');
 const expected=num(body.expectedUpdatedAt,'نسخة الطلب',1,Number.MAX_SAFE_INTEGER),resubmit=op==='resubmitNetwork';
 if(resubmit&&network.status!=='rejected')fail(409,'إعادة الإرسال متاحة للطلبات المرفوضة فقط. حدّث بيانات الشبكة.');
 const result=await db.batch([
 run("UPDATE networks SET name=?,phone=?,province=?,district=?,status=?,review_note=?,updated_at=? WHERE id=? AND owner_id=? AND updated_at=? AND status=?",name,phone,province,district,resubmit?'pending':network.status,resubmit?'':network.review_note,Math.max(now,network.updated_at+1),network.id,actor.userId,expected,network.status),
 run('INSERT INTO audit(id,network_id,actor_id,event,detail,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1',uid(),network.id,actor.userId,resubmit?'NETWORK_RESUBMITTED':'NETWORK_UPDATED',resubmit?'تصحيح بيانات الشبكة وإعادة إرسال الطلب للمراجعة':'تعديل معلومات الشبكة',now)
 ]);
 if((result[0].meta?.changes??result[0].changes)!==1)fail(409,'تغيرت بيانات الشبكة من جلسة أخرى. حدّث البيانات قبل إعادة الحفظ.');
 return json({ok:true});
 }
 if(op==='createCategory'&&write){const id=uid();await db.batch([run('INSERT INTO categories(id,network_id,name,price,data_mb,hours,valid_days,low_threshold,created_at) VALUES(?,?,?,?,?,?,?,?,?)',id,network.id,str(body.name,'اسم الفئة',1,50),num(body.price,'السعر',1),num(body.dataMb,'الحجم',1),num(body.hours,'الساعات',1,8760),num(body.validDays,'الصلاحية',1,365),num(body.lowThreshold,'حد التنبيه',0,10000),now),log(network.id,'CATEGORY_CREATED','تمت إضافة فئة'),syncStock(network.id)]);return json({id},201);}
 if(op==='updateCategory'&&write){const categoryId=str(body.categoryId,'الفئة');const old=await one('SELECT * FROM categories WHERE network_id=? AND id=?',network.id,categoryId);if(!old)fail(404,'الفئة غير موجودة.');const changed=[str(body.name,'اسم الفئة',1,50),num(body.price,'السعر',1),num(body.dataMb,'الحجم',1),num(body.hours,'الساعات',1,8760),num(body.validDays,'الصلاحية',1,365),num(body.lowThreshold,'حد التنبيه',0,10000)];await db.batch([run('UPDATE categories SET name=?,price=?,data_mb=?,hours=?,valid_days=?,low_threshold=? WHERE network_id=? AND id=?',...changed,network.id,categoryId),log(network.id,'CATEGORY_UPDATED','تعديل الفئة '+categoryId),syncStock(network.id)]);return json({ok:true});}
 if(op==='setVoucherStatus'&&write){const voucherId=str(body.voucherId,'الكرت'),expected=body.expectedStatus,target=body.status;if(!['available','disabled'].includes(expected)||!['available','disabled'].includes(target)||expected===target)fail(400,'انتقال حالة غير مسموح.');const result=await db.batch([run('UPDATE vouchers SET status=? WHERE id=? AND network_id=? AND status=?',target,voucherId,network.id,expected),run('INSERT INTO audit(id,network_id,actor_id,event,detail,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1',uid(),network.id,actor.userId,'VOUCHER_STATUS_CHANGED',(target==='disabled'?'إيقاف كرت ':'إعادة كرت للمخزون ')+voucherId,now),syncStock(network.id)]);if((result[0].meta?.changes??result[0].changes)!==1)fail(409,'تغيرت حالة الكرت أو لم يعد متاحًا. حدّث القائمة.');return json({ok:true});}
 if(['inventory','exportInventory'].includes(op)&&write){
 const args=[network.id],clauses=['v.network_id=?'];
 if(body.categoryId){clauses.push('v.category_id=?');args.push(str(body.categoryId,'الفئة'));}
 if(body.status){if(!['available','disabled','sold'].includes(body.status))fail(400,'الحالة غير صالحة.');clauses.push('v.status=?');args.push(body.status);}
 if(body.username){const username=str(body.username,'رقم الكرت',1,64);const k=await keys(config.vaultKey);clauses.push('v.fingerprint=?');args.push(await hash(network.id+':'+username,k.hmac));}
 if(body.batchId){clauses.push('v.batch_id=?');args.push(str(body.batchId,'الدفعة'));}
 const where=clauses.join(' AND '),total=(await one('SELECT COUNT(*) n FROM vouchers v WHERE '+where,...args)).n;
 const page=num(body.page??1,'رقم الصفحة',1,100000),limit=op==='exportInventory'?5000:25;
 if(op==='exportInventory'&&total>5000)fail(400,'تجاوزت النتائج 5000 سجل. حدد فئة أو حالة لتقليل النتائج.');
 const rows=await all('SELECT v.id,v.suffix,v.status,v.batch_id,v.created_at,c.name AS category_name,c.price FROM vouchers v JOIN categories c ON c.id=v.category_id WHERE '+where+' ORDER BY v.created_at DESC,v.id DESC LIMIT ? OFFSET ?',...args,limit,op==='exportInventory'?0:(page-1)*limit);
 if(op==='exportInventory'){const content=inventoryCsv(rows);await log(network.id,'INVENTORY_EXPORTED',`تصدير ${rows.length} سجل مخزون بأرقام مخفية`).run();return json({csv:content,count:rows.length});}
 return json({rows,total,page,pageSize:25});
 }
 if(op==='listBatches'&&!write){const page=num(Number(get('page')||1),'رقم الصفحة',1,100000),categoryId=get('categoryId'),args=[network.id],clauses=['b.network_id=?'];if(categoryId){clauses.push('b.category_id=?');args.push(str(categoryId,'الفئة'));}const where=clauses.join(' AND ');return json({rows:await all('SELECT b.id,b.count,b.created_at,c.name AS category_name FROM batches b JOIN categories c ON c.id=b.category_id WHERE '+where+' ORDER BY b.created_at DESC,b.id DESC LIMIT 25 OFFSET ?',...args,(page-1)*25),total:(await one('SELECT COUNT(*) n FROM batches b WHERE '+where,...args)).n,page,pageSize:25});}
 if(op==='vouchers'&&!write){const batchId=str(get('batchId'),'الدفعة');return json({vouchers:await all('SELECT id,suffix,status,created_at FROM vouchers WHERE network_id=? AND batch_id=? ORDER BY created_at LIMIT 100',network.id,batchId)});}
 if(op==='reveal'&&write){const voucher=await one('SELECT id,sealed FROM vouchers WHERE network_id=? AND id=?',network.id,str(body.voucherId,'الكرت'));if(!voucher)fail(404,'الكرت غير موجود.');const k=await keys(config.vaultKey);const data=JSON.parse(await unseal(voucher.sealed,k.aes,network.id+':'+voucher.id));await log(network.id,'VOUCHER_REVEALED','عرض كرت '+voucher.id).run();return json(data);}
 if(['previewImport','import'].includes(op)&&write){
 const category=await one('SELECT id FROM categories WHERE network_id=? AND id=?',network.id,str(body.categoryId,'الفئة'));if(!category)fail(404,'الفئة غير موجودة.');
 const records=parseCards(body.raw),k=await keys(config.vaultKey);const payloadHash=await hash(JSON.stringify([category.id,records]),k.hmac);let requestKey;
 if(op==='import'){requestKey=str(body.requestKey,'معرّف الطلب',16,80);const existing=await one('SELECT id,count,payload_hash FROM batches WHERE network_id=? AND request_key=?',network.id,requestKey);if(existing){if(existing.payload_hash!==payloadHash)fail(409,'معرّف الطلب مستخدم لدفعة مختلفة.');return json({id:existing.id,count:existing.count,replayed:true});}}
 let duplicates=0,unique=[],seen=new Set();for(const r of records){const fingerprint=await hash(network.id+':'+r.username,k.hmac);if(seen.has(fingerprint)){duplicates++;continue;}seen.add(fingerprint);const old=await one('SELECT id FROM vouchers WHERE network_id=? AND fingerprint=?',network.id,fingerprint);if(old){duplicates++;continue;}unique.push({...r,fingerprint});}
 if(op==='previewImport')return json({total:records.length,newCount:unique.length,duplicates});
 if(!unique.length)fail(409,'جميع الكروت مكررة؛ لم يتم الاستيراد.');
 const batchId=uid();let statements=[run('INSERT INTO batches(id,network_id,category_id,actor_id,request_key,payload_hash,count,created_at) VALUES(?,?,?,?,?,?,?,?)',batchId,network.id,category.id,actor.userId,requestKey,payloadHash,unique.length,now)];for(const r of unique){const id=uid();const sealed=await seal(JSON.stringify({username:r.username,password:r.password}),k.aes,network.id+':'+id);statements.push(run('INSERT INTO vouchers(id,network_id,category_id,batch_id,fingerprint,sealed,suffix,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',id,network.id,category.id,batchId,r.fingerprint,sealed,r.username.slice(-3),'available',now));}statements.push(log(network.id,'VOUCHERS_IMPORTED',`استيراد ${unique.length} كرت، وتجاهل ${duplicates} مكرر`));statements.push(syncStock(network.id));await db.batch(statements);return json({id:batchId,count:unique.length,duplicates},201);
 }
 fail(404,'العملية غير موجودة.');
}catch(error){if(error instanceof BodyTooLarge)return json({error:'حجم الطلب يتجاوز الحد المسموح (70 كيلوبايت).',requestId:trace},413);if(error instanceof HttpError)return json({error:error.message,requestId:trace},error.status);const text=String(error?.message||'');if(/UNIQUE constraint failed/.test(text))return json({error:'يوجد سجل مكرر أو عملية متزامنة. حدّث الصفحة وأعد المحاولة.',requestId:trace},409);console.error('core_request_failed',{trace,type:error?.name||'Error'});return json({error:'تعذر إتمام العملية الآن. بياناتك المدخلة لم تتغير؛ حاول مرة أخرى.',requestId:trace},503);}
}
