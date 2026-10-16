// Fail-closed execution coordinator. Inert until an independently vetted broker adapter is injected.
// Strictly never retries broker writes after a network or ambiguous acknowledgement.
import fs from 'node:fs';
import path from 'node:path';
export function load(file){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
function save(file,v){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.${Date.now()}.tmp`;const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(v));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const d=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}}
const validId=id=>/^[1-9][0-9]*$/.test(String(id)) && Number.isSafeInteger(Number(id));
function validEntry(e){return e&&validId(e.positionId)&&validId(e.rootOrderId)&&e.side&&['BUY','SELL'].includes(e.side)&&Number.isSafeInteger(e.size)&&e.size>0&&Number.isSafeInteger(e.openedAt)&&e.openedAt>0}
const block=reason=>({ok:false,reason});
// All adapter results MUST represent exhaustive, broker-confirmed state; never infer confirmation from POST 200.
export async function advanceFourHourExit({file,entry,now,broker,allowBrokerWrite=false}) {
 if(!validEntry(entry)||!Number.isSafeInteger(now))return block('INVALID_INPUT');
 if(!file||!broker||typeof broker.snapshot!=='function')return block('MISSING_BROKER_READ_ADAPTER');
 let state=load(file);
 if(!state){
  if(now-entry.openedAt<14_400_000)return {ok:true,phase:'WAIT'};
  state={version:2,phase:'SNAPSHOT_REQUIRED',entry:{positionId:String(entry.positionId),rootOrderId:String(entry.rootOrderId),side:entry.side,size:entry.size,openedAt:entry.openedAt},updatedAt:now};
  save(file,state);
 }
 if(state.version!==2||JSON.stringify(state.entry)!==JSON.stringify({positionId:String(entry.positionId),rootOrderId:String(entry.rootOrderId),side:entry.side,size:entry.size,openedAt:entry.openedAt}))return block('INTENT_MISMATCH');
 if(['CANCEL_UNKNOWN','CLOSE_UNKNOWN','MANUAL_RECONCILIATION','CANCEL_REQUESTED','CLOSE_REQUESTED'].includes(state.phase))return block(`RECONCILIATION_REQUIRED_${state.phase}`);
 if(state.phase==='CLOSED')return {ok:true,phase:'CLOSED'};
 let snapshot;
 try{snapshot=await broker.snapshot()}catch{return block('SNAPSHOT_FAILED')}
 // Adapter must attest complete pagination and authoritative order/position linkage.
 if(snapshot?.complete!==true || snapshot?.brokerConfirmed!==true)return block('SNAPSHOT_NOT_AUTHORITATIVE');
 if(!Array.isArray(snapshot.positions)||!Array.isArray(snapshot.orders))return block('UNEXPECTED_SNAPSHOT_SHAPE');
 const pos=snapshot.positions.filter(x=>String(x.positionId)===String(entry.positionId));
 if(snapshot.positions.length===0&&snapshot.orders.length===0){
  // A flat *single* read can be a transient broker/cache inconsistency. Never mark
  // a formerly-open position CLOSED without independent execution evidence.
  return block('FLAT_SNAPSHOT_REQUIRES_FILL_EVIDENCE');
 }
 if(snapshot.positions.length!==1||pos.length!==1||pos[0].side!==entry.side||pos[0].symbol!=='USD_JPY'||Number(pos[0].size)!==entry.size)return block('POSITION_UNVERIFIED');
 const orders=snapshot.orders;
 if(state.phase==='SNAPSHOT_REQUIRED'){
  if(orders.length!==2||orders.some(x=>String(x.rootOrderId)!==String(entry.rootOrderId)||x.positionLinked!==true||String(x.positionId)!==String(entry.positionId)||x.side==entry.side||Number(x.size)!==entry.size)||new Set(orders.map(x=>x.executionType)).size!==2||!orders.some(x=>x.executionType==='STOP')||!orders.some(x=>x.executionType==='LIMIT'))return block('OCO_PROTECTION_UNVERIFIED');
  if(!allowBrokerWrite)return {ok:false,phase:'SNAPSHOT_REQUIRED',reason:'BROKER_WRITES_NOT_AUTHORIZED'};
  if(typeof broker.cancelOco!=='function')return block('MISSING_CANCEL_ADAPTER');
  state.phase='CANCEL_REQUESTED';state.updatedAt=now;save(file,state); // commit BEFORE request
  try{const result=await broker.cancelOco(entry.rootOrderId);state.phase='CANCEL_UNKNOWN';state.updatedAt=Date.now();save(file,state);return block(result?.accepted===true?'CANCEL_ACCEPTED_NOT_FINAL':'CANCEL_OUTCOME_UNKNOWN')}catch{state.phase='CANCEL_UNKNOWN';state.updatedAt=Date.now();save(file,state);return block('CANCEL_OUTCOME_UNKNOWN')}
 }
 // Only a separate, explicitly vetted recovery operation may authorize advancing phases.
 return block('RECOVERY_REQUIRED');
}
