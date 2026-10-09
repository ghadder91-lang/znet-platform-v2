import {database} from '../../../server/database.mjs';
import {authRequest} from '../../../server/auth.mjs';
import {appOrigin} from '../../../server/config.mjs';
export const runtime='nodejs';
export async function POST(req:Request){return authRequest(req,database(),appOrigin());}
