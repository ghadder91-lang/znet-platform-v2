import {DatabaseSync} from 'node:sqlite';
import {readFileSync,existsSync,copyFileSync,mkdirSync,mkdtempSync,rmSync,chmodSync,constants} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {vaultKey} from '../server/config.mjs';
const dir=process.argv[2];if(!dir)throw Error('Usage: node scripts/restore.mjs BACKUP_DIRECTORY; destination DATABASE_PATH must not exist.');
const source=resolve(dir,'znet.sqlite'),target=resolve(process.env.DATABASE_PATH||'data/znet.sqlite');
function assertEmptyDestination(){if(existsSync(target)||existsSync(target+'-wal')||existsSync(target+'-shm'))throw Error('Refusing to overwrite an existing database. Stop the service and preserve existing database files first.');}
assertEmptyDestination();
const manifest=JSON.parse(readFileSync(resolve(dir,'manifest.json'),'utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');
if(manifest.format!==1)throw Error('Backup integrity mismatch');
if(manifest.keyFingerprint!==hash(Buffer.from(vaultKey(),'base64')))throw Error('Wrong encryption key; use the original key for this backup.');
// WAL-mode backups can require SQLite sidecars, even for read-only connections.
// Stage one verified snapshot in a private writable directory, leaving the source untouched.
const staging=mkdtempSync(join(tmpdir(),'znet-restore-')),snapshot=join(staging,'znet.sqlite');
try{
 copyFileSync(source,snapshot,constants.COPYFILE_EXCL);chmodSync(snapshot,0o600);
 if(manifest.sha256!==hash(readFileSync(snapshot)))throw Error('Backup integrity mismatch');
 const db=new DatabaseSync(snapshot,{readOnly:true});
 try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Backup database validation failed');}finally{db.close();}
 assertEmptyDestination();
 mkdirSync(dirname(target),{recursive:true,mode:0o700});
 copyFileSync(snapshot,target,constants.COPYFILE_EXCL);chmodSync(target,0o600);
 console.log('Restored: '+target);
}finally{rmSync(staging,{recursive:true,force:true});}
