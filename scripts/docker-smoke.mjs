// Isolated container verification: no host ports, production files or provider calls.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const image=process.argv[2];
if(!image)throw Error('Usage: node scripts/docker-smoke.mjs IMAGE_TAG');
const prefix='znet-ci-'+randomUUID(),container=prefix+'-app';
const data=prefix+'-data',restored=prefix+'-restored',backups=prefix+'-backups';
const dir=mkdtempSync(join(tmpdir(),'znet-container-')),envFile=join(dir,'test.env');
writeFileSync(envFile,[
 'APP_ORIGIN=http://127.0.0.1:3000',
 'VOUCHER_VAULT_KEY='+randomBytes(32).toString('base64'),
 'ALLOW_REGISTRATION=true','SANDBOX_ENABLED=true','MIKROTIK_ENABLED=false',
 'DATABASE_PATH=/app/data/znet.sqlite','SANDBOX_DATABASE_PATH=/app/data/sandbox.sqlite',
 'BACKUP_DIR=/app/backups','NEXT_TELEMETRY_DISABLED=1',
].join('\n')+'\n',{mode:0o600});
function docker(args,{allowFailure=false}={}){
 const result=spawnSync('docker',args,{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
 if(!allowFailure&&(result.error||result.status!==0))throw Error(result.stderr||result.error?.message||'Docker command failed');
 return result.stdout||'';
}
function start(volume){
 docker(['run','--detach','--name',container,'--env-file',envFile,
  '--security-opt','no-new-privileges:true','--volume',volume+':/app/data',
  '--volume',backups+':/app/backups',image]);
 docker(['exec',container,'node','--input-type=module','-e',`
  import {setTimeout} from 'node:timers/promises';
  let ready=false;
  for(let i=0;i<60;i++){
   try{if((await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(2000)})).ok){ready=true;break}}catch{}
   await setTimeout(1000);
  }
  if(!ready)throw Error('Container health check timed out');
  if(process.getuid()===0)throw Error('Application must not run as root');
 `]);
}
const apiPrelude=`
 import assert from 'node:assert/strict';
 const base='http://127.0.0.1:3000';let cookie='';
 const post=async(path,body)=>{
  const r=await fetch(base+path,{method:'POST',headers:{origin:base,'content-type':'application/json',cookie},body:JSON.stringify(body)});
  const data=await r.json();assert.ok(r.ok,JSON.stringify({status:r.status,data}));
  const session=r.headers.get('set-cookie');if(session)cookie=session.split(';')[0];return data;
 };
 const get=async(path)=>{const r=await fetch(base+path,{headers:{cookie}});assert.ok(r.ok);return r.json()};
 const login=()=>post('/api/auth',{op:'login',email:'container@example.test',password:'container-test-password'});
`;
function api(code){return docker(['exec',container,'node','--input-type=module','-e',apiPrelude+code]);}
function verifyInventory(){
 api(`
  await login();const state=await get('/api/core');
  assert.equal(state.networks.length,1);const networkId=state.networks[0].id;
  assert.equal(state.networks[0].stock,1);
  const inventory=await post('/api/core',{op:'inventory',networkId,page:1});
  assert.equal(inventory.rows.length,1);
  const card=await post('/api/core',{op:'reveal',networkId,voucherId:inventory.rows[0].id});
  assert.equal(card.username,'000000001');assert.equal(card.password,'container-card-password');
 `);
}
try{
 start(data);
 api(`
  await post('/api/auth',{op:'register',email:'container@example.test',password:'container-test-password',name:'اختبار الحاوية'});
  await login();
  const network=await post('/api/core',{op:'createNetwork',name:'شبكة اختبار الحاوية',phone:'770000000',province:'صنعاء',district:'معين'});
  const category=await post('/api/core',{op:'createCategory',networkId:network.id,name:'فئة اختبار',price:500,dataMb:500,hours:3,validDays:2,lowThreshold:2});
  await post('/api/core',{op:'import',networkId:network.id,categoryId:category.id,raw:'000000001,container-card-password',requestKey:crypto.randomUUID()});
  const html=await (await fetch(base+'/',{headers:{cookie}})).text();
  const paths=[...new Set([...html.matchAll(/(?:src|href)="([^" ]*\\/_next\\/static\\/[^" ]+)"/g)].map(m=>m[1].replaceAll('&amp;','&')))];
  assert.ok(paths.length,'HTML must reference bundled assets');
  for(const path of [...paths,'/favicon.svg']){
   const response=await fetch(new URL(path,base));assert.equal(response.status,200,path);
   assert.ok((await response.arrayBuffer()).byteLength>0,path);
  }
  await post('/api/lab',{op:'seed'});
  const order=await post('/api/lab',{op:'create',smsFailures:0,requestKey:crypto.randomUUID()});
  assert.equal((await post('/api/lab',{op:'pay',orderId:order.orderId})).outcome,'paid');
 `);
 console.log('Container HTTP, assets, authentication and inventory passed.');
 for(const worker of ['delivery-worker','forecast-worker']){
  const output=docker(['run','--rm','--env-file',envFile,'--volume',data+':/app/data',image,'node','scripts/'+worker+'.mjs','--once']);
  assert.doesNotMatch(output,/iteration_failed/);
 }
 api(`await login();const lab=await get('/api/lab');assert.equal(lab.orders.length,1);const jobs=lab.orders[0].deliveries;assert.equal(jobs.find(j=>j.channel==='wallet').status,'available');assert.equal(jobs.find(j=>j.channel==='sms').status,'delivered');`);
 console.log('Isolated sandbox delivery and forecast workers passed.');
 docker(['rm','--force',container]);start(data);verifyInventory();
 console.log('Recreated container retained the account and encrypted inventory.');
 const result=docker(['exec',container,'node','scripts/backup.mjs']);
 const backupPath=result.split('\n').find(line=>line.startsWith('Backup completed: '))?.slice(18);
 assert.ok(backupPath?.startsWith('/app/backups/'));
 docker(['rm','--force',container]);
 docker(['run','--rm','--env-file',envFile,'--volume',restored+':/app/data',
  '--volume',backups+':/app/backups:ro',image,'node','scripts/restore.mjs',backupPath]);
 start(restored);verifyInventory();
 console.log('Backup restored into a fresh volume; encrypted card and account verified.');
 console.log('Docker runtime verification passed. No production deployment performed.');
}catch(error){
 console.error(docker(['logs','--tail','60',container],{allowFailure:true}));
 throw error;
}finally{
 docker(['rm','--force',container],{allowFailure:true});
 for(const volume of [data,restored,backups])docker(['volume','rm',volume],{allowFailure:true});
 rmSync(dir,{recursive:true,force:true});
}
