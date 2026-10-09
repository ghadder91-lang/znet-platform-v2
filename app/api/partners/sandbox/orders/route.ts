import {sandboxContext} from '../../../../../server/sandbox.mjs';
import {partnerOrder} from '../../../../../server/partner-protocol.mjs';
import {boundedBody} from '../../../../../server/request-guards.mjs';
export const runtime='nodejs';
export async function POST(req:Request){try{const {db,config}=sandboxContext(),data=JSON.parse(await boundedBody(req,4096));const network=db.sql.prepare('SELECT owner_id FROM networks WHERE id=?').get(data.networkId);return Response.json(partnerOrder(db,req.headers.get('authorization'),config,{userId:network?.owner_id||''},data),{headers:{'Cache-Control':'no-store'}})}catch(e){const err=e as Error&{status?:number};return Response.json({error:err.status?err.message:'تعذر إنشاء الطلب.'},{status:err.status||400})}}
