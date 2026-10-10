import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/database.mjs';
import {createAgent,adjustAgent,agentBalance} from '../server/agents.mjs';
const admin={userId:'admin'},owner={userId:'owner'},other={userId:'other'};
function fixture(){
 const db=openDatabase(':memory:');
 db.sql.exec("INSERT INTO accounts VALUES('admin','admin@test.local','Admin',0),('owner','owner@test.local','Owner',0),('other','other@test.local','Other',0); INSERT INTO auth_users VALUES('admin','admin@test.local','hash','admin','recovery',0),('owner','owner@test.local','hash','owner','recovery',0),('other','other@test.local','hash','owner','recovery',0);");
 return db;
}
const key='request-key-1234567890',reason='اعتماد إداري لتعديل رصيد الوكيل';
test('agent ledger enforces roles, balance and credit ceiling',()=>{
 const db=fixture();
 assert.throws(()=>createAgent(db,owner,{accountId:'owner',requestKey:key}),e=>e.status===403);
 const agent=createAgent(db,admin,{accountId:'owner',requestKey:key});
 assert.equal(createAgent(db,admin,{accountId:'owner',requestKey:key}).id,agent.id);
 assert.throws(()=>agentBalance(db,other,agent.id),e=>e.status===403);
 let a=adjustAgent(db,admin,{agentId:agent.id,action:'deposit',amountMinor:10000,expectedVersion:0,requestKey:key,reason});
 assert.equal(a.spending_power_minor,10000);
 a=adjustAgent(db,admin,{agentId:agent.id,action:'set_credit_limit',creditLimitMinor:20000,expectedVersion:1,requestKey:'request-key-1234567891',reason});
 assert.equal(a.spending_power_minor,30000);
 assert.throws(()=>adjustAgent(db,admin,{agentId:agent.id,action:'adjustment',amountMinor:-30001,expectedVersion:2,requestKey:'request-key-1234567892',reason}),e=>e.status===409);
 assert.throws(()=>adjustAgent(db,admin,{agentId:agent.id,action:'deposit',amountMinor:10000,expectedVersion:2,requestKey:key,reason}),e=>e.status===409);
 assert.equal(agentBalance(db,owner,agent.id).spending_power_minor,30000);
 assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM agent_entries').get().n,1);
 assert.throws(()=>db.sql.exec('DELETE FROM agent_entries'),/append-only/);
 db.sql.close();
});
test('suspension and stale version cannot silently overwrite controls',()=>{
 const db=fixture(),agent=createAgent(db,admin,{accountId:'owner',requestKey:key});
 const a=adjustAgent(db,admin,{agentId:agent.id,action:'suspend',expectedVersion:0,requestKey:key,reason});
 assert.equal(a.status,'suspended');
 assert.throws(()=>adjustAgent(db,admin,{agentId:agent.id,action:'resume',expectedVersion:0,requestKey:'request-key-1234567893',reason}),e=>e.status===409);
 assert.equal(adjustAgent(db,admin,{agentId:agent.id,action:'resume',expectedVersion:1,requestKey:'request-key-1234567894',reason}).status,'active');
 db.sql.close();
});
