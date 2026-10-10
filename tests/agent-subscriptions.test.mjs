import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/database.mjs';
import {createAgent,adjustAgent} from '../server/agents.mjs';
import {issueAgentSubscription} from '../server/agent-subscriptions.mjs';
const admin={userId:'admin'},owner={userId:'owner'},key='subscription-key-1234567890',reason='شحن حساب الوكيل من الإدارة';
function fixture(){
 const db=openDatabase(':memory:');
 db.sql.exec("INSERT INTO accounts VALUES('admin','admin@test.local','Admin',0),('owner','owner@test.local','Owner',0); INSERT INTO auth_users VALUES('admin','admin@test.local','hash','admin','recovery',0),('owner','owner@test.local','hash','owner','recovery',0); INSERT INTO networks(id,owner_id,name,phone,province,district,status,created_at,updated_at) VALUES('n','owner','شبكة','770000000','صنعاء','معين','active',1,1); INSERT INTO subscription_plans(id,code,duration_days,price_minor,enabled,created_at) VALUES('p','MONTH',30,2000,1,1);");
 const agent=createAgent(db,admin,{accountId:'owner',requestKey:'create-agent-key-123456'});
 return {db,agent};
}
test('subscription issuance is atomic, idempotent and extends expiry',()=>{
 const {db,agent}=fixture();
 adjustAgent(db,admin,{agentId:agent.id,action:'set_credit_limit',creditLimitMinor:4000,expectedVersion:0,requestKey:'credit-limit-key-123456',reason});
 const args={agentId:agent.id,networkId:'n',planId:'p',requestKey:key};
 assert.throws(()=>issueAgentSubscription(db,owner,args,1000),e=>e.status===403);
 const first=issueAgentSubscription(db,admin,args,1000);
 assert.equal(first.activationStatus,'NOT_CONNECTED');
 assert.equal(issueAgentSubscription(db,admin,args,2000).replayed,true);
 assert.throws(()=>issueAgentSubscription(db,admin,{...args,planId:'other'},2000),e=>e.status===409);
 const second=issueAgentSubscription(db,admin,{...args,requestKey:'subscription-key-1234567891'},2000);
 assert.equal(second.starts_at,first.ends_at);
 assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM agent_subscriptions').get().n,2);
 assert.equal(db.sql.prepare('SELECT balance_minor FROM agent_balances WHERE agent_id=?').get(agent.id).balance_minor,-4000);
 assert.throws(()=>issueAgentSubscription(db,admin,{...args,requestKey:'subscription-key-1234567892'},3000),e=>e.status===409);
 assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM agent_entries').get().n,2);
 db.sql.close();
});
test('suspended agent or network and disabled plan cannot issue',()=>{
 const {db,agent}=fixture();
 adjustAgent(db,admin,{agentId:agent.id,action:'deposit',amountMinor:5000,expectedVersion:0,requestKey:'deposit-key-123456789',reason});
 const args={agentId:agent.id,networkId:'n',planId:'p',requestKey:key};
 db.sql.prepare("UPDATE subscription_plans SET enabled=0 WHERE id='p'").run();
 assert.throws(()=>issueAgentSubscription(db,admin,args),e=>e.status===409);
 db.sql.prepare("UPDATE subscription_plans SET enabled=1 WHERE id='p'").run();
 db.sql.prepare("UPDATE networks SET suspended_at=1 WHERE id='n'").run();
 assert.throws(()=>issueAgentSubscription(db,admin,args),e=>e.status===409);
 db.sql.prepare("UPDATE networks SET suspended_at=NULL WHERE id='n'").run();
 adjustAgent(db,admin,{agentId:agent.id,action:'suspend',expectedVersion:1,requestKey:'suspend-key-123456789',reason});
 assert.throws(()=>issueAgentSubscription(db,admin,args),e=>e.status===409);
 assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM agent_subscriptions').get().n,0);
 db.sql.close();
});
