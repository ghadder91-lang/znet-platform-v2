import {database} from '../server/database.mjs';
import {createUser} from '../server/auth.mjs';
import {randomBytes} from 'node:crypto';
const email=process.argv[2]?.toLowerCase();if(!email||!/^\S+@\S+\.\S+$/.test(email))throw Error('Usage: node scripts/admin.mjs email@example.com');
const db=database();if(db.sql.prepare('SELECT id FROM auth_users WHERE email=?').get(email))throw Error('Account already exists. No role or password was changed.');
const password=randomBytes(20).toString('base64url');const user=await createUser(db,{email,password,name:'مدير زد نت',role:'admin'});
console.log('Keep these credentials privately. They are shown only once.');console.log(JSON.stringify({email,password,recoveryCode:user.recovery},null,2));
