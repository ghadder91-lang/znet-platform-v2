import {database} from '../../../server/database.mjs';
import {sessionUser} from '../../../server/auth.mjs';
import {forecastView,savePolicy,evaluatePolicy} from '../../../server/forecast.mjs';
import {consumeRequest,boundedBody} from '../../../server/request-guards.mjs';
import {appOrigin} from '../../../server/config.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(req:Request){const db=database(),actor=sessionUser(db,req.headers.get('cookie')||'');const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});if(!actor)return json({error:'سجل الدخول'},401);if(req.method==='POST'&&req.headers.get('origin')!==appOrigin())return json({error:'مصدر غير مسموح'},403);const budget=await consumeRequest(db,actor.userId,req.method==='GET'?'inventory':'forecast');if(!budget.allowed)return json({error:'طلبات كثيرة. حاول بعد دقيقة'},429);
try{if(req.method==='GET'){const q=new URL(req.url).searchParams;return json(forecastView(db,actor,q.get('networkId'),Number(q.get('page')||1)))}if(!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'نوع طلب غير صالح'},415);const body=JSON.parse(await boundedBody(req,4096));if(body.op==='save')return json(savePolicy(db,actor,body));if(body.op==='evaluate')return json(evaluatePolicy(db,actor,body));return json({error:'إجراء غير صالح'},400)}catch(e){const err=e as Error&{status?:number};return json({error:err.status?err.message:'تعذر تقييم المخزون'},err.status||400)}}
export const GET=handle;export const POST=handle;
