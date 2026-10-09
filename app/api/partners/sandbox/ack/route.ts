import {sandboxContext} from '../../../../../server/sandbox.mjs';
import {walletAcknowledge} from '../../../../../server/partner-protocol.mjs';
import {boundedBody} from '../../../../../server/request-guards.mjs';
export const runtime='nodejs';
export async function POST(req:Request){try{const {db,config}=sandboxContext(),data=JSON.parse(await boundedBody(req,4096));return Response.json(walletAcknowledge(db,req.headers.get('authorization'),config,data.orderId,data.customerRef),{headers:{'Cache-Control':'no-store'}})}catch(e){const err=e as Error&{status?:number};return Response.json({error:err.status?err.message:'تعذر إتمام الطلب.'},{status:err.status||400})}}
