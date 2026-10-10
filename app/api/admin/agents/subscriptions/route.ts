import {database} from '../../../../../server/database.mjs';
import {sessionUser} from '../../../../../server/auth.mjs';
import {appOrigin} from '../../../../../server/config.mjs';
import {boundedBody} from '../../../../../server/request-guards.mjs';
import {issueAgentSubscription} from '../../../../../server/agent-subscriptions.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
function isAdmin(db:ReturnType<typeof database>,userId:string){return !!db.sql.prepare("SELECT id FROM auth_users WHERE id=? AND role='admin'").get(userId)}
export async function GET(req:Request){
 const db=database(),actor=sessionUser(db,req.headers.get('cookie')||'');
 if(!actor)return json({error:'سجل الدخول'},401);
 if(!isAdmin(db,actor.userId))return json({error:'صلاحية المدير مطلوبة'},403);
 const q=new URL(req.url).searchParams;
 const agentId=q.get('agentId');
 if(agentId&&(agentId.length>100||agentId.length<1))return json({error:'معرف غير صالح'},400);
 const plans=db.sql.prepare('SELECT id,code,duration_days,price_minor FROM subscription_plans WHERE enabled=1 ORDER BY duration_days ASC LIMIT 50').all();
 const subscriptions=agentId?db.sql.prepare('SELECT s.id,s.agent_id,s.network_id,s.plan_id,s.starts_at,s.ends_at,s.created_at FROM agent_subscriptions s WHERE s.agent_id=? ORDER BY s.created_at DESC LIMIT 50').all(agentId):[];
 return json({plans,subscriptions,activationConnected:false});
}
export async function POST(req:Request){
 const db=database(),actor=sessionUser(db,req.headers.get('cookie')||'');
 if(!actor)return json({error:'سجل الدخول'},401);
 if(!isAdmin(db,actor.userId))return json({error:'صلاحية المدير مطلوبة'},403);
 if(req.headers.get('origin')!==appOrigin())return json({error:'مصدر غير مسموح'},403);
 if(!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'نوع طلب غير صالح'},415);
 try{
  const raw=await boundedBody(req,4096);
  const body=JSON.parse(raw);
  if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'طلب غير صالح'},400);
  if(body.op!=='issueSubscription')return json({error:'عملية غير مدعومة'},400);
  const result=issueAgentSubscription(db,actor,body);
  return json(result,201);
 }catch(e){const err=e as Error&{status?:number};return json({error:err.status?err.message:'تعذر إصدار الاشتراك'},err.status||400)}
}
