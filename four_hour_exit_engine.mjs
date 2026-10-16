// Four-hour broker exit coordinator. Injection-only: caller supplies broker adapter;
// no network calls, no credentials, and no broker writes unless explicitly approved.
// Durable journal MUST be stored on a persistent volume with a single writer.
import fs from 'node:fs';
import path from 'node:path';
export const HOUR4=4*60*60*1000;
const integer = x => /^\d+$/.test(String(x)) && Number.isSafeInteger(Number(x)) && Number(x)>0;
function load(journal){try {return JSON.parse(fs.readFileSync(journal,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function save(journal,obj){fs.mkdirSync(path.dirname(journal),{recursive:true});const temp=journal+'.'+process.pid+'.tmp';try {const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(obj));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,journal);const dir=fs.openSync(path.dirname(journal),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}finally{try{fs.unlinkSync(temp);}catch{}}}
function exactRows(reply){if(reply?.status!==0||!reply.data||Array.isArray(reply.data)||!Array.isArray(reply.data.list))return null;const {list,totalCount}=reply.data;return Number.isSafeInteger(Number(totalCount)) && totalCount!==null && Number(totalCount)===list.length && list.length<100?list:null;}
function result(status,detail){return {status,...detail,writeAttempted:false};}
// Does NOT conclude activeOCO is a verified protective order. It requires
// order-specific proof from an independent authority. If absent, no writes.
export async function runFourHourExit({journal,now,entry,broker,approveWrites=false}){
  const previous=load(journal);
  if(previous)return result('HALT_EXISTING_INTENT',{phase:previous.phase,reason:'MANUAL_RECONCILIATION_REQUIRED'});
  if(!entry||!Number.isSafeInteger(now)||!Number.isSafeInteger(entry.openedAt)||!integer(entry.positionId)||!integer(entry.size)||!integer(entry.rootOrderId)||!['BUY','SELL'].includes(entry.side))return result('HALT_BAD_INPUT',{});
  if(now-entry.openedAt<HOUR4)return result('WAIT',{remainingMs:entry.openedAt+HOUR4-now});
  const [pr,ar,or]=await Promise.allSettled([broker.positions(),broker.activeOrders(),broker.orderDetails(entry.rootOrderId)]);
  if([pr,ar,or].some(x=>x.status!=='fulfilled'))return result('HALT_BROKER_READ_FAILED',{});
  const positions=exactRows(pr.value),active=exactRows(ar.value);
  if(!positions||!active||or.value?.status!==0||!Array.isArray(or.value?.data?.list))return result('HALT_INCOMPLETE_SNAPSHOT',{});
  if(positions.length!==1||String(positions[0].positionId)!==String(entry.positionId)||Number(positions[0].size)!==Number(entry.size)||positions[0].side!==entry.side)return result('HALT_POSITION_MISMATCH',{});
  const legs=or.value.data.list.filter(x=>String(x.rootOrderId)===String(entry.rootOrderId));
  if(legs.length!==2 || !legs.some(x=>x.executionType==='STOP') || !legs.some(x=>x.executionType==='LIMIT') || legs.some(x=>x.settleType!=='CLOSE'||x.orderType!=='OCO'||x.symbol!=='USD_JPY'||x.side===(entry.side==='BUY'?'BUY':'SELL')||Number(x.size)!==Number(entry.size)))return result('HALT_OCO_DETAILS_MISMATCH',{});
  if(active.length!==2||active.some(x=>String(x.rootOrderId)!==String(entry.rootOrderId)))return result('HALT_ACTIVE_ORDER_MISMATCH',{});
  // Broker active orders do not establish exact position-to-OCO coverage.
  // Independent approval proof must be manually verified outside this endpoint.
  if(!approveWrites)return result('PREPARED_REVIEW_ONLY',{entry,rootOrderId:entry.rootOrderId,reason:'NO_LIVE_BROKER_WRITE_AUTHORIZATION'});
  // Even with an approval flag, this coordinator does not trust the unverified
  // relationship between the OCO and the specific position. Fail closed.
  return result('HALT_COVERAGE_UNPROVEN',{reason:'POSITION_TO_OCO_LINK_NOT_VERIFIED'});
}
