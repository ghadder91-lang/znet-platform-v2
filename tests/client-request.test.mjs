import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {subscribeJson} from '../lib/client-request.ts';

function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}

test('client request returns parsed data and reports completion once',async t=>{
 const events=[];
 t.mock.method(globalThis,'fetch',async()=>Response.json({stock:12}));
 subscribeJson('/api/core',{cache:'no-store'},{onData:d=>events.push(d),onError:e=>events.push(e),onSettled:()=>events.push('done')});
 await setImmediate();
 assert.deepEqual(events,[{stock:12},'done']);
});

test('client request reports server failures without accepting their data',async t=>{
 const events=[];
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:'Access denied'},{status:403}));
 subscribeJson('/api/core',{}, {onData:d=>events.push(d),onError:e=>events.push(e.message),onSettled:()=>events.push('done')});
 await setImmediate();
 assert.deepEqual(events,['Access denied','done']);
});

test('cleanup aborts transport and ignores an old response after a replacement request',async t=>{
 const old=deferred(),events=[];let oldSignal;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url==='/old'){oldSignal=options.signal;return old.promise}
  return Response.json({network:'new'});
 });
 const handlers={onData:d=>events.push(d),onError:e=>events.push(e.message),onSettled:()=>events.push('done')};
 const cleanup=subscribeJson('/old',{},handlers);
 cleanup();cleanup();
 assert.equal(oldSignal.aborted,true);
 subscribeJson('/new',{},handlers);
 await setImmediate();
 old.resolve(Response.json({network:'old'}));
 await setImmediate();
 assert.deepEqual(events,[{network:'new'},'done']);
});

test('cleanup during JSON parsing suppresses data, errors and completion callbacks',async t=>{
 const body=deferred(),events=[];
 t.mock.method(globalThis,'fetch',async()=>({ok:false,json:()=>body.promise}));
 const cleanup=subscribeJson('/api/core',{}, {onData:d=>events.push(d),onError:e=>events.push(e),onSettled:()=>events.push('done')});
 await setImmediate();
 cleanup();body.resolve({error:'Late response'});
 await setImmediate();
 assert.deepEqual(events,[]);
});
