// v70: Single integrated, authenticated, READ-ONLY broker exit preflight.
// Inputs are externally established entry identifiers, not an instruction to trade.
import {auditExactBrokerOco} from './broker_exact_oco_audit_v68.mjs';
import {inspectTerminalCancel} from './exit_terminal_recovery_v69.mjs';
const validId=v=>/^[1-9][0-9]*$/.test(String(v))&&Number.isSafeInteger(Number(v));
const halt=(reason,extra={})=>({status:'BLOCK',reason,liveWriteAuthorized:false,orderSent:false,...extra});
export async function readOnlyExitPreflight({reader,entry,now=Date.now(),terminalHistory=null}={}){
 if(!reader || !validId(entry?.positionId)||!validId(entry?.rootOrderId)||!validId(entry?.size)||!['BUY','SELL'].includes(entry?.side)||!Number.isSafeInteger(entry?.openedAt)||!Number.isSafeInteger(now))return halt('INVALID_INPUT');
 // This code never calls a broker write method, even if one is present on reader.
 let first,second,details;
 try{
  first=await reader.positionAndOrders();
  details=await reader.exactOrder(entry.rootOrderId);
  second=await reader.positionAndOrders();
 }catch{return halt('BROKER_READ_OR_PAGINATION_FAILED');}
 const proof=auditExactBrokerOco({entry,first,second,orderDetails:details});
 const due=now-entry.openedAt>=14_400_000;
 const base={dueForFourHourReview:due,ocoAudit:proof,brokerSnapshotsIndependent:first!==second};
 if(!due)return halt('FOUR_HOURS_NOT_ELAPSED',base);
 if(proof.reason!=='BROKER_POSITION_LINKAGE_NOT_VERIFIED')return halt('OCO_AUDIT_'+proof.reason,base);
 if(!terminalHistory)return halt('POSITION_TO_OCO_LINKAGE_NOT_VERIFIED',base);
 const terminal=inspectTerminalCancel({entry,first,second,orderHistory:terminalHistory.orderHistory,executionHistory:terminalHistory.executionHistory});
 // Terminal evidence is diagnostic only. Never authorize close based on non-atomic GETs.
 return halt(terminal.ok?'TERMINAL_EVIDENCE_REQUIRES_INDEPENDENT_LIVE_VALIDATION':'TERMINAL_'+terminal.reason,{...base,terminal});
}
