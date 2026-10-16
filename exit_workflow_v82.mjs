// Broker-exit orchestration contract. Not connected to production or an automatic scheduler.
// Live writes are hard denied. This module tests transition correctness before any live rollout.
import fs from 'node:fs';
import path from 'node:path';
const deny=(reason, phase)=>Object.freeze({ok:false,phase,reason,liveWriteAuthorized:false});
const allowed=new Set(['NEW','CANCEL_SENT_UNKNOWN','CANCEL_VERIFIED','CLOSE_SENT_UNKNOWN','CLOSED_VERIFIED','HALTED']);
const id=x=>typeof x==='string' && /^[1-9][0-9]*$/.test(x)&&Number.isSafeInteger(Number(x));
const fingerprint=e=>JSON.stringify([e.positionId,e.rootOrderId,e.size,e.side,e.openedAt]);
const valid=e=>e&&id(e.positionId)&&id(e.rootOrderId)&&Number.isSafeInteger(e.size)&&e.size>0&&['BUY','SELL'].includes(e.side)&&Number.isSafeInteger(e.openedAt)&&e.openedAt>0;
function atomicCreate(filename,state){
 const dir=path.dirname(filename);const fd=fs.openSync(filename,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(state)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
 const d=fs.openSync(dir,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
}
function atomicUpdate(filename,state){
 const tmp=filename+'.'+process.pid+'.tmp';
 const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(state)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
 fs.renameSync(tmp,filename);const d=fs.openSync(path.dirname(filename),'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
}
// IMPORTANT: does not accept post-ACK as proof. A *separate* completed-order
// reconciliation must prove the entire cancellation/settlement by exact identity.
export function advanceExitWorkflow({file,entry,now,action,evidence}={}){
 if(!valid(entry)||!Number.isSafeInteger(now)||!file||typeof file!=='string'||!path.isAbsolute(file))return deny('INVALID_ARGUMENT');
 let s;
 try{s=JSON.parse(fs.readFileSync(file,'utf8'))}catch(e){if(e?.code!=='ENOENT')return deny('STATE_UNREADABLE');}
 if(!s){
  if(now-entry.openedAt<14_400_000)return deny('FOUR_HOURS_NOT_ELAPSED','NEW');
  s={version:82,fingerprint:fingerprint(entry),phase:'NEW',createdAt:now};
  try{atomicCreate(file,s)}catch{return deny('DURABLE_STATE_CREATE_FAILED')}
 }
 if(s.version!==82||s.fingerprint!==fingerprint(entry)||!allowed.has(s.phase))return deny('STATE_IDENTITY_MISMATCH');
 const original=s.phase;
 const persist=phase=>{s={...s,phase,updatedAt:now};try{atomicUpdate(file,s);return true}catch{return false}};
 if(action==='inspect')return deny('READ_ONLY_STATE',s.phase);
 if(action==='request-cancel'){
  if(original!=='NEW')return deny('CANCEL_MUST_NOT_REPEAT',original);
  // Intentionally cannot send the POST: establish uncertain intent DURABLY first.
  if(!persist('CANCEL_SENT_UNKNOWN'))return deny('DURABLE_WRITE_FAILED',original);
  return deny('CANCEL_INTENT_SAVED_MANUAL_BROKER_SEND_REQUIRED','CANCEL_SENT_UNKNOWN');
 }
 if(action==='confirm-cancel'){
  if(original!=='CANCEL_SENT_UNKNOWN')return deny('CANCEL_PHASE_MISMATCH',original);
  if(evidence?.complete!==true||evidence?.orderId!==entry.rootOrderId||evidence?.positionId!==entry.positionId||evidence?.cancelTerminal!==true||evidence?.independentReads!==true||evidence?.executionConflict!==false)return deny('CANCEL_NOT_PROVEN',original);
  if(!persist('CANCEL_VERIFIED'))return deny('DURABLE_WRITE_FAILED',original);
  return deny('CANCEL_VERIFIED_WRITE_STILL_DISABLED','CANCEL_VERIFIED');
 }
 if(action==='request-close'){
  if(original!=='CANCEL_VERIFIED')return deny('CLOSE_REQUIRES_PROVEN_CANCEL',original);
  if(evidence?.complete!==true||evidence?.positionId!==entry.positionId||evidence?.size!==entry.size||evidence?.side!==entry.side||evidence?.noLiveOco!==true||evidence?.freshRead!==true)return deny('CLOSE_PREFLIGHT_UNVERIFIED',original);
  if(!persist('CLOSE_SENT_UNKNOWN'))return deny('DURABLE_WRITE_FAILED',original);
  return deny('CLOSE_INTENT_SAVED_MANUAL_BROKER_SEND_REQUIRED','CLOSE_SENT_UNKNOWN');
 }
 if(action==='confirm-close'){
  if(original!=='CLOSE_SENT_UNKNOWN')return deny('CLOSE_PHASE_MISMATCH',original);
  if(evidence?.complete!==true||evidence?.positionId!==entry.positionId||!id(evidence?.closeOrderId)||evidence?.executedSize!==entry.size||evidence?.positionAbsentTwice!==true||evidence?.orderScoped===false||evidence?.orderScoped!==true)return deny('SETTLEMENT_NOT_PROVEN',original);
  if(!persist('CLOSED_VERIFIED'))return deny('DURABLE_WRITE_FAILED',original);
  return deny('SETTLEMENT_VERIFIED_NEW_ENTRY_STILL_BLOCKED','CLOSED_VERIFIED');
 }
 return deny('ACTION_UNAVAILABLE',original);
}
