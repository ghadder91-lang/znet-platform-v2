import {sandboxContext} from '../../../../../server/sandbox.mjs';
import {paymentCallback} from '../../../../../server/partner-protocol.mjs';
export const runtime='nodejs';
export async function POST(req:Request){try{const {db,config}=sandboxContext();return paymentCallback(req,db,config)}catch{return Response.json({error:'المختبر غير مفعّل.'},{status:503})}}
