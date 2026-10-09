import {randomBytes,randomUUID,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {transaction} from './database.mjs';
import {boundedBody} from './request-guards.mjs';
const scrypt=promisify(scryptCallback),ttl=7*86400000;
export const digest=s=>createHash('sha256').update(s).digest('hex');
export async function hashPassword(value){const salt=randomBytes(16).toString('hex');return salt+':'+Buffer.from(await scrypt(value,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024})).toString('hex');}
async function verify(value,hash){try{const [salt,key]=hash.split(':');const actual=await scrypt(value,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});return timingSafeEqual(Buffer.from(key,'hex'),actual)}catch{return false}}
export function sessionUser(db,cookie=''){
 const token=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('znet_session='))?.slice(13);if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
 const u=db.sql.prepare('SELECT a.id AS userId,a.email,a.name AS displayName,u.role FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id JOIN accounts a ON a.id=u.id WHERE s.token_hash=? AND s.expires_at>?').get(digest(token),Date.now());return u||null;
}
function budget(sql,key,limit,ms){const now=Date.now();return !!sql.prepare(`INSERT INTO auth_attempts(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END WHERE expires_at<=? OR count<? RETURNING key`).get(key,now+ms,now,now,now,limit)}
export async function createUser(db,{email,password,name,role='owner'}){
 const id=randomUUID(),recovery=randomBytes(24).toString('base64url'),pw=await hashPassword(password);
 transaction(db.sql,()=>{db.sql.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run(id,email,name,Date.now());db.sql.prepare('INSERT INTO auth_users VALUES(?,?,?,?,?,?)').run(id,email,pw,role,digest(recovery),Date.now());});return {id,recovery};
}
export async function authRequest(request,db,origin){
 const reply=(data,status=200,cookie)=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})}});
 const secure=new URL(origin).protocol==='https:'?'; Secure':'';
 if(request.method!=='POST')return reply({error:'طريقة غير مسموحة'},405);
 if(request.headers.get('origin')!==origin||request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'مصدر الطلب غير مسموح'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'طلب غير صالح'},415);
 try{
 const data=JSON.parse(await boundedBody(request,4096));
 if(data.op==='logout'){const token=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('znet_session='))?.slice(13);if(token)db.sql.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(digest(token));return reply({ok:true},200,'znet_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'+secure);}
 const email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof data.password!=='string'||data.password.length<12||data.password.length>128)return reply({error:'أدخل بريدًا صحيحًا وكلمة مرور من 12 إلى 128 حرفًا.'},400);
 if(!['login','register','recover'].includes(data.op))return reply({error:'عملية غير معروفة'},400);
 if(!budget(db.sql,'global:'+data.op, data.op==='register'?30:300,3600000)||!budget(db.sql,data.op+':'+digest(email),10,900000))return reply({error:'محاولات كثيرة. انتظر 15 دقيقة ثم حاول مجددًا.'},429);
 const u=db.sql.prepare('SELECT * FROM auth_users WHERE email=?').get(email);
 if(data.op==='register'){
  if(process.env.ALLOW_REGISTRATION==='false')return reply({error:'التسجيل مغلق حاليًا.'},403);
  if(typeof data.name!=='string'||data.name.trim().length<2||data.name.length>80)return reply({error:'أدخل اسمك من 2 إلى 80 حرفًا.'},400);
  if(u)return reply({error:'تعذر إنشاء الحساب بهذه البيانات. استخدم الدخول أو استعادة الحساب.'},400);
  const user=await createUser(db,{email,password:data.password,name:data.name.trim()});return reply({ok:true,recoveryCode:user.recovery},201);
 }
 if(data.op==='recover'){
  const code=typeof data.recoveryCode==='string'?data.recoveryCode:'';
  if(!u||code.length>100||digest(code)!==u.recovery_hash)return reply({error:'بيانات الاستعادة غير صحيحة.'},400);
  const pw=await hashPassword(data.password),recovery=randomBytes(24).toString('base64url');
  const changed=transaction(db.sql,()=>{const r=db.sql.prepare('UPDATE auth_users SET password_hash=?,recovery_hash=? WHERE id=? AND recovery_hash=?').run(pw,digest(recovery),u.id,digest(code));if(r.changes)db.sql.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(u.id);return r.changes;});
  if(!changed)return reply({error:'رمز الاستعادة مستخدم أو غير صالح.'},409);return reply({ok:true,recoveryCode:recovery});
 }
 // Equal-cost hashing for unknown emails avoids the fast nonexistent-user path.
 const valid=await verify(data.password,u?.password_hash||'00000000000000000000000000000000:'+ '00'.repeat(64));
 if(!u||!valid)return reply({error:'البريد أو كلمة المرور غير صحيحة.'},401);
 const token=randomBytes(32).toString('hex'),now=Date.now();
 transaction(db.sql,()=>{const current=db.sql.prepare('SELECT password_hash FROM auth_users WHERE id=?').get(u.id);if(current?.password_hash!==u.password_hash)throw Error('Credentials changed during sign-in');db.sql.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(now);db.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(digest(token),u.id,now+ttl,now);db.sql.prepare('DELETE FROM auth_sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM auth_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 5)').run(u.id,u.id);});
 return reply({ok:true},200,'znet_session='+token+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+ttl/1000+secure);
 }catch(e){return reply({error:e?.constructor?.name==='BodyTooLarge'?'الطلب أكبر من المسموح.':'تعذر إتمام الطلب. تحقق من البيانات وحاول مجددًا.'},400);}
}
