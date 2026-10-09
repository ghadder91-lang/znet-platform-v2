import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync,chmodSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
export function openDatabase(path=process.env.DATABASE_PATH||'./data/znet.sqlite'){
 if(path!==':memory:')mkdirSync(dirname(resolve(path)),{recursive:true,mode:0o700});
 const sql=new DatabaseSync(path);if(path!==':memory:')chmodSync(path,0o600);
 sql.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
 sql.exec('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,applied_at INTEGER NOT NULL)');
 for(const name of readdirSync(resolve('drizzle')).filter(x=>x.endsWith('.sql')).sort()){
  sql.exec('BEGIN IMMEDIATE');try{if(!sql.prepare('SELECT name FROM schema_migrations WHERE name=?').get(name)){sql.exec(readFileSync(resolve('drizzle',name),'utf8'));sql.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(name,Date.now());}sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}
 }
 const db={sql,prepare(query){return {bind(...args){return {async first(){return sql.prepare(query).get(...args)||null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}}},_query:query,_args:args}}}},async batch(items){return transaction(sql,()=>items.map(s=>{const r=sql.prepare(s._query).run(...s._args);return {meta:{changes:Number(r.changes)}}}));}};
 return db;
}
export function transaction(sql,fn){sql.exec('BEGIN IMMEDIATE');try{const r=fn();if(r&&typeof r.then==='function')throw Error('Transactions must be synchronous');sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}
export function database(){globalThis.__znetDB??=openDatabase();return globalThis.__znetDB;}
