const policy={read:120,write:30,reveal:20,import:10,export:5};
const readOperations=new Set(['bootstrap','network','admin','reviewQueue','activity','inventory','listBatches','vouchers','notifications']);
export function requestPolicy(op){const group=op==='reveal'?'reveal':['import','previewImport'].includes(op)?'import':op==='exportInventory'?'export':readOperations.has(op)?'read':'write';return {group,limit:policy[group]};}
export async function consumeRequest(db,userId,op,now=Date.now()){
 const {group,limit}=requestPolicy(op),id=group+':'+userId,expires=now+60000;
 // One conditional write claims a slot. There is no read-then-increment race.
 const accepted=await db.prepare(`INSERT INTO request_limits(id,count,expires_at) VALUES(?,1,?)
 ON CONFLICT(id) DO UPDATE SET count=CASE WHEN request_limits.expires_at<=? THEN 1 ELSE request_limits.count+1 END,
 expires_at=CASE WHEN request_limits.expires_at<=? THEN excluded.expires_at ELSE request_limits.expires_at END
 WHERE request_limits.expires_at<=? OR request_limits.count<? RETURNING id`).bind(id,expires,now,now,now,limit).first();
 if(accepted)return {allowed:true};
 const row=await db.prepare('SELECT expires_at FROM request_limits WHERE id=?').bind(id).first();
 return {allowed:false,retryAfter:Math.max(1,Math.min(60,Math.ceil(((row?.expires_at??expires)-now)/1000)))};
}
export class BodyTooLarge extends Error{}
export async function boundedBody(request,maxBytes=70000){
 const declared=request.headers.get('content-length');
 if(declared&&Number(declared)>maxBytes)throw new BodyTooLarge();
 if(!request.body)return '';
 const reader=request.body.getReader(),parts=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes){await reader.cancel();throw new BodyTooLarge();}parts.push(value);}}
 finally{reader.releaseLock();}
 const result=new Uint8Array(total);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.byteLength;}
 return new TextDecoder().decode(result);
}
