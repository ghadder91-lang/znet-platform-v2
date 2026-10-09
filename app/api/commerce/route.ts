import {database} from '../../../server/database.mjs';
import {sessionUser} from '../../../server/auth.mjs';
import {commerceOverview} from '../../../server/commerce.mjs';
import {consumeRequest} from '../../../server/request-guards.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req:Request){const db=database(),actor=sessionUser(db,req.headers.get('cookie')||'');if(!actor)return Response.json({error:'سجل الدخول'},{status:401});const budget=await consumeRequest(db,actor.userId,'inventory');if(!budget.allowed)return Response.json({error:'طلبات كثيرة. حاول بعد دقيقة.'},{status:429,headers:{'Retry-After':String(budget.retryAfter)}});const q=new URL(req.url).searchParams;try{return Response.json(commerceOverview(db,actor,q.get('networkId'),Number(q.get('page')||1)),{headers:{'Cache-Control':'no-store'}})}catch(e){const err=e as Error&{status?:number};return Response.json({error:err.status?err.message:'تعذر تحميل الحسابات.'},{status:err.status||503})}}
