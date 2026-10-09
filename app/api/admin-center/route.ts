import {database} from '../../../server/database.mjs';
import {sessionUser} from '../../../server/auth.mjs';
import {adminOverview,adminNetwork,controlNetwork} from '../../../server/admin-center.mjs';
import {consumeRequest,boundedBody} from '../../../server/request-guards.mjs';
import {appOrigin} from '../../../server/config.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(req:Request){const db=database(),actor=sessionUser(db,req.headers.get('cookie')||'');const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});if(!actor)return json({error:'سجل الدخول'},401);if(actor.role!=='admin')return json({error:'هذه الصفحة مخصصة لإدارة المنصة'},403);if(req.method==='POST'&&req.headers.get('origin')!==appOrigin())return json({error:'مصدر غير مسموح'},403);const budget=await consumeRequest(db,actor.userId,req.method==='GET'?'inventory':'admin-control');if(!budget.allowed)return json({error:'طلبات كثيرة. حاول بعد دقيقة'},429);
try{if(req.method==='GET'){const q=new URL(req.url).searchParams;if(q.get('networkId'))return json(adminNetwork(db,actor,q.get('networkId')));return json(adminOverview(db,actor,{page:Number(q.get('page')||1),search:q.get('search')||'',status:q.get('status')||'all',operation:q.get('operation')||'all',province:q.get('province')||''}))}if(!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'نوع طلب غير صالح'},415);const body=JSON.parse(await boundedBody(req,4096));return json(controlNetwork(db,actor,body))}catch(e){const err=e as Error&{status?:number};return json({error:err.status?err.message:'تعذر تحميل مركز الإدارة'},err.status||400)}}
export const GET=handle;export const POST=handle;
