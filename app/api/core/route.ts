import {database} from '../../../server/database.mjs';
import {sessionUser} from '../../../server/auth.mjs';
import {appOrigin,vaultKey} from '../../../server/config.mjs';
import {handleCore} from '../../../server/core.mjs';
export const dynamic='force-dynamic';export const runtime='nodejs';
async function handle(req:Request){const db=database();if(req.method==='POST'&&req.headers.get('origin')!==appOrigin())return Response.json({error:'مصدر غير مسموح'},{status:403});const target=new URL(req.url);const forwarded=new Request(appOrigin()+target.pathname+target.search,req);return handleCore(forwarded,db,sessionUser(db,req.headers.get('cookie')||''),{vaultKey:vaultKey()});}
export const GET=handle;export const POST=handle;
