// Chagatto-2: broker-neutral, durable, fail-closed exit lifecycle.
// SIMULATION/REVIEW ONLY. No live trading authorization or broker adapter is shipped.
import fs from 'node:fs';
import path from 'node:path';
const validId=x=>/^[1-9]\d*$/.test(String(x))&&Number.isSafeInteger(Number(x));
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
export function readIntent(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function persist(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.tmp`;const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(data));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
function rows(r){if(r?.status!==0||!obj(r.data)||!Array.isArray(r.data.list)||r.data.list.length>=100||!Number.isSafeInteger(r.data.totalCount)||r.data.totalCount!==r.data.list.length)return null;return r.data.list;}
const opposite=s=>s==='BUY'?'SELL':'BUY';
export function inspect(snapshot,position){
 const positions=rows(snapshot?.positions),orders=rows(snapshot?.orders);
 if(!positions||!orders)return {ok:false,reason:'UNVERIFIABLE_OR_PAGINATED_SNAPSHOT'};
 const matching=positions.filter(p=>String(p.positionId)===String(position.positionId));
 if(matching.length>1||positions.length>1)return {ok:false,reason:'UNEXPECTED_MULTIPLE_POSITIONS'};
 if(matching.length===0){if(positions.length===0&&orders.length===0)return {ok:true,flat:true};return {ok:false,reason:'POSITION_MISSING_WITH_ACTIVE_ORDERS'};}
 const p=matching[0];
 if(p.symbol!=='USD_JPY'||p.side!==position.side||Number(p.size)!==position.size)return {ok:false,reason:'POSITION_MISMATCH'};
 // Reject all concurrent orders except precisely the two expected OCO legs.
 if(orders.length!==2||orders.some(o=>String(o.rootOrderId)!==String(position.rootOrderId)||o.symbol!=='USD_JPY'||o.orderType!=='OCO'||o.settleType!=='CLOSE'||o.side!==opposite(position.side)||Number(o.size)!==position.size||!['WAITING','ORDERED'].includes(o.status)))return {ok:false,reason:'ACTIVE_ORDERS_NOT_EXACT_OCO'};
 if(orders.filter(o=>o.executionType==='STOP').length!==1||orders.filter(o=>o.executionType==='LIMIT').length!==1)return {ok:false,reason:'OCO_LEGS_INVALID'};
 // NOTE: this checks consistency, not actual linkage to the open position.
 return {ok:true,flat:false,rootOrderId:position.rootOrderId};
}
export async function prepareExit({journal,entry,now,broker}){
 if(readIntent(journal))return {phase:'HALT',reason:'PENDING_INTENT_EXISTS'};
 if(!obj(entry)||!validId(entry.positionId)||!validId(entry.rootOrderId)||!Number.isSafeInteger(entry.size)||entry.size!==1000||!['BUY','SELL'].includes(entry.side)||!Number.isSafeInteger(entry.openedAt)||!Number.isSafeInteger(now))return {phase:'HALT',reason:'INVALID_ENTRY'};
 if(now-entry.openedAt<14_400_000)return {phase:'WAIT'};
 let snapshot;try{snapshot=await broker.snapshot();}catch{return {phase:'HALT',reason:'BROKER_READ_UNKNOWN'};}
 const check=inspect(snapshot,entry);
 if(!check.ok)return {phase:'HALT',reason:check.reason};
 if(check.flat)return {phase:'ALREADY_FLAT'};
 const intent={version:1,phase:'AWAITING_MANUAL_AUTHORIZATION',positionId:String(entry.positionId),rootOrderId:String(entry.rootOrderId),side:entry.side,size:entry.size,createdAt:now,writeAttempted:false};
 persist(journal,intent);
 return {phase:intent.phase,reason:'BROKER_POSITION_TO_OCO_LINKAGE_NOT_YET_PROVEN',writeAttempted:false};
}
// The separate workflow below is a pure planner. No client can pass an "approved"
// boolean and obtain a broker write. Live adapters require independent verification.
export function nextExitAction(intent,snapshot){
 if(!obj(intent)||intent.version!==1)return {action:'HALT',reason:'INVALID_INTENT'};
 if(intent.phase==='AWAITING_MANUAL_AUTHORIZATION')return {action:'HALT',reason:'POSITION_TO_OCO_COVERAGE_NOT_PROVEN'};
 if(intent.phase==='CANCEL_REQUEST_UNKNOWN'||intent.phase==='CLOSE_REQUEST_UNKNOWN')return {action:'HALT',reason:'RECONCILE_MANUALLY_NO_RETRY'};
 return {action:'HALT',reason:'LIVE_EXIT_NOT_AUTHORIZED'};
}
