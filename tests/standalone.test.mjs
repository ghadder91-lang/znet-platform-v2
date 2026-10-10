import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openDatabase} from '../server/database.mjs';
import {authRequest,sessionUser} from '../server/auth.mjs';
import {handleCore} from '../server/core.mjs';
import {createOrder,recordVerifiedPayment,commerceOverview} from '../server/commerce.mjs';
const origin='https://test.local',secret=randomBytes(32).toString('base64');
async function auth(db,data,cookie=''){const r=await authRequest(new Request(origin+'/api/auth',{method:'POST',headers:{origin,'content-type':'application/json',cookie},body:JSON.stringify(data)}),db,origin);return {status:r.status,cookie:r.headers.get('set-cookie'),data:await r.json()};}
async function seed(db){const actor={userId:randomUUID(),email:randomUUID()+'@example.test',role:'admin'};async function call(op,data){const r=await handleCore(new Request(origin+'/api/core',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({op,...data})}),db,actor,{vaultKey:secret});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;}
const n=await call('createNetwork',{name:'شبكة اختبار',phone:'770000000',province:'صنعاء',district:'معين'});const c=await call('createCategory',{networkId:n.id,name:'فئة',price:500,dataMb:500,hours:5,validDays:3,lowThreshold:0});db.sql.prepare("UPDATE networks SET status='active' WHERE id=?").run(n.id);await call('import',{networkId:n.id,categoryId:c.id,raw:'0000000001,password',requestKey:randomUUID()});return {actor,networkId:n.id,categoryId:c.id};}
test('standalone sessions and recovery revoke previous access and do not trust identity headers',async()=>{
 const db=openDatabase(':memory:');const data={email:'owner@example.test',password:'long-private-password',name:'مالك الشبكة'};
 const reg=await auth(db,{op:'register',...data});assert.equal(reg.status,201);assert.ok(reg.data.recoveryCode);assert.equal(db.sql.prepare('SELECT role FROM auth_users').get().role,'owner');
 const login=await auth(db,{op:'login',...data});assert.equal(login.status,200);assert.match(login.cookie,/HttpOnly/);assert.match(login.cookie,/Secure/);assert.equal(sessionUser(db,login.cookie).email,data.email);
 const bad=await auth(db,{op:'login',...data,password:'wrong-password-value'});assert.equal(bad.status,401);
 const reset=await auth(db,{op:'recover',...data,password:'new-private-password',recoveryCode:reg.data.recoveryCode});assert.equal(reset.status,200);assert.equal(sessionUser(db,login.cookie),null);
 assert.equal((await auth(db,{op:'recover',...data,recoveryCode:reg.data.recoveryCode})).status,400);
 const again=await auth(db,{op:'login',...data,password:'new-private-password'});assert.equal(again.status,200);await auth(db,{op:'logout'},again.cookie);assert.equal(sessionUser(db,again.cookie),null);
 assert.equal(sessionUser(db,'oai-authenticated-user-id=admin'),null);db.sql.close();
});
test('confirmed payments allocate one card, balance ledger, deduplicate, and retain exceptions in suspense',async()=>{
 const db=openDatabase(':memory:'),s=await seed(db);const order=createOrder(db,s.actor,{...s,requestKey:randomUUID()},500);
 const event={provider:'test_provider',reference:'payment-1',orderId:order.id,amount:500};assert.equal(recordVerifiedPayment(db,event).outcome,'paid');assert.equal(recordVerifiedPayment(db,event).replayed,true);
 assert.equal(db.sql.prepare("SELECT COUNT(*) n FROM vouchers WHERE status='sold'").get().n,1);
 const sums=db.sql.prepare('SELECT SUM(debit) d,SUM(credit) c FROM ledger_entries').get();assert.equal(sums.d,500);assert.equal(sums.c,500);
 assert.equal(db.sql.prepare("SELECT SUM(credit) n FROM ledger_entries WHERE account='network_payable'").get().n,475);
 assert.throws(()=>recordVerifiedPayment(db,{...event,amount:600}),/تعارض/);
 assert.equal(recordVerifiedPayment(db,{...event,reference:'payment-2'}).outcome,'exception');
 assert.equal(db.sql.prepare("SELECT SUM(credit) n FROM ledger_entries WHERE account='payment_suspense'").get().n,500);
 assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM incidents').get().n,1);
 assert.throws(()=>db.sql.prepare('DELETE FROM ledger_entries').run(),/append-only/);
 assert.throws(()=>commerceOverview(db,{userId:'other'},s.networkId),/غير موجودة/);db.sql.close();
});
test('last voucher cannot fulfill two pending orders; unmatched amount is accounted for',async()=>{
 const db=openDatabase(':memory:'),s=await seed(db);const a=createOrder(db,s.actor,{...s,requestKey:randomUUID()},500),b=createOrder(db,s.actor,{...s,requestKey:randomUUID()},500);
 recordVerifiedPayment(db,{provider:'test_provider',reference:'a',orderId:a.id,amount:500});
 const result=recordVerifiedPayment(db,{provider:'test_provider',reference:'b',orderId:b.id,amount:500});assert.equal(result.incident,'STOCK_UNAVAILABLE');
 assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM journals').get().n,2);assert.equal(db.sql.prepare("SELECT COUNT(*) n FROM orders WHERE status='paid'").get().n,1);db.sql.close();
});
test('on-disk database backup and restore preserve encrypted inventory; wrong key is rejected',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'znet-restore-'));try{const source=join(dir,'source.sqlite'),db=openDatabase(source);await seed(db);const sealed=db.sql.prepare('SELECT sealed FROM vouchers').get().sealed;db.sql.close();
 const env={...process.env,DATABASE_PATH:source,BACKUP_DIR:join(dir,'backups'),VOUCHER_VAULT_KEY:secret};
 const run=spawnSync(process.execPath,['scripts/backup.mjs'],{env,encoding:'utf8'});assert.equal(run.status,0,run.stderr);const backup=run.stdout.split('\n').find(x=>x.startsWith('Backup completed: ')).slice(18);const sourceFiles=readdirSync(backup).sort();
 const target=join(dir,'restored.sqlite');let restore=spawnSync(process.execPath,['scripts/restore.mjs',backup],{env:{...env,DATABASE_PATH:target,VOUCHER_VAULT_KEY:randomBytes(32).toString('base64')},encoding:'utf8'});assert.notEqual(restore.status,0);
 restore=spawnSync(process.execPath,['scripts/restore.mjs',backup],{env:{...env,DATABASE_PATH:target},encoding:'utf8'});assert.equal(restore.status,0,restore.stderr);assert.deepEqual(readdirSync(backup).sort(),sourceFiles,'restore must not create SQLite sidecars in backup source');
 const restored=openDatabase(target);assert.equal(restored.sql.prepare('SELECT sealed FROM vouchers').get().sealed,sealed);assert.equal(restored.sql.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n,11);restored.sql.close();
 }finally{rmSync(dir,{recursive:true,force:true})}
});
