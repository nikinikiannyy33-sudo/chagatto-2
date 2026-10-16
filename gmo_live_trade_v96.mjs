// Actual GMO FX POST order -> independent broker fill read -> OCO POST -> broker readback.
// Explicit operator opt-in required. This is NOT activated by index.ts or the scheduler.
// The first market fill exposes real market risk until OCO is confirmed.
import {createLiveMarketEntry} from './gmo_live_market_order_v94.mjs';
import {createProtectiveOcoSender} from './gmo_protective_oco_v95.mjs';
import {createGmoFxReader} from './gmo_fx_read_adapter.mjs';
import {verifyOcoCoverage} from './gmo_oco_coverage_v99.mjs';

function halt(stage,reason,details={}) {return {stage,halted:true,liveOrderMayExist:stage!=='PRE_ENTRY',requiresManualBrokerReview:true,reason,...details};}
const posId=x=>/^[1-9][0-9]*$/.test(String(x));
// For one fully executed 1000-unit order; partial executions halt for human recovery.
export function establishExactFill(rows,{orderId,side}={}){
 if(!Array.isArray(rows)||rows.length===0||!posId(orderId))throw Error('NO_COMPLETE_EXECUTIONS');
 if(rows.some(r=>String(r.orderId)!==String(orderId)||!posId(r.positionId)||!posId(r.executionId)))throw Error('EXECUTION_ID_MISMATCH');
 // Repeated execution rows can otherwise falsely sum to a complete 1,000-unit fill.
 if(new Set(rows.map(r=>String(r.executionId))).size!==rows.length)throw Error('DUPLICATE_EXECUTION_ID');
 const positions=new Set(rows.map(x=>String(x.positionId)));
 const sizes=rows.map(x=>Number(x.size));
 if(positions.size!==1||sizes.some(x=>!Number.isSafeInteger(x)||x<=0)||sizes.reduce((a,b)=>a+b,0)!==1000)throw Error('PARTIAL_OR_MULTI_POSITION_FILL');
 if(rows.some(x=>x.side&&x.side!==side))throw Error('FILL_SIDE_MISMATCH');
 const prices=rows.map(x=>Number(x.price));
 if(prices.some(x=>!Number.isFinite(x)||x<20||x>500))throw Error('ENTRY_PRICE_UNVERIFIED');
 const avg=rows.reduce((a,x)=>a+Number(x.size)*Number(x.price),0)/1000;
 return {positionId:[...positions][0],side,size:'1000',entryPrice:avg,brokerReadConfirmed:true,orderScoped:true,complete:true};
}
export async function executeOneLiveTrade({apiKey,secret,pattern,side,triggerCandleTime,approved=false,
  persistentDirectory='/data/safety',fetchImpl=globalThis.fetch,clock=Date.now,
  createEntry=createLiveMarketEntry,createProtection=createProtectiveOcoSender,createReader=createGmoFxReader}={}){
 if(approved!==true)return halt('PRE_ENTRY','EXPLICIT_APPROVAL_REQUIRED',{liveOrderMayExist:false});
 if(!apiKey||!secret)return halt('PRE_ENTRY','MISSING_GMO_CREDENTIALS',{liveOrderMayExist:false});
 let entry;
 try{
  entry=await createEntry({apiKey,secret,fetchImpl,clock,journalDirectory:persistentDirectory,armed:true})
    .submit({side,pattern,triggerCandleTime,size:'1000',approved:true});
 }catch(e){return halt('PRE_ENTRY',String(e?.message??e),{liveOrderMayExist:false});}
 if(!entry?.accepted||!posId(entry.rootOrderId))return halt('ENTRY_RESULT_UNCERTAIN','MARKET_ENTRY_NOT_CONFIRMED',{entry});
 let fill;
 try{
  const reader=createReader({apiKey,secret,fetchImpl,clock});
  const result=await reader.completeExecutions(entry.rootOrderId);
  if(result?.complete!==true)throw Error('INCOMPLETE_EXECUTION_HISTORY');
  fill=establishExactFill(result.rows,{orderId:entry.rootOrderId,side});
 }catch(e){return halt('FILL_UNVERIFIED',String(e?.message??e),{entryOrderId:entry.rootOrderId});}
 let protection;
 try{
  protection=await createProtection({apiKey,secret,fetchImpl,clock,armed:true,journalDirectory:persistentDirectory})
    .submit({positionId:fill.positionId,positionSide:fill.side,size:fill.size,entryPrice:fill.entryPrice,
       fillProof:fill,approved:true});
 }catch(e){return halt('OCO_UNVERIFIED',String(e?.message??e),{positionId:fill.positionId});}
 if(!protection?.accepted||!posId(protection.rootOrderId))return halt('OCO_UNVERIFIED','OCO_POST_NOT_CONFIRMED',{positionId:fill.positionId,protection});
 // Independently compare TWO snapshots and the root-order-specific details.
 try{
  const reader=createReader({apiKey,secret,fetchImpl,clock});
  const first=await reader.positionAndOrders();
  const details=await reader.exactOrder(protection.rootOrderId);
  const second=await reader.positionAndOrders();
  const entryIdentity={positionId:fill.positionId,rootOrderId:protection.rootOrderId,side:fill.side,size:1000};
  const coverage=verifyOcoCoverage({entry:entryIdentity,first,second,details,submission:protection.submission});
  if(!coverage.verified)return halt('OCO_LINKAGE_UNVERIFIED',coverage.reason,{positionId:fill.positionId,rootOrderId:protection.rootOrderId});
  return {stage:'PROTECTED',halted:false,coverageVerified:true,coverageEvidenceLevel:coverage.evidenceLevel,entry:{...entryIdentity,openedAt:clock(),coverageVerified:true,coverageEvidenceLevel:coverage.evidenceLevel},orderSent:true};
 }catch(e){return halt('OCO_READBACK_UNVERIFIED',String(e?.message??e),{positionId:fill.positionId,rootOrderId:protection.rootOrderId});}
}
