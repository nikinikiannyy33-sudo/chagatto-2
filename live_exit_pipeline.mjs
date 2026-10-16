// Integration harness: never wire to live scheduler without broker E2E validation.
// Write authorization is deliberately hard-disabled at this integration boundary.
import {advanceFourHourExit,load} from './exit_executor_v62.mjs';
import {inspectTerminalCancel} from './exit_terminal_recovery_v69.mjs';
import {inspectDurableWriteIntent} from './durable_write_recovery.mjs';
const blocked=(reason,extra={})=>Object.freeze({ok:false,liveWriteAuthorized:false,reason,...extra});
export async function inspectFourHourExitPipeline({file,entry,now,broker,writeJournalPath,volumeRoot='/data'}={}){
 if(!broker||typeof broker.snapshot!=='function')return blocked('BROKER_READ_ADAPTER_REQUIRED');
 let state;
 try{state=load(file)}catch{return blocked('EXIT_STATE_UNREADABLE')}
 if(state && ['CANCEL_REQUESTED','CANCEL_UNKNOWN','CLOSE_REQUESTED','CLOSE_UNKNOWN'].includes(state.phase)){
   const kind=state.phase.startsWith('CANCEL')?'CANCEL_OCO':'CLOSE_POSITION';
   const journal=inspectDurableWriteIntent({journalPath:writeJournalPath,expectedKind:kind,expectedPositionId:kind==='CLOSE_POSITION'?entry?.positionId:undefined,expectedRootOrderId:kind==='CANCEL_OCO'?entry?.rootOrderId:undefined,expectedSize:kind==='CLOSE_POSITION'?entry?.size:undefined,volumeRoot});
   return blocked('WRITE_OUTCOME_REQUIRES_MANUAL_BROKER_RECONCILIATION',{phase:state.phase,journalReason:journal.reason});
 }
 const result=await advanceFourHourExit({file,entry,now,broker,allowBrokerWrite:false});
 return Object.freeze({...result,liveWriteAuthorized:false});
}
// Separate inspection step AFTER cancel: corroborates terminal order history, never auto-closes.
export function reviewCanceledOcoForExit({entry,first,second,orderHistory,executionHistory}={}){
 const result=inspectTerminalCancel({entry,first,second,orderHistory,executionHistory});
 return Object.freeze({...result,liveWriteAuthorized:false,automaticCloseAuthorized:false});
}

// Post-write settlement proof. Never uses broker writes or unverified HTTP ACKs.
import {verifyExactSettlement} from './settlement_evidence_v79.mjs';
export function inspectClosedPositionEvidence(input){
 return Object.freeze({...verifyExactSettlement(input),liveWriteAuthorized:false});
}
