// Four-hour settlement integration uses the v82 durable workflow and v83 broker transport.
// The v83 dispatcher still rejects writes until broker-position linkage and terminal
// cancel proofs are independently established. Never bypass that guard.
import {advanceExitWorkflow} from './exit_workflow_v82.mjs';
import {dispatchExitWrite} from './gmo_exit_dispatch_v83.mjs';
export async function progressFourHourExit({entry,now,file,journalPath,credentials,reader,transport,clock,approval,step,evidence}={}){
 if(!entry||!Number.isSafeInteger(now)||now-entry.openedAt<14_400_000)
  return {ok:false,reason:'FOUR_HOURS_NOT_ELAPSED',orderSent:false};
 if(!['request-cancel','confirm-cancel','request-close','confirm-close','dispatch-cancel','dispatch-close'].includes(step))
  return {ok:false,reason:'INVALID_STEP',orderSent:false};
 if(step.startsWith('dispatch-')){
  if(approval?.operatorAuthorized!==true)return {ok:false,reason:'AUTHORIZATION_REQUIRED',orderSent:false};
  return dispatchExitWrite({action:step==='dispatch-cancel'?'cancel':'close',entry,now,file,journalPath,credentials,reader,transport,clock,approval});
 }
 return advanceExitWorkflow({entry,now,file,action:step,evidence});
}
