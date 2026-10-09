import {headers} from 'next/headers';
import {database} from '../server/database.mjs';
import {sessionUser} from '../server/auth.mjs';
import CoreApp from './core-app';
export const dynamic='force-dynamic';export const runtime='nodejs';
export default async function Page(){const h=await headers();const user=sessionUser(database(),h.get('cookie')||'');return <CoreApp signedIn={!!user} signIn="/login" signOut="/logout"/>}
