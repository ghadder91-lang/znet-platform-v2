import {database} from '../../../server/database.mjs';
import {sessionUser} from '../../../server/auth.mjs';
import {importStatement,reconciliationView,reviewCase} from '../../../server/reconciliation.mjs';
import {consumeRequest,boundedBody} from '../../../server/request-guards.mjs';
import {appOrigin} from '../../../server/config.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(req:Request){const db=database(),actor=sessionUser(db,req.headers.get('cookie')||'');const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});if(!actor)return json({error:'سجل الدخول'},401);if(req.method==='POST'&&req.headers.get('origin')!==appOrigin())return json({error:'مصدر غير مسموح'},403);const budget=await consumeRequest(db,actor.userId,req.method==='GET'?'inventory':'import');if(!budget.allowed)return json({error:'طلبات كثيرة، حاول لاحقًا'},429);
try{if(req.method==='GET'){const q=new URL(req.url).searchParams;return json(reconciliationView(db,actor,q.get('networkId'),q.get('runId')||''))}if(!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'نوع طلب غير صالح'},415);const body=JSON.parse(await boundedBody(req,70000));if(body.op==='import')return json(importStatement(db,actor,body));if(body.op==='review')return json(reviewCase(db,actor,body));return json({error:'إجراء غير صالح'},400)}catch(e){const err=e as Error&{status?:number};return json({error:err.status?err.message:'تعذر تنفيذ المطابقة'},err.status||400)}}
export const GET=handle;export const POST=handle;
