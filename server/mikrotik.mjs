import https from 'node:https';
import {createHash,randomUUID} from 'node:crypto';
import {transaction} from './database.mjs';
import {sealValue,unsealValue} from './vault.mjs';
const FRESH_MS=900000,LEASE_MS=45000,COOLDOWN_MS=60000;
export class RouterError extends Error{constructor(code,status=502){super(code);this.code=code;this.status=status}}
function fail(message,status=400){throw Object.assign(Error(message),{status})}
function owned(db,actor,id){if(!db.sql.prepare('SELECT id FROM networks WHERE id=? AND owner_id=?').get(id,actor.userId))fail('الشبكة غير موجودة',404)}
function version(value){if(!Number.isSafeInteger(value)||value<0)fail('رقم النسخة غير صالح')}
function row(db,id){return db.sql.prepare('SELECT * FROM mikrotik_connections WHERE network_id=?').get(id)}
// Only the server administrator can choose destinations. Browser payloads never
// select a URL, host, port, REST path or TLS policy.
export function approvedTarget(networkId,env=process.env){
 if(env.MIKROTIK_ENABLED!=='true')return null;
 let targets;try{targets=JSON.parse(env.MIKROTIK_TARGETS_JSON||'{}')}catch{throw new RouterError('SERVER_CONFIG',503)}
 if(!targets||typeof targets!=='object'||Array.isArray(targets))throw new RouterError('SERVER_CONFIG',503);
 if(!Object.hasOwn(targets,networkId))return null;
 const value=targets[networkId];let u;try{u=new URL(value)}catch{throw new RouterError('SERVER_CONFIG',503)}
 if(typeof value!=='string'||u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.hostname==='localhost'||['127.0.0.1','0.0.0.0','169.254.169.254','[::1]'].includes(u.hostname))throw new RouterError('SERVER_CONFIG',503);
 return u.origin;
}
export const routerErrorLabels={SERVER_CONFIG:'إعداد وجهة الراوتر على الخادم غير صالح',NOT_APPROVED:'لم يحدد مسؤول الخادم وجهة MikroTik لهذه الشبكة',TARGET_CHANGED:'تغيرت وجهة الراوتر. احفظ بيانات الاتصال من جديد',AUTH:'رفض الراوتر بيانات الدخول أو صلاحيات الحساب',TIMEOUT:'انتهت مهلة الاتصال بالراوتر',NETWORK:'تعذر الوصول إلى الراوتر أو التحقق من شهادة TLS',REDIRECT:'رفض تحويل الاتصال إلى عنوان آخر',RESPONSE:'استجابة الراوتر غير متوافقة مع الصيغة المطلوبة',TOO_LARGE:'تجاوز رد الراوتر الحد المسموح',HTTP:'رفض الراوتر الطلب',KEY:'تعذر فك بيانات الاتصال بمفتاح التشفير الحالي',STALE:'تغير إعداد الاتصال أثناء الفحص؛ أعد المحاولة',INTERRUPTED:'لم يكتمل الفحص السابق'};
// Fixed read-only endpoints, bounded body and an absolute timeout. Certificate
// verification is explicit and cannot be disabled by a browser or env override.
export function restGet(endpoint,path,credentials,{timeoutMs=12000}={}){
 if(!['/rest/system/resource?.proplist=version,board-name,uptime,cpu-load,free-memory,total-memory','/rest/ip/hotspot/user/profile?.proplist=.id,name,rate-limit,session-timeout,idle-timeout,shared-users'].includes(path))throw new RouterError('RESPONSE');
 return new Promise((resolve,reject)=>{let settled=false,timer;const finish=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);err?reject(err):resolve(value)};
 const req=https.request(endpoint+path,{method:'GET',agent:false,rejectUnauthorized:true,headers:{Accept:'application/json',Authorization:'Basic '+Buffer.from(credentials.username+':'+credentials.password,'utf8').toString('base64')}},res=>{
 if(res.statusCode!==200){res.resume();req.destroy();finish(new RouterError(res.statusCode>=300&&res.statusCode<400?'REDIRECT':[401,403].includes(res.statusCode)?'AUTH':'HTTP'));return}
 let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>524288){finish(new RouterError('TOO_LARGE'));req.destroy();return}chunks.push(chunk)});res.on('end',()=>{try{finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{finish(new RouterError('RESPONSE'))}});res.on('error',()=>finish(new RouterError('NETWORK')));
 });timer=setTimeout(()=>{finish(new RouterError('TIMEOUT'));req.destroy()},timeoutMs);req.on('error',()=>finish(new RouterError('NETWORK')));req.end();
 });
}
function cleanString(value,max=200){if(typeof value!=='string'||value.length>max||/[\u0000-\u001f]/.test(value))throw new RouterError('RESPONSE');return value}
function parseResource(value){const r=Array.isArray(value)&&value.length===1?value[0]:value;if(!r||typeof r!=='object'||Array.isArray(r))throw new RouterError('RESPONSE');const out={version:cleanString(r.version),board:cleanString(r['board-name']||''),uptime:cleanString(r.uptime||'')};if(!/^7\./.test(out.version))throw new RouterError('RESPONSE');for(const [key,target,max] of [['cpu-load','cpu',100],['free-memory','freeMemory',Number.MAX_SAFE_INTEGER],['total-memory','totalMemory',Number.MAX_SAFE_INTEGER]]){const v=r[key];if(v===undefined){out[target]=null;continue}if(typeof v!=='string'||!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)>max)throw new RouterError('RESPONSE');out[target]=Number(v)}return out}
function parseProfiles(value){if(!Array.isArray(value)||value.length>500)throw new RouterError('RESPONSE');const names=new Set(),ids=new Set();return value.map(p=>{if(!p||typeof p!=='object'||Array.isArray(p))throw new RouterError('RESPONSE');const id=cleanString(p['.id'],40),name=cleanString(p.name,200);if(!/^\*[0-9A-Fa-f]+$/.test(id)||!name||names.has(name)||ids.has(id))throw new RouterError('RESPONSE');names.add(name);ids.add(id);const properties={rateLimit:cleanString(p['rate-limit']||''),sessionTimeout:cleanString(p['session-timeout']||''),idleTimeout:cleanString(p['idle-timeout']||''),sharedUsers:cleanString(p['shared-users']||'')};const fingerprint=createHash('sha256').update(JSON.stringify({id,name,properties})).digest('hex');return {id,name,properties,fingerprint}})}
function audit(db,networkId,actorId,event,detail,now){db.sql.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?)').run(randomUUID(),networkId,actorId,event,detail,now)}
export function saveRouter(db,actor,input,key,env=process.env,now=Date.now()){
 const {networkId,username,password,expectedVersion}=input;owned(db,actor,networkId);version(expectedVersion);const endpoint=approvedTarget(networkId,env);if(!endpoint)throw new RouterError('NOT_APPROVED',409);
 if(typeof username!=='string'||username.length<1||username.length>100||/[\u0000-\u001f:]/.test(username)||typeof password!=='string'||password.length<1||password.length>256||/[\u0000-\u001f]/.test(password))fail('تحقق من اسم المستخدم وكلمة المرور');
 return transaction(db.sql,()=>{const c=row(db,networkId);if((c?.version||0)!==expectedVersion)fail('تغير الاتصال؛ حدّث الصفحة قبل الحفظ',409);const v=expectedVersion+1,sealed=sealValue({username,password},key,'mikrotik:'+networkId+':'+v);
 db.sql.prepare("INSERT INTO mikrotik_connections(network_id,endpoint,sealed_credentials,version,status,updated_at) VALUES(?,?,?,?,'unverified',?) ON CONFLICT(network_id) DO UPDATE SET endpoint=excluded.endpoint,sealed_credentials=excluded.sealed_credentials,version=excluded.version,status='unverified',sync_version=0,lease_token=NULL,lease_until=NULL,last_attempt=NULL,last_success=NULL,last_error=NULL,system_json=NULL,updated_at=excluded.updated_at").run(networkId,endpoint,sealed,v,now);
 db.sql.prepare('DELETE FROM mikrotik_profiles WHERE network_id=?').run(networkId);db.sql.prepare('DELETE FROM mikrotik_bindings WHERE network_id=?').run(networkId);audit(db,networkId,actor.userId,'MIKROTIK_CONFIGURED','حُفظت بيانات الربط المشفرة؛ النسخة '+v,now);return {version:v};});
}
export function disconnectRouter(db,actor,{networkId,expectedVersion},now=Date.now()){
 owned(db,actor,networkId);version(expectedVersion);return transaction(db.sql,()=>{const c=row(db,networkId);if(!c||c.version!==expectedVersion)fail('تغير الاتصال؛ حدّث الصفحة',409);db.sql.prepare("UPDATE mikrotik_connections SET sealed_credentials=NULL,version=version+1,status='unconfigured',lease_token=NULL,lease_until=NULL,last_attempt=NULL,last_success=NULL,last_error=NULL,system_json=NULL,sync_version=0,updated_at=? WHERE network_id=?").run(now,networkId);db.sql.prepare('DELETE FROM mikrotik_profiles WHERE network_id=?').run(networkId);db.sql.prepare('DELETE FROM mikrotik_bindings WHERE network_id=?').run(networkId);audit(db,networkId,actor.userId,'MIKROTIK_DISCONNECTED','حُذفت بيانات الربط والربط المحلي للفئات',now);return {ok:true};});
}
export async function syncRouter(db,actor,{networkId,expectedVersion},key,{env=process.env,transport=restGet,now=Date.now()}={}){
 owned(db,actor,networkId);version(expectedVersion);const endpoint=approvedTarget(networkId,env);if(!endpoint)throw new RouterError('NOT_APPROVED',409);
 const token=randomUUID();const c=transaction(db.sql,()=>{const c=row(db,networkId);if(!c?.sealed_credentials)fail('احفظ بيانات الاتصال أولًا',409);if(c.version!==expectedVersion)fail('تغير الاتصال؛ حدّث الصفحة',409);if(c.endpoint!==endpoint)throw new RouterError('TARGET_CHANGED',409);if(c.lease_until>now)fail('يوجد فحص جارٍ لهذه الشبكة',409);if(c.last_attempt!==null&&c.last_attempt+COOLDOWN_MS>now)fail('انتظر دقيقة بين محاولات الاتصال',429);db.sql.prepare("UPDATE mikrotik_connections SET status='syncing',lease_token=?,lease_until=?,last_attempt=? WHERE network_id=?").run(token,now+LEASE_MS,now,networkId);return c});
 let system,profiles,error=null;
 try{let credentials;try{credentials=unsealValue(c.sealed_credentials,key,'mikrotik:'+networkId+':'+c.version)}catch{throw new RouterError('KEY')}
 system=parseResource(await transport(endpoint,'/rest/system/resource?.proplist=version,board-name,uptime,cpu-load,free-memory,total-memory',credentials));
 profiles=parseProfiles(await transport(endpoint,'/rest/ip/hotspot/user/profile?.proplist=.id,name,rate-limit,session-timeout,idle-timeout,shared-users',credentials));
 }catch(e){error=e instanceof RouterError?e:new RouterError('NETWORK')}
 transaction(db.sql,()=>{const current=row(db,networkId);if(current?.lease_token!==token||current.version!==c.version)throw new RouterError('STALE',409);
 if(error)db.sql.prepare("UPDATE mikrotik_connections SET status='error',last_error=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE network_id=?").run(error.code,now,networkId);
 else{db.sql.prepare('DELETE FROM mikrotik_profiles WHERE network_id=?').run(networkId);for(const p of profiles)db.sql.prepare('INSERT INTO mikrotik_profiles VALUES(?,?,?,?,?)').run(networkId,p.id,p.name,JSON.stringify(p.properties),p.fingerprint);db.sql.prepare("UPDATE mikrotik_connections SET status='healthy',last_error=NULL,lease_token=NULL,lease_until=NULL,last_success=?,system_json=?,sync_version=sync_version+1,updated_at=? WHERE network_id=?").run(now,JSON.stringify(system),now,networkId)}
 db.sql.prepare('INSERT INTO mikrotik_checks VALUES(?,?,?,?,?)').run(randomUUID(),networkId,c.version,error?.code||'OK',now);db.sql.prepare('DELETE FROM mikrotik_checks WHERE network_id=? AND id NOT IN (SELECT id FROM mikrotik_checks WHERE network_id=? ORDER BY created_at DESC,id DESC LIMIT 100)').run(networkId,networkId);audit(db,networkId,actor.userId,error?'MIKROTIK_SYNC_FAILED':'MIKROTIK_SYNCED',error?'نتيجة الفحص: '+error.code:'استيراد '+profiles.length+' Profile',now);
 });if(error)throw error;return {profiles:profiles.length};
}
export function routerView(db,actor,networkId,env=process.env,now=Date.now()){
 owned(db,actor,networkId);const target=approvedTarget(networkId,env);const c=row(db,networkId);let status=c?.status||'unconfigured';if(!target)status='not_approved';else if(c?.sealed_credentials&&c.endpoint!==target)status='target_changed';else if(status==='syncing'&&c.lease_until<=now)status='interrupted';else if(status==='healthy'&&now-c.last_success>FRESH_MS)status='stale';
 const profiles=db.sql.prepare('SELECT remote_id,name,properties,fingerprint FROM mikrotik_profiles WHERE network_id=? ORDER BY name').all(networkId).map(p=>({...p,properties:JSON.parse(p.properties)}));
 const categories=db.sql.prepare('SELECT c.id,c.name,b.remote_id,b.profile_name,b.fingerprint,b.version FROM categories c LEFT JOIN mikrotik_bindings b ON b.category_id=c.id WHERE c.network_id=? ORDER BY c.name').all(networkId).map(c=>({...c,valid:status==='healthy'&&profiles.some(p=>p.remote_id===c.remote_id&&p.fingerprint===c.fingerprint)}));
 return {approved:Boolean(target),endpoint:target,configured:Boolean(c?.sealed_credentials),version:c?.version||0,syncVersion:c?.sync_version||0,status,lastAttempt:c?.last_attempt||null,lastSuccess:c?.last_success||null,error:c?.last_error?routerErrorLabels[c.last_error]||'تعذر الاتصال':null,system:c?.system_json?JSON.parse(c.system_json):null,profiles,categories,checks:db.sql.prepare('SELECT id,outcome,created_at FROM mikrotik_checks WHERE network_id=? ORDER BY created_at DESC,id DESC LIMIT 10').all(networkId)};
}
export function bindProfile(db,actor,{networkId,categoryId,remoteId,expectedVersion,connectionVersion,syncVersion},env=process.env,now=Date.now()){
 owned(db,actor,networkId);for(const v of [expectedVersion,connectionVersion,syncVersion])version(v);return transaction(db.sql,()=>{if(!db.sql.prepare('SELECT id FROM categories WHERE id=? AND network_id=?').get(categoryId,networkId))fail('الفئة غير موجودة',404);const c=row(db,networkId);if(!c||c.status!=='healthy'||c.version!==connectionVersion||c.sync_version!==syncVersion||now-c.last_success>FRESH_MS||c.endpoint!==approvedTarget(networkId,env))fail('حدّث Profiles واختبر الاتصال قبل الربط',409);
 const p=db.sql.prepare('SELECT * FROM mikrotik_profiles WHERE network_id=? AND remote_id=?').get(networkId,remoteId);if(!p)fail('الـProfile غير موجود',404);const old=db.sql.prepare('SELECT version FROM mikrotik_bindings WHERE category_id=?').get(categoryId);if((old?.version||0)!==expectedVersion)fail('تغير ربط الفئة؛ حدّث الصفحة',409);
 db.sql.prepare('INSERT INTO mikrotik_bindings VALUES(?,?,?,?,?,?,?) ON CONFLICT(category_id) DO UPDATE SET remote_id=excluded.remote_id,profile_name=excluded.profile_name,fingerprint=excluded.fingerprint,version=excluded.version,updated_at=excluded.updated_at').run(categoryId,networkId,p.remote_id,p.name,p.fingerprint,expectedVersion+1,now);audit(db,networkId,actor.userId,'MIKROTIK_PROFILE_BOUND',JSON.stringify({categoryId,profile:p.name}),now);return {ok:true};});
}
export function unbindProfile(db,actor,{networkId,categoryId,expectedVersion},now=Date.now()){
 owned(db,actor,networkId);version(expectedVersion);return transaction(db.sql,()=>{const old=db.sql.prepare('SELECT * FROM mikrotik_bindings WHERE category_id=? AND network_id=?').get(categoryId,networkId);if(!old||old.version!==expectedVersion)fail('تغير ربط الفئة؛ حدّث الصفحة',409);db.sql.prepare("UPDATE mikrotik_bindings SET remote_id='',profile_name='',fingerprint='',version=version+1,updated_at=? WHERE category_id=?").run(now,categoryId);audit(db,networkId,actor.userId,'MIKROTIK_PROFILE_UNBOUND','فصل ربط الفئة '+categoryId,now);return {ok:true};});
}
