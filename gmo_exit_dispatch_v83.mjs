// Operator-gated single dispatch integrating the durable v82 exit state with
// authenticated v65 broker transport. No production scheduler imports this module.
// A returned ACK is NOT confirmation of a cancelled order or settled position.
import fs from 'node:fs';
import path from 'node:path';
import {advanceExitWorkflow} from './exit_workflow_v82.mjs';
import {createGmoFxWriter} from './gmo_fx_write_adapter.mjs';
import {auditExactBrokerOco} from './broker_exact_oco_audit_v68.mjs';
const deny=(reason,phase)=>Object.freeze({ok:false,reason,phase,orderSent:false});
const id=x=>typeof x==='string'&&/^[1-9][0-9]*$/.test(x)&&Number.isSafeInteger(Number(x));
const str=x=>typeof x==='string'&&x.length>0;
// This is a testable, deliberately non-automatic dispatch step.
// A separate trusted operator must attest independent broker evidence; the
// integration MUST NOT treat that attestation as a production verification.
export async function dispatchExitWrite({action,entry,now,file,journalPath,credentials,approval,transport,clock,reader}={}){
 if(!['cancel','close'].includes(action))return deny('ACTION_NOT_ALLOWED');
 if(approval?.operatorAuthorized!==true||approval?.liveTradingEnabled!==true||approval?.brokerEvidenceApproved!==true)return deny('EXPLICIT_OPERATOR_APPROVAL_REQUIRED');
 if(!str(file)||!path.isAbsolute(file)||!str(journalPath)||!path.isAbsolute(journalPath)||file===journalPath)return deny('ABSOLUTE_DISTINCT_JOURNALS_REQUIRED');
 if(!id(entry?.positionId)||!id(entry?.rootOrderId)||!Number.isSafeInteger(entry?.size)||entry.size<=0||!['BUY','SELL'].includes(entry?.side))return deny('INVALID_ENTRY');
 if(!str(credentials?.apiKey)||!str(credentials?.secret))return deny('MISSING_CREDENTIALS');
 if(!Number.isSafeInteger(now))return deny('INVALID_TIMESTAMP');
 let state;
 try{state=JSON.parse(fs.readFileSync(file,'utf8'))}catch(e){return deny('PREEXISTING_WORKFLOW_STATE_REQUIRED')}
 const expected=JSON.stringify([entry.positionId,entry.rootOrderId,entry.size,entry.side,entry.openedAt]);
 if(state.version!==82||state.fingerprint!==expected)return deny('ENTRY_IDENTITY_MISMATCH',state.phase);
 const required=action==='cancel'?'CANCEL_SENT_UNKNOWN':'CLOSE_SENT_UNKNOWN';
 if(state.phase!==required)return deny('UNEXPECTED_WORKFLOW_PHASE',state.phase);
 if(!reader || typeof reader.positionAndOrders!=='function' || typeof reader.exactOrder!=='function') return deny('AUTHENTICATED_BROKER_READER_REQUIRED');
 // Two distinct broker reads are required for each dispatch, after durable
 // workflow state has been checked. A caller's brokerEvidenceApproved boolean
 // is never sufficient by itself.
 let first,second,details;
 try {
  first=await reader.positionAndOrders();
  details=await reader.exactOrder(entry.rootOrderId);
  second=await reader.positionAndOrders();
 }catch{return deny('BROKER_EVIDENCE_READ_FAILED')}
 if(!first?.complete || !second?.complete || first?.atomic===true || second?.atomic===true || first===second)
  return deny('INDEPENDENT_COMPLETE_BROKER_READS_REQUIRED');
 if(action==='cancel'){
  const audit=auditExactBrokerOco({entry,first,second,orderDetails:details});
  // The current auditor explicitly cannot prove broker-side exact linkage.
  // Hence real cancellation is blocked pending broker-verified linkage support.
  if(audit?.liveWriteAuthorized!==true)return deny('EXACT_OCO_LINKAGE_NOT_BROKER_VERIFIED');
 }
 if(action==='close'){
  // The two snapshots alone cannot establish completed cancellation. Demand
  // an independent order-scoped terminal proof, not an operator checkbox.
  return deny('ORDER_SCOPED_TERMINAL_CANCEL_EVIDENCE_NOT_CONNECTED');
 }


 // v82 records intent before any external write. This separate journal is an
 // exclusive-create one-shot barrier: a crash before/during POST blocks retry.
 // Protect against non-durable and symlinked journal paths.
 try{
  const base=path.dirname(journalPath),real=fs.realpathSync(base);
  if(real!==base||!fs.statSync(real).isDirectory()||fs.existsSync(journalPath))return deny('JOURNAL_NOT_EXCLUSIVE',state.phase);
 }catch{return deny('JOURNAL_DIRECTORY_UNVERIFIED',state.phase)}
 let writer;
 try{writer=createGmoFxWriter({apiKey:credentials.apiKey,secret:credentials.secret,fetchImpl:transport,clock,armed:true,journalPath})}
 catch{return deny('WRITER_INITIALIZATION_FAILED',state.phase)}
 const kind=action==='cancel'?'CANCEL_OCO':'CLOSE_POSITION';
 const request=action==='cancel'?{rootOrderId:entry.rootOrderId}:{positionId:entry.positionId,size:String(entry.size),positionSide:entry.side};
 try{
  const result=await writer.submitOnce(kind,request,{approved:true,durableIntentCommitted:true});
  return Object.freeze({ok:false,phase:required,orderSent:true,accepted:result.accepted===true,
   reason:'BROKER_WRITE_ATTEMPTED_RECONCILIATION_REQUIRED',outcome:result.outcome});
 }catch{return deny('WRITE_FAILED_OR_OUTCOME_UNKNOWN_RECONCILE_BEFORE_RETRY',required)}
}
// Automated calls from index.ts intentionally disallowed until separate
// authenticated E2E testing; LIVE_TRADING_ENABLED=false remains mandatory.
export const safeForProductionScheduler=false;
