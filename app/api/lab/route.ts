import {database} from '../../../server/database.mjs';
import {sessionUser} from '../../../server/auth.mjs';
import {sandboxContext,labState,labAction} from '../../../server/sandbox.mjs';
import {consumeRequest,boundedBody} from '../../../server/request-guards.mjs';
import {appOrigin} from '../../../server/config.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(req:Request){const db=database(),actor=sessionUser(db,req.headers.get('cookie')||'');const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});if(!actor)return json({error:'سجل الدخول.'},401);
 if(req.method==='POST'&&req.headers.get('origin')!==appOrigin())return json({error:'مصدر غير مسموح.'},403);
 const budget=await consumeRequest(db,actor.userId,req.method==='GET'?'inventory':'lab');if(!budget.allowed)return json({error:'طلبات كثيرة. حاول بعد دقيقة.'},429);
 try{const sandbox=sandboxContext();if(req.method==='GET')return json(labState(sandbox.db,actor));if(!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'طلب غير صالح.'},415);const body=JSON.parse(await boundedBody(req,4096));return json(await labAction(sandbox.db,actor,sandbox.config,body));}catch(e){const err=e as Error&{status?:number};return json({error:err.status?err.message:'تعذر إتمام عملية المختبر.'},err.status||400)}}
export const GET=handle;export const POST=handle;
