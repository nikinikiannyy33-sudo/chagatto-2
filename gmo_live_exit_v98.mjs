// V98: one-way broker exit controller. A write is persisted before network I/O.
// Tick returns after at most one broker write. Re-run only with new broker evidence.
import fs from 'node:fs';
import path from 'node:path';
import {createGmoFxReader} from './gmo_fx_read_adapter.mjs';
import {createGmoFxWriter} from './gmo_fx_write_adapter.mjs';
import {verifyExactSettlement} from './settlement_evidence_v79.mjs';

const numeric=x=>/^[1-9][0-9]*$/.test(String(x))&&Number.isSafeInteger(Number(x));
const stop=(reason,more={})=>({ok:false,reason,orderSent:false,...more});
function storage(dir){
 if(!dir.startsWith('/data/safety')||!path.isAbsolute(dir))throw Error('RAILWAY_VOLUME_REQUIRED');
 const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('UNSAFE_STORAGE');
}
function persistNew(file,record){
 const fd=fs.openSync(file,fs.constants.O_EXCL|fs.constants.O_CREAT|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const d=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
}
function ordersFor(s,root){return s.orders.filter(x=>String(x.rootOrderId)===String(root));}
function positionFor(s,id){return s.positions.filter(x=>String(x.positionId)===String(id));}
function sameEvidence(a,b){return JSON.stringify(a)===JSON.stringify(b)}
async function snapshotTwice(reader){
 const a=await reader.positionAndOrders(),b=await reader.positionAndOrders();
 if(!a?.complete||!b?.complete||!a.brokerConfirmed||!b.brokerConfirmed||a===b||
 !sameEvidence(a.positions,b.positions)||!sameEvidence(a.orders,b.orders))throw Error('BROKER_SNAPSHOT_UNSTABLE');
 return b;
}
export function validateExitIdentity(entry){
 return numeric(entry?.positionId)&&numeric(entry?.rootOrderId)&&
 ['BUY','SELL'].includes(entry?.side)&&Number(entry?.size)===1000&&
 Number.isSafeInteger(entry?.openedAt)&&entry.openedAt>0;
}
export async function runExitTick({entry,apiKey,secret,persistentDirectory='/data/safety',
  approved=false,liveEnabled=false,now=Date.now(),fetchImpl=globalThis.fetch,
  readerFactory=createGmoFxReader,writerFactory=createGmoFxWriter}={}){
 if(!approved||!liveEnabled)return stop('EXPLICIT_LIVE_APPROVAL_REQUIRED');
 if(!validateExitIdentity(entry))return stop('INVALID_POSITION_IDENTITY');
 if(!Number.isSafeInteger(now)||now-entry.openedAt<14400000)return stop('FOUR_HOUR_LIMIT_NOT_REACHED');
 if(!apiKey||!secret)return stop('MISSING_CREDENTIALS');
 try{storage(persistentDirectory)}catch(e){return stop(String(e.message))}
 const base=`exit-v98-${entry.positionId}`;
 const cancellation=path.join(persistentDirectory,base+'-cancel.json');
 const closing=path.join(persistentDirectory,base+'-close.json');
 let reader,snapshot;
 try{
  reader=readerFactory({apiKey,secret,fetchImpl,clock:()=>now});
  snapshot=await snapshotTwice(reader);
 }catch(e){return stop('BROKER_READ_FAILED_OR_UNSTABLE',{detail:String(e?.message??e)})}
 const positions=positionFor(snapshot,entry.positionId);
 if(positions.length>1)return stop('DUPLICATE_POSITION_ID');
 if(positions.length===1&&
  (positions[0].symbol!=='USD_JPY'||positions[0].side!==entry.side||Number(positions[0].size)!==1000))
  return stop('POSITION_IDENTITY_CHANGED');
 const active=ordersFor(snapshot,entry.rootOrderId);
 const otherOrders=snapshot.orders.filter(x=>String(x.rootOrderId)!==String(entry.rootOrderId));
 if(otherOrders.length||snapshot.positions.some(x=>String(x.positionId)!==String(entry.positionId)))
  return stop('UNRELATED_ACCOUNT_EXPOSURE');
 if(fs.existsSync(closing)){
  // Never retransmit a close order. Read only, using the durable broker ACK identity.
  const ackFile=closing+'.ack.json';
  if(!fs.existsSync(ackFile))return stop('CLOSE_OUTCOME_UNKNOWN_NO_DURABLE_ACK',{requiresManualBrokerReview:true});
  let ack;
  try{ack=JSON.parse(fs.readFileSync(ackFile,'utf8'))}catch{return stop('CLOSE_ACK_DAMAGED',{requiresManualBrokerReview:true})}
  if(ack.kind!=='CLOSE_POSITION'||!numeric(ack.orderId)||String(ack.positionId)!==String(entry.positionId)||String(ack.size)!=='1000')
   return stop('CLOSE_ACK_IDENTITY_MISMATCH',{requiresManualBrokerReview:true});
  try{
   const first=snapshot;
   const second=await snapshotTwice(reader);
   const history=await reader.completeExecutions(ack.orderId);
   const verdict=verifyExactSettlement({entry,closeOrderId:ack.orderId,first,second,executions:history.rows,executionHistoryComplete:history.complete});
   if(verdict.settled)return {ok:true,reason:'EXACT_SETTLEMENT_CONFIRMED',settled:true,orderSent:false,closeOrderId:ack.orderId};
   return stop('SETTLEMENT_NOT_YET_PROVEN:'+verdict.reason,{requiresManualBrokerReview:true});
  }catch(e){return stop('SETTLEMENT_READ_FAILED_OR_INCOMPLETE',{detail:String(e?.message??e),requiresManualBrokerReview:true})}
 }
 if(positions.length===0){
  // No position alone is not proof that the broker close succeeded. Do not retry.
  return stop('POSITION_ABSENT_VERIFY_EXECUTIONS_AND_CANCEL_PROTECTION',{requiresManualBrokerReview:true});
 }
 if(!fs.existsSync(cancellation)){
  // Two OCO legs and exact broker-side linkage are required for a safe cancel.
  if(active.length!==2)return stop('OCO_ACTIVE_LEGS_NOT_EXACT');
  if(active.some(o=>o.symbol!=='USD_JPY'||o.side===(entry.side)||Number(o.size)!==1000)||
     new Set(active.map(o=>String(o.orderId))).size!==2 ||
     active.map(o=>o.executionType).sort().join(',')!=='LIMIT,STOP')
     return stop('OCO_ATTRIBUTE_MISMATCH');
  // No broker-documented positionId on a child order is proof of position linking.
  const brokerLinked=active.every(o=>o.positionId!==undefined&&String(o.positionId)===String(entry.positionId));
  // GMO GET orders does not always carry positionId. In that case require the
  // durable protected-entry provenance AND independent exact root-order detail.
  if(!brokerLinked){
   if(entry.coverageVerified!==true||!['OPERATIONAL_NOT_INDEPENDENT','INDEPENDENT'].includes(entry.coverageEvidenceLevel))
    return stop('OCO_POSITION_LINKAGE_NOT_VERIFIED');
   let details;
   try{details=await reader.exactOrder(entry.rootOrderId)}catch{return stop('OCO_DETAIL_READ_FAILED')}
   if(!Array.isArray(details)||details.length!==2||
      details.some(o=>String(o.rootOrderId)!==String(entry.rootOrderId)||o.symbol!=='USD_JPY'||o.side===entry.side||Number(o.size)!==1000)||
      details.map(o=>o.executionType).sort().join(',')!=='LIMIT,STOP'||
      details.map(o=>String(o.orderId)).sort().join(',')!==active.map(o=>String(o.orderId)).sort().join(',')||
      details.some(o=>o.positionId!==undefined&&String(o.positionId)!==String(entry.positionId)))
     return stop('OCO_DETAILS_DO_NOT_CORROBORATE_PROTECTED_ENTRY');
  }
  try{
   const writer=writerFactory({apiKey,secret,fetchImpl,clock:()=>now,armed:true,journalPath:cancellation});
   const result=await writer.submitOnce('CANCEL_OCO',{rootOrderId:entry.rootOrderId},{approved:true,durableIntentCommitted:true});
   return stop('CANCEL_ATTEMPTED_RECONCILIATION_REQUIRED',{orderSent:true,brokerAck:result.accepted,requiresFollowupTick:true});
  }catch(e){return stop('CANCEL_SEND_FAILED_OR_UNCERTAIN',{detail:String(e?.message??e),requiresManualBrokerReview:true})}
 }
 // Never infer cancellation success from the ACK; require terminal proof tied to each leg.
 if(active.length!==0)return stop('CANCEL_NOT_TERMINAL',{requiresManualBrokerReview:true});
 let orderRows;
 try{orderRows=await reader.exactOrder(entry.rootOrderId)}catch(e){return stop('CANCEL_ORDER_HISTORY_UNREADABLE')}
 if(!Array.isArray(orderRows)||orderRows.length!==2 ||
    orderRows.some(o=>String(o.rootOrderId)!==String(entry.rootOrderId)||
      !['CANCELED','CANCELLED'].includes(String(o.status??o.orderStatus).toUpperCase())))
    return stop('CANCEL_TERMINAL_PROOF_MISSING');
 try{
  // Closing also reserves its own one-shot durable journal before POST.
  const writer=writerFactory({apiKey,secret,fetchImpl,clock:()=>now,armed:true,journalPath:closing});
  const result=await writer.submitOnce('CLOSE_POSITION',{positionId:entry.positionId,size:'1000',positionSide:entry.side},{approved:true,durableIntentCommitted:true});
  return stop('CLOSE_ATTEMPTED_FILL_RECONCILIATION_REQUIRED',{orderSent:true,brokerAck:result.accepted,requiresManualBrokerReview:true});
 }catch(e){return stop('CLOSE_SEND_FAILED_OR_UNCERTAIN',{detail:String(e?.message??e),requiresManualBrokerReview:true})}
}
