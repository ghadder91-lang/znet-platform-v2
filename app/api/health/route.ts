import {database} from '../../../server/database.mjs';
import {appOrigin,vaultKey} from '../../../server/config.mjs';
export const dynamic='force-dynamic';export const runtime='nodejs';
export function GET(){try{appOrigin();vaultKey();database().sql.prepare('SELECT 1').get();return Response.json({status:'ok'},{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({status:'unavailable'},{status:503})}}
