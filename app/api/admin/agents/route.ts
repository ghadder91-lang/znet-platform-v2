import {database} from '../../../../server/database.mjs';
import {sessionUser} from '../../../../server/auth.mjs';
import {appOrigin} from '../../../../server/config.mjs';
import {boundedBody} from '../../../../server/request-guards.mjs';
import {createAgent,adjustAgent,agentBalance} from '../../../../server/agents.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req){
 const db=database(),actor=sessionUser(db,req.headers.get('cookie')||'');
 if(!actor)return json({error:'سجل الدخول'},401);
 try{
  const id=new URL(req.url).searchParams.get('agentId');
  if(!id)return json({error:'حدد الوكيل'},400);
  return json(agentBalance(db,actor,id));
 }catch(e){return json({error:e.status?e.message:'تعذر قراءة حساب الوكيل'},e.status||400)}
}
export async function POST(req){
 const db=database(),actor=sessionUser(db,req.headers.get('cookie')||'');
 if(!actor)return json({error:'سجل الدخول'},401);
 if(req.headers.get('origin')!==appOrigin())return json({error:'مصدر غير مسموح'},403);
 if(!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'نوع طلب غير صالح'},415);
 try{
  const raw=await boundedBody(req,4096),body=JSON.parse(raw);
  if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'طلب غير صالح'},400);
  if(body.op==='createAgent')return json(createAgent(db,actor,body),201);
  if(body.op==='adjustAgent')return json(adjustAgent(db,actor,body));
  return json({error:'عملية غير مدعومة'},400);
 }catch(e){return json({error:e.status?e.message:'تعذر تنفيذ العملية'},e.status||400)}
}
