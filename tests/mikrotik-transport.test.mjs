import {test} from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {restGet} from '../server/mikrotik.mjs';
const path='/rest/system/resource?.proplist=version,board-name,uptime,cpu-load,free-memory,total-memory';
test('HTTPS transport verifies TLS, only GETs, rejects redirects, bounds body and times out',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'znet-router-tls-'));let server;try{
 const key=join(dir,'key.pem'),cert=join(dir,'cert.pem');const make=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{encoding:'utf8'});assert.equal(make.status,0,'OpenSSL is required for the local TLS transport test');let mode='ok',count=0;
 server=https.createServer({key:readFileSync(key),cert:readFileSync(cert)},(req,res)=>{count++;assert.equal(req.method,'GET');assert.equal(req.url,path);assert.equal(req.headers.authorization,'Basic '+Buffer.from('test:secret').toString('base64'));if(mode==='timeout')return;if(mode==='redirect'){res.writeHead(302,{Location:'https://127.0.0.1/private'});res.end();return}if(mode==='auth'){res.writeHead(401);res.end('private-router-error-secret');return}if(mode==='large'){res.end('x'.repeat(524289));return}if(mode==='malformed'){res.end('not-json');return}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:'7.20.1'}))});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const endpoint='https://127.0.0.1:'+server.address().port;
 await assert.rejects(restGet(endpoint,path,{username:'test',password:'secret'}),e=>e.code==='NETWORK');assert.equal(count,0,'untrusted certificate must block HTTP request');
 async function child(){const script=`import {restGet} from './server/mikrotik.mjs';try{const result=await restGet(process.argv[1],process.argv[2],{username:'test',password:'secret'},{timeoutMs:300});console.log(JSON.stringify({result}))}catch(e){console.log(JSON.stringify({error:e.code}))}`;return new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--input-type=module','-e',script,endpoint,path],{env:{...process.env,NODE_EXTRA_CA_CERTS:cert},stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',s=>out+=s);p.stderr.on('data',s=>err+=s);p.on('error',reject);p.on('exit',code=>{if(code!==0)return reject(Error(err));try{resolve(JSON.parse(out))}catch(e){reject(e)}})})}
 assert.equal((await child()).result.version,'7.20.1');for(const [value,code] of [['redirect','REDIRECT'],['auth','AUTH'],['large','TOO_LARGE'],['malformed','RESPONSE'],['timeout','TIMEOUT']]){mode=value;assert.equal((await child()).error,code)}assert.equal(count,6);
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}rmSync(dir,{recursive:true,force:true})}
});
