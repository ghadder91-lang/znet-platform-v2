import {randomUUID} from 'node:crypto';
import {transaction} from './database.mjs';
function fail(message,status=400){throw Object.assign(Error(message),{status})}
function admin(db,actor){if(!actor?.userId||!db.sql.prepare("SELECT id FROM auth_users WHERE id=? AND role='admin'").get(actor.userId))fail('هذه الصفحة مخصصة لإدارة المنصة',403)}
function getNetwork(db,id){const n=db.sql.prepare('SELECT n.*,a.name AS owner_name,a.email AS owner_email FROM networks n JOIN accounts a ON a.id=n.owner_id WHERE n.id=?').get(id);if(!n)fail('الشبكة غير موجودة',404);return n}
function text(value,max){if(typeof value!=='string'||value.length>max)fail('قيمة البحث غير صالحة');return value.trim()}
export function controlNetwork(db,actor,{networkId,action,reason,expectedVersion},now=Date.now()){
 admin(db,actor);if(!['suspend','resume'].includes(action)||typeof reason!=='string'||reason.trim().length<10||reason.length>1000||!Number.isSafeInteger(expectedVersion)||expectedVersion<0)fail('حدد الإجراء واكتب سببًا من 10 إلى 1000 حرف');
 return transaction(db.sql,()=>{admin(db,actor);const n=getNetwork(db,networkId);if(n.control_version!==expectedVersion)fail('تغيرت الحالة من جلسة أخرى؛ حدّث البيانات',409);const suspended=n.suspended_at!==null;if((action==='suspend'&&suspended)||(action==='resume'&&!suspended))fail('الشبكة في هذه الحالة بالفعل؛ حدّث البيانات',409);
 const v=expectedVersion+1;db.sql.prepare('UPDATE networks SET suspended_at=?,suspension_reason=?,control_version=? WHERE id=?').run(action==='suspend'?now:null,action==='suspend'?reason.trim():null,v,networkId);
 db.sql.prepare('INSERT INTO network_control_events VALUES(?,?,?,?,?,?,?)').run(randomUUID(),networkId,actor.userId,action,reason.trim(),v,now);
 db.sql.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?)').run(randomUUID(),networkId,actor.userId,action==='suspend'?'NETWORK_SUSPENDED':'NETWORK_RESUMED',reason.trim(),now);
 db.sql.prepare('INSERT INTO operation_events VALUES(?,?,?,?,?)').run(randomUUID(),networkId,action==='suspend'?'NETWORK_SUSPENDED':'NETWORK_RESUMED',String(v),now);
 return {version:v,suspended:action==='suspend'};});
}
export function adminOverview(db,actor,{page=1,search='',status='all',operation='all',province=''}={},now=Date.now()){
 admin(db,actor);if(!Number.isSafeInteger(page)||page<1||page>100000)fail('رقم الصفحة غير صالح');search=text(search,100);province=text(province,60);if(!['all','pending','active','rejected'].includes(status)||!['all','enabled','suspended'].includes(operation))fail('عامل تصفية غير صالح');
 return transaction(db.sql,()=>{const where=[],args=[];if(search){where.push('(instr(n.name,?)>0 OR instr(n.phone,?)>0 OR instr(n.id,?)>0 OR instr(a.email,?)>0)');args.push(search,search,search,search)}if(province){where.push('n.province=?');args.push(province)}if(status!=='all'){where.push('n.status=?');args.push(status)}if(operation!=='all')where.push(operation==='suspended'?'n.suspended_at IS NOT NULL':'n.suspended_at IS NULL');const clause=where.length?where.join(' AND '):'1=1';
 const rows=db.sql.prepare(`SELECT n.id,n.name,n.phone,n.province,n.district,n.status,n.suspended_at,n.suspension_reason,n.control_version,a.email AS owner_email,
 (SELECT COUNT(*) FROM vouchers v WHERE v.network_id=n.id AND v.status='available') stock,
 (SELECT COUNT(*) FROM categories c WHERE c.network_id=n.id) category_count,
 (SELECT COUNT(*) FROM incidents i WHERE i.network_id=n.id AND i.status='open') incident_count,
 m.status AS router_status,m.last_success AS router_last_success,m.last_error AS router_error,m.sealed_credentials IS NOT NULL AS router_configured
 FROM networks n JOIN accounts a ON a.id=n.owner_id LEFT JOIN mikrotik_connections m ON m.network_id=n.id WHERE ${clause} ORDER BY n.created_at DESC,n.id DESC LIMIT 25 OFFSET ?`).all(...args,(page-1)*25).map(r=>{const {router_configured,...safe}=r;return {...safe,router_status:!router_configured?'unconfigured':r.router_status==='healthy'&&now-r.router_last_success>900000?'stale':r.router_status}});
 const count=query=>db.sql.prepare(query).get().n;
 const stats={networks:count('SELECT COUNT(*) n FROM networks'),approved:count("SELECT COUNT(*) n FROM networks WHERE status='active' AND suspended_at IS NULL"),pending:count("SELECT COUNT(*) n FROM networks WHERE status='pending'"),suspended:count('SELECT COUNT(*) n FROM networks WHERE suspended_at IS NOT NULL'),availableCards:count("SELECT COUNT(*) n FROM vouchers WHERE status='available'"),openIncidents:count("SELECT COUNT(*) n FROM incidents WHERE status='open'"),openReconciliation:count("SELECT COUNT(*) n FROM reconciliation_cases WHERE state='open'")};
 const sales=db.sql.prepare("SELECT COUNT(*) count,COALESCE(SUM(amount),0) amount FROM orders WHERE status='paid' AND paid_at>=? AND paid_at<=?").get(now-86400000,now);
 const router=db.sql.prepare("SELECT COUNT(*) configured,COALESCE(SUM(CASE WHEN status='healthy' AND last_success>=? THEN 1 ELSE 0 END),0) fresh FROM mikrotik_connections WHERE sealed_credentials IS NOT NULL").get(now-900000);
 return {asOf:now,page,total:db.sql.prepare(`SELECT COUNT(*) n FROM networks n JOIN accounts a ON a.id=n.owner_id WHERE ${clause}`).get(...args).n,stats,sales24h:sales,router,rows,provinces:db.sql.prepare('SELECT DISTINCT province FROM networks ORDER BY province').all().map(r=>r.province),incidents:db.sql.prepare("SELECT i.id,i.network_id,i.order_id,i.reason,i.created_at,n.name AS network_name FROM incidents i JOIN networks n ON n.id=i.network_id WHERE i.status='open' ORDER BY i.created_at DESC,i.id DESC LIMIT 10").all()};});
}
export function adminNetwork(db,actor,networkId,now=Date.now()){
 admin(db,actor);return transaction(db.sql,()=>{const network=getNetwork(db,networkId);
 const totals=db.sql.prepare('SELECT account,COALESCE(SUM(debit),0) debit,COALESCE(SUM(credit),0) credit FROM ledger_entries WHERE network_id=? GROUP BY account').all(networkId);
 const categories=db.sql.prepare("SELECT c.id,c.name,c.price,c.low_threshold,(SELECT COUNT(*) FROM vouchers v WHERE v.category_id=c.id AND v.status='available') stock FROM categories c WHERE c.network_id=? ORDER BY c.price,c.id").all(networkId);
 return {network,asOf:now,totals,categories,orders:db.sql.prepare('SELECT id,amount,status,created_at,paid_at FROM orders WHERE network_id=? ORDER BY created_at DESC,id DESC LIMIT 20').all(networkId),incidents:db.sql.prepare("SELECT id,order_id,reason,status,created_at FROM incidents WHERE network_id=? AND status='open' ORDER BY created_at DESC,id DESC LIMIT 20").all(networkId),controls:db.sql.prepare('SELECT c.id,c.action,c.reason,c.version,c.created_at,a.email AS actor_email FROM network_control_events c JOIN accounts a ON a.id=c.actor_id WHERE c.network_id=? ORDER BY c.version DESC LIMIT 20').all(networkId),audit:db.sql.prepare('SELECT id,event,detail,created_at FROM audit WHERE network_id=? ORDER BY created_at DESC,id DESC LIMIT 30').all(networkId),router:db.sql.prepare('SELECT status,version,last_attempt,last_success,last_error FROM mikrotik_connections WHERE network_id=?').get(networkId)||null};});
}
