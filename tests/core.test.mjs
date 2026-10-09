import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {handleCore,parseCards,inventoryCsv} from '../server/core.mjs';
const alice={userId:'owner-a',email:'a@example.test',displayName:'Owner A'},bob={userId:'owner-b',email:'b@example.test',displayName:'Owner B'};
const secret=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
function fixture(){const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));const db={prepare(query){return {bind(...args){const s=sql.prepare(query);return {async first(){return s.get(...args)||null},async all(){return {results:s.all(...args)}},async run(){return s.run(...args)}}}}},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}}};async function call(op,data,actor=alice,origin='https://test.local'){const url='https://test.local/api/core'+(data?'':'?op='+op);const req=new Request(url,{method:data?'POST':'GET',headers:data?{'content-type':'application/json',origin}:undefined,body:data?JSON.stringify({op,...data}):undefined});const response=await handleCore(req,db,actor,{vaultKey:secret,adminEmails:'admin@example.test'});return {status:response.status,data:await response.json()};}return {sql,db,call};}
async function seed(f){const n=await f.call('createNetwork',{name:'شبكة تجريبية',phone:'770000000',province:'صنعاء',district:'معين'});assert.equal(n.status,201);const networkId=n.data.id;const c=await f.call('createCategory',{networkId,name:'فئة 100',price:100,dataMb:400,hours:4,validDays:3,lowThreshold:20});assert.equal(c.status,201);return {networkId,categoryId:c.data.id};}
test('anonymous requests and cross-origin writes are rejected',async()=>{const f=fixture();assert.equal((await f.call('bootstrap',undefined,null)).status,401);assert.equal((await f.call('createNetwork',{},alice,'https://evil.test')).status,403)});
test('owner isolation covers read, import, update and admin',async()=>{const f=fixture(),ids=await seed(f);assert.equal((await f.call('bootstrap',undefined,bob)).data.networks.length,0);for(const op of ['updateNetwork','createCategory','previewImport','reveal'])assert.equal((await f.call(op,{...ids,name:'hacked'},bob)).status,404);assert.equal((await f.call('admin',undefined,bob)).status,403);});
test('import encrypts credentials, deduplicates and survives new request',async()=>{const f=fixture(),ids=await seed(f);const raw='username,password\n0000012345,secret-password\n0000012345,different\n0000012346,other';const p=await f.call('previewImport',{...ids,raw});assert.deepEqual(p.data,{total:3,newCount:2,duplicates:1});const payload={...ids,raw,requestKey:crypto.randomUUID()};const r=await f.call('import',payload);assert.equal(r.status,201);assert.equal(r.data.count,2);const stored=f.sql.prepare('SELECT * FROM vouchers').all();assert.equal(stored.length,2);assert.ok(stored.every(v=>!v.sealed.includes('secret-password')&&!v.sealed.includes('0000012345')));assert.equal((await f.call('bootstrap')).data.networks[0].stock,2);const reveal=await f.call('reveal',{networkId:ids.networkId,voucherId:stored[0].id});assert.equal(reveal.data.username,'0000012345');assert.equal(reveal.data.password,'secret-password');const again=await f.call('import',payload);assert.equal(again.status,200);assert.equal(again.data.replayed,true);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM vouchers').get().n,2);assert.equal((await f.call('import',{...payload,raw:'9999999999,new'})).status,409);assert.equal((await f.call('previewImport',{...ids,raw})).data.newCount,0);});
test('duplicate constraints rollback an entire batch',async()=>{const f=fixture(),ids=await seed(f);await f.call('import',{...ids,raw:'0123456789,test',requestKey:crypto.randomUUID()});const old=f.sql.prepare('SELECT * FROM vouchers').get();const before=f.sql.prepare('SELECT COUNT(*) n FROM batches').get().n;await assert.rejects(f.db.batch([f.db.prepare('INSERT INTO batches VALUES(?,?,?,?,?,?,?,?)').bind('will-rollback',ids.networkId,ids.categoryId,alice.userId,'unique-request-key','hash',1,1),f.db.prepare('INSERT INTO vouchers VALUES(?,?,?,?,?,?,?,?,?)').bind('new-id',ids.networkId,ids.categoryId,'will-rollback',old.fingerprint,'sealed','789','available',1)]));assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM batches').get().n,before);});
test('validation rejects invalid data and preserves leading zeros',()=>{assert.equal(parseCards('0000012345')[0].username,'0000012345');assert.throws(()=>parseCards('<script>,bad'));assert.throws(()=>parseCards(Array(102).fill('123').join('\n')));assert.throws(()=>parseCards('username,password'));});
test('server validates numeric values and administrator permissions',async()=>{const f=fixture(),ids=await seed(f);const r=await f.call('createCategory',{...ids,name:'bad',price:-1,dataMb:1,hours:1,validDays:1,lowThreshold:1});assert.equal(r.status,400);assert.equal((await f.call('reviewNetwork',{networkId:ids.networkId,status:'active'},bob)).status,403);assert.equal((await f.call('reviewNetwork',{networkId:ids.networkId,status:'active',expectedUpdatedAt:f.sql.prepare('SELECT updated_at FROM networks WHERE id=?').get(ids.networkId).updated_at},{userId:'admin',email:'admin@example.test'})).status,200);assert.equal((await f.call('bootstrap')).data.networks[0].status,'active');});
test('inventory pagination, exact encrypted search and masking',async()=>{const f=fixture(),ids=await seed(f);const records=Array.from({length:60},(_,i)=>String(i).padStart(10,'0')+',secret').join('\n');await f.call('import',{...ids,raw:records,requestKey:crypto.randomUUID()});const a=await f.call('inventory',{networkId:ids.networkId,page:1});const b=await f.call('inventory',{networkId:ids.networkId,page:2});assert.equal(a.data.total,60);assert.equal(a.data.rows.length,25);assert.equal(b.data.rows.length,25);assert.equal(new Set([...a.data.rows,...b.data.rows].map(r=>r.id)).size,50);assert.ok(a.data.rows.every(r=>!('sealed' in r)&&!('username' in r)&&!('fingerprint' in r)));const exact=await f.call('inventory',{networkId:ids.networkId,username:'0000000004'});assert.equal(exact.data.total,1);assert.equal(exact.data.rows[0].suffix,'004');assert.equal((await f.call('inventory',{networkId:ids.networkId,username:'0000000004'},bob)).status,404);});
test('status change is conditional, reversible and audited once',async()=>{const f=fixture(),ids=await seed(f);await f.call('import',{...ids,raw:'0123456789,pw',requestKey:crypto.randomUUID()});const voucherId=f.sql.prepare('SELECT id FROM vouchers').get().id;const data={networkId:ids.networkId,voucherId,expectedStatus:'available',status:'disabled'};assert.equal((await f.call('setVoucherStatus',data,bob)).status,404);assert.equal((await f.call('setVoucherStatus',data)).status,200);assert.equal((await f.call('bootstrap')).data.networks[0].stock,0);assert.equal((await f.call('setVoucherStatus',data)).status,409);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit WHERE event='VOUCHER_STATUS_CHANGED'").get().n,1);assert.equal((await f.call('inventory',{networkId:ids.networkId,status:'disabled'})).data.total,1);assert.equal((await f.call('setVoucherStatus',{...data,expectedStatus:'disabled',status:'available'})).status,200);assert.equal((await f.call('bootstrap')).data.networks[0].stock,1);assert.equal((await f.call('setVoucherStatus',{...data,status:'sold'})).status,400);});
test('category updates and exports preserve tenant isolation',async()=>{const f=fixture(),ids=await seed(f);const update={...ids,name:'=SUM(1)',price:200,dataMb:500,hours:5,validDays:4,lowThreshold:5};assert.equal((await f.call('updateCategory',update,bob)).status,404);assert.equal((await f.call('updateCategory',update)).status,200);assert.equal(f.sql.prepare('SELECT price FROM categories WHERE id=?').get(ids.categoryId).price,200);await f.call('import',{...ids,raw:'0123456789,password-secret',requestKey:crypto.randomUUID()});assert.equal((await f.call('exportInventory',{networkId:ids.networkId},bob)).status,404);const r=await f.call('exportInventory',{networkId:ids.networkId});assert.equal(r.status,200);assert.equal(r.data.count,1);assert.ok(!r.data.csv.includes('password-secret')&&!r.data.csv.includes('0123456789'));assert.ok(r.data.csv.includes("'=SUM(1)"));assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit WHERE event='INVENTORY_EXPORTED'").get().n,1);});
test('batch listing GET enforces network ownership and CSV escapes formula injection',async()=>{const f=fixture(),ids=await seed(f);await f.call('import',{...ids,raw:'0123456789,pass',requestKey:crypto.randomUUID()});const url='https://test.local/api/core?'+new URLSearchParams({op:'listBatches',networkId:ids.networkId,page:'1'});const own=await handleCore(new Request(url),f.db,alice,{});assert.equal(own.status,200);assert.equal((await own.json()).rows.length,1);assert.equal((await handleCore(new Request(url),f.db,bob,{})).status,404);const csv=inventoryCsv([{id:'a',suffix:'789',category_name:' @HYPERLINK("bad")',price:1,status:'available',batch_id:'b',created_at:1}]);assert.ok(csv.includes("' @HYPERLINK"));assert.ok(csv.includes('""bad""'));});
test('persistent alerts resolve on replenishment and reopen unread after stock drops',async()=>{const f=fixture(),ids=await seed(f);let result=await f.call('notifications',{status:'open'});assert.equal(result.data.total,1);await f.call('readAlert',{...ids});assert.ok(f.sql.prepare('SELECT read_at FROM stock_alerts').get().read_at);await f.call('import',{...ids,raw:Array.from({length:25},(_,i)=>String(i).padStart(10,'0')).join('\n'),requestKey:crypto.randomUUID()});assert.equal((await f.call('notifications',{status:'open'})).data.total,0);assert.equal((await f.call('notifications',{status:'resolved'})).data.total,1);const cards=f.sql.prepare('SELECT id FROM vouchers LIMIT 6').all();for(const v of cards)await f.call('setVoucherStatus',{networkId:ids.networkId,voucherId:v.id,expectedStatus:'available',status:'disabled'});result=await f.call('notifications',{status:'open'});assert.equal(result.data.total,1);assert.equal(result.data.rows[0].stock,19);assert.equal(result.data.rows[0].read_at,null);assert.equal((await f.call('notifications',{},bob)).data.total,0);assert.equal((await f.call('readAlert',ids,bob)).status,404);});
test('admin rejection requires a reason and rejects stale concurrent review',async()=>{const f=fixture(),ids=await seed(f),admin={userId:'admin',email:'admin@example.test'};const version=f.sql.prepare('SELECT updated_at FROM networks').get().updated_at;assert.equal((await f.call('reviewNetwork',{networkId:ids.networkId,status:'rejected',expectedUpdatedAt:version,reason:''},admin)).status,400);assert.equal((await f.call('reviewNetwork',{networkId:ids.networkId,status:'rejected',expectedUpdatedAt:version,reason:'يرجى تصحيح رقم هاتف الشبكة'},admin)).status,200);assert.equal((await f.call('bootstrap')).data.networks[0].review_note,'يرجى تصحيح رقم هاتف الشبكة');assert.equal((await f.call('reviewNetwork',{networkId:ids.networkId,status:'active',expectedUpdatedAt:version},admin)).status,409);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit WHERE event='NETWORK_REVIEWED'").get().n,1);});
test('audit and admin queue filters are scoped and dates validated',async()=>{const f=fixture(),ids=await seed(f);const get=(op,params,actor=alice)=>handleCore(new Request('https://test.local/api/core?'+new URLSearchParams({op,...params})),f.db,actor,{adminEmails:'admin@example.test'});const a=await get('activity',{networkId:ids.networkId,event:'CATEGORY_CREATED'});assert.equal((await a.json()).total,1);assert.equal((await get('activity',{networkId:ids.networkId},bob)).status,404);assert.equal((await get('activity',{networkId:ids.networkId,from:'2026-02-31'})).status,400);assert.equal((await get('activity',{networkId:ids.networkId,from:'2026-10-10',to:'2026-10-01'})).status,400);assert.equal((await get('reviewQueue',{status:'pending'})).status,403);const q=await get('reviewQueue',{status:'pending',search:'شبكة'},{userId:'admin',email:'admin@example.test'});assert.equal((await q.json()).total,1);const none=await get('reviewQueue',{status:'pending',search:"' OR 1=1 --"},{userId:'admin',email:'admin@example.test'});assert.equal((await none.json()).total,0);});
test('CSV preserves quoted passwords, spaces and delimiters without silently rewriting credentials',()=>{
 assert.deepEqual(parseCards('\uFEFF"username","password"\r\n"00001"," a,b;""c"" "'),[{username:'00001',password:' a,b;"c" '}]);
 assert.deepEqual(parseCards('username;password\n00002;"a;b,c"'),[{username:'00002',password:'a;b,c'}]);
 assert.deepEqual(parseCards('username\tpassword\n00003\tpw,with;punctuation'),[{username:'00003',password:'pw,with;punctuation'}]);
 assert.equal(parseCards('00004, space ')[0].password,' space ');
 for(const bad of ['00001,"unclosed','00001,"closed"junk','00001,bad"quote','00001,a,b','username,password\n00001,"line\nbreak"'])assert.throws(()=>parseCards(bad));
});
test('two-owner operating cycle isolates stock, secrets, alerts and audit through review and reimport',async()=>{
 const f=fixture(),a=await seed(f);
 const bNet=await f.call('createNetwork',{name:'شبكة ثانية',phone:'771000000',province:'عدن',district:'المنصورة'},bob);
 const bCat=await f.call('createCategory',{networkId:bNet.data.id,name:'فئة ثانية',price:200,dataMb:500,hours:5,validDays:3,lowThreshold:0},bob);
 const b={networkId:bNet.data.id,categoryId:bCat.data.id};
 const admin={userId:'admin',email:'admin@example.test'};
 for(const ids of [a,b]){
  const n=f.sql.prepare('SELECT updated_at FROM networks WHERE id=?').get(ids.networkId);
  assert.equal((await f.call('reviewNetwork',{networkId:ids.networkId,status:'active',expectedUpdatedAt:n.updated_at},admin)).status,200);
 }
 const payload={...a,raw:'"username","password"\n"00000001"," a,""b"" "',requestKey:crypto.randomUUID()};
 assert.equal((await f.call('import',payload)).status,201);
 assert.equal((await f.call('import',{...b,raw:'00000001,other-owner',requestKey:crypto.randomUUID()},bob)).status,201);
 const ownCard=(await f.call('inventory',{networkId:a.networkId})).data.rows[0];
 assert.equal((await f.call('reveal',{networkId:a.networkId,voucherId:ownCard.id})).data.password,' a,"b" ');
 assert.equal((await f.call('reveal',{networkId:a.networkId,voucherId:ownCard.id},bob)).status,404);
 assert.equal((await f.call('reveal',{networkId:b.networkId,voucherId:ownCard.id},bob)).status,404);
 await f.call('setVoucherStatus',{networkId:a.networkId,voucherId:ownCard.id,expectedStatus:'available',status:'disabled'});
 assert.equal((await f.call('bootstrap')).data.networks[0].stock,0);
 assert.equal((await f.call('bootstrap',undefined,bob)).data.networks[0].stock,1);
 assert.equal((await f.call('import',payload)).data.replayed,true);
 assert.equal((await f.call('bootstrap')).data.networks[0].stock,0);
 assert.equal((await f.call('notifications',{},bob)).data.total,0);
 assert.equal((await f.call('exportInventory',{networkId:a.networkId},bob)).status,404);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM vouchers').get().n,2);
});
test('rejected requests can be corrected and resubmitted only by their owner with a current version',async()=>{
 const f=fixture(),ids=await seed(f),admin={userId:'admin',email:'admin@example.test'};
 const read=()=>f.sql.prepare('SELECT * FROM networks WHERE id=?').get(ids.networkId);
 const original=read();
 const fields={networkId:ids.networkId,name:'شبكة مصححة',phone:'771234567',province:'عدن',district:'المنصورة',expectedUpdatedAt:original.updated_at};
 assert.equal((await f.call('resubmitNetwork',fields)).status,409);
 await f.call('reviewNetwork',{networkId:ids.networkId,status:'rejected',expectedUpdatedAt:original.updated_at,reason:'صحح رقم التواصل والمحافظة'},admin);
 const rejected=read();
 assert.equal((await f.call('resubmitNetwork',{...fields,expectedUpdatedAt:rejected.updated_at},bob)).status,404);
 assert.equal((await f.call('resubmitNetwork',fields)).status,409);
 assert.equal((await f.call('resubmitNetwork',{...fields,phone:'bad',expectedUpdatedAt:rejected.updated_at})).status,400);
 assert.equal(read().status,'rejected');
 assert.equal((await f.call('resubmitNetwork',{...fields,expectedUpdatedAt:rejected.updated_at})).status,200);
 const pending=read();assert.equal(pending.status,'pending');assert.equal(pending.review_note,'');assert.equal(pending.phone,'771234567');assert.equal(pending.province,'عدن');assert.ok(pending.updated_at>rejected.updated_at);
 assert.equal((await f.call('resubmitNetwork',{...fields,expectedUpdatedAt:rejected.updated_at})).status,409);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit WHERE event='NETWORK_RESUBMITTED'").get().n,1);
 assert.ok(f.sql.prepare("SELECT detail FROM audit WHERE event='NETWORK_REVIEWED'").get().detail.includes('صحح رقم التواصل'));
 assert.equal((await f.call('reviewNetwork',{networkId:ids.networkId,status:'active',expectedUpdatedAt:rejected.updated_at},admin)).status,409);
 assert.equal((await f.call('reviewNetwork',{networkId:ids.networkId,status:'active',expectedUpdatedAt:pending.updated_at},admin)).status,200);
 assert.equal(read().status,'active');
});
test('network edits reject stale versions without overriding a newer decision or writing an audit entry',async()=>{
 const f=fixture(),ids=await seed(f),before=f.sql.prepare('SELECT * FROM networks').get();
 const fields={networkId:ids.networkId,name:'شبكة محدثة',phone:before.phone,province:before.province,district:'مديرية جديدة',expectedUpdatedAt:before.updated_at};
 assert.equal((await f.call('updateNetwork',{...fields,province:''})).status,400);
 assert.equal((await f.call('updateNetwork',fields)).status,200);
 assert.equal((await f.call('updateNetwork',{...fields,name:'تعديل قديم'})).status,409);
 const saved=f.sql.prepare('SELECT * FROM networks').get();assert.equal(saved.name,'شبكة محدثة');assert.equal(saved.district,'مديرية جديدة');assert.equal(saved.status,'pending');
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit WHERE event='NETWORK_UPDATED'").get().n,1);
});
test('request budgets are atomic, account scoped, reusable after expiry and independent by operation',async()=>{
 const {consumeRequest}=await import('../server/request-guards.mjs');const f=fixture(),now=100000;
 const outcomes=await Promise.all(Array.from({length:25},()=>consumeRequest(f.db,alice.userId,'reveal',now)));
 assert.equal(outcomes.filter(x=>x.allowed).length,20);assert.equal(outcomes.filter(x=>!x.allowed).length,5);
 assert.equal(outcomes.find(x=>!x.allowed).retryAfter,60);
 assert.equal((await consumeRequest(f.db,bob.userId,'reveal',now)).allowed,true);
 assert.equal((await consumeRequest(f.db,alice.userId,'inventory',now)).allowed,true);
 assert.equal((await consumeRequest(f.db,alice.userId,'reveal',now+59000)).retryAfter,1);
 assert.equal((await consumeRequest(f.db,alice.userId,'reveal',now+60000)).allowed,true);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM request_limits WHERE id=?').get('reveal:'+alice.userId).n,1);
 assert.equal(f.sql.prepare('SELECT count FROM request_limits WHERE id=?').get('reveal:'+alice.userId).count,1);
});
test('a throttled import returns retry guidance and cannot modify stock or audit',async()=>{
 const f=fixture(),ids=await seed(f);
 for(let i=0;i<10;i++)assert.equal((await f.call('previewImport',{...ids,raw:'00000001,secret'})).status,200);
 const req=new Request('https://test.local/api/core',{method:'POST',headers:{'content-type':'application/json',origin:'https://test.local'},body:JSON.stringify({op:'import',...ids,raw:'00000001,secret',requestKey:crypto.randomUUID()})});
 const response=await handleCore(req,f.db,alice,{vaultKey:secret});assert.equal(response.status,429);assert.ok(Number(response.headers.get('Retry-After'))>0);const data=await response.json();assert.ok(data.requestId);assert.ok(data.retryAfter<=60);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM vouchers').get().n,0);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit WHERE event='VOUCHERS_IMPORTED'").get().n,0);
 assert.equal((await f.call('bootstrap')).status,200);
});
test('body size is bounded by bytes even without Content-Length and before database work',async()=>{
 const {boundedBody,BodyTooLarge}=await import('../server/request-guards.mjs');
 const chunk=new TextEncoder().encode('أ'.repeat(20000));let cancelled=false;
 const stream=new ReadableStream({pull(c){c.enqueue(chunk)},cancel(){cancelled=true}});
 await assert.rejects(boundedBody(new Request('https://test.local',{method:'POST',body:stream,duplex:'half'})),BodyTooLarge);assert.equal(cancelled,true);
 assert.equal(await boundedBody(new Request('https://test.local',{method:'POST',body:'{"a":"ب"}'})),'{"a":"ب"}');
 const f=fixture();const req=new Request('https://test.local/api/core',{method:'POST',headers:{'content-type':'application/json',origin:'https://test.local'},body:JSON.stringify({op:'createNetwork',name:'أ'.repeat(40000)})});
 assert.equal((await handleCore(req,f.db,alice,{})).status,413);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM request_limits').get().n,0);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM networks').get().n,0);
});
