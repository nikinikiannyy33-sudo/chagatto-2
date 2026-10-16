// Explicitly injectable broker-write transport. Never imported or invoked by production index.ts.
// A broker response (including HTTP 200/status 0) is not proof of cancellation or settlement.
import crypto from 'node:crypto';
import fs from 'node:fs';
import nodePath from 'node:path';
const BASE='https://forex-api.coin.z.com/private';
const numericId=v=>/^[1-9][0-9]*$/.test(String(v))&&Number.isSafeInteger(Number(v));
const qty=v=>typeof v==='string'&&/^[1-9][0-9]*$/.test(v)&&Number.isSafeInteger(Number(v));
export function makeWriteBody(kind,input){
 if(kind==='CANCEL_OCO'){
  if(!numericId(input?.rootOrderId))throw Error('INVALID_ROOT_ORDER_ID');
  return {path:'/v1/cancelOrders',body:{rootOrderIds:[Number(input.rootOrderId)]}};
 }
 if(kind==='CLOSE_POSITION'){
  if(!numericId(input?.positionId)||!qty(input?.size)||!['BUY','SELL'].includes(input?.positionSide))throw Error('INVALID_CLOSE_POSITION');
  // Only closes the explicitly specified position. Quantity matching requires a fresh independent broker check.
  return {path:'/v1/closeOrder',body:{symbol:'USD_JPY',side:input.positionSide==='BUY'?'SELL':'BUY',executionType:'MARKET',settlePosition:[{positionId:Number(input.positionId),size:input.size}]}};
 }
 throw Error('WRITE_NOT_ALLOWED');
}
// The FX API returns an acceptance list for cancelOrders, and order IDs for
// closeOrder. HTTP 200/status 0 alone does not identify the accepted write.
// Acknowledgement is never equivalent to a completed cancel or filled close.
export function validateBrokerWriteAck(kind,input,response){
 if(!response||typeof response!=='object'||response.status!==0)return false;
 const data=response.data;
 if(kind==='CANCEL_OCO'){
  if(!data||!Array.isArray(data.success)||(data.failed!==undefined&&!Array.isArray(data.failed)))return false;
  const expected=String(input.rootOrderId);
  if(data.failed?.some(x=>String(x?.rootOrderId)===expected))return false;
  return data.success.length===1&&String(data.success[0]?.rootOrderId)===expected;
 }
 if(kind==='CLOSE_POSITION'){
  if(!data||typeof data!=='object'||Array.isArray(data))return false;
  // Acceptance response must identify a specific newly submitted order.
  const id=data.rootOrderId??data.orderId;
  return numericId(id)&&(!data.symbol||data.symbol==='USD_JPY');
 }
 return false;
}
export function createGmoFxWriter({apiKey,secret,fetchImpl=globalThis.fetch,clock=Date.now,armed=false,journalPath=null}={}){
 if(!apiKey||!secret)throw Error('MISSING_CREDENTIALS');
 if(typeof fetchImpl!=='function')throw Error('MISSING_FETCH');
 let used=false;
 // No live write without an exclusive durable write journal on a mounted volume.
 // A prior file always means an uncertain or completed attempt: never retry.
 function reserve(kind,input){
  if(typeof journalPath!=='string'||!nodePath.isAbsolute(journalPath))throw Error('DURABLE_JOURNAL_REQUIRED');
  const directory=nodePath.dirname(journalPath);
  const st=fs.statSync(directory);
  if(!st.isDirectory())throw Error('JOURNAL_PARENT_NOT_DIRECTORY');
  const record={schemaVersion:1,kind,positionId:input?.positionId??null,rootOrderId:input?.rootOrderId??null,
   size:input?.size??null,phase:'WRITE_OUTCOME_UNKNOWN_UNTIL_BROKER_RECONCILIATION',createdAt:new Date(clock()).toISOString()};
  const fd=fs.openSync(journalPath,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);
  try{fs.writeFileSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  // Also fsync directory so rename/create metadata is durable on a compatible filesystem.
  const dirFd=fs.openSync(directory,fs.constants.O_RDONLY);
  try{fs.fsyncSync(dirFd)}finally{fs.closeSync(dirFd)}
 }
 async function submitOnce(kind,input,{approved=false,durableIntentCommitted=false}={}){
  if(!armed||!approved||!durableIntentCommitted)throw Error('NOT_AUTHORIZED');
  if(used)throw Error('WRITER_ALREADY_USED');
  const {path,body}=makeWriteBody(kind,input);
  used=true; // burn token BEFORE any broker network I/O, including timeouts
  reserve(kind,input); // persisted before network I/O; EEXIST is an unrecoverable no-send outcome
  const payload=JSON.stringify(body),ts=String(clock());
  const signature=crypto.createHmac('sha256',secret).update(ts+'POST'+path+payload).digest('hex');
  try{
   const response=await fetchImpl(BASE+path,{method:'POST',headers:{'Content-Type':'application/json','API-KEY':apiKey,'API-TIMESTAMP':ts,'API-SIGN':signature},body:payload,signal:AbortSignal.timeout(9000)});
   const data=await response.json();
   if(!response.ok||!validateBrokerWriteAck(kind,input,data))return {accepted:false,outcome:'UNVERIFIED_BROKER_ACK',reconciliationRequired:true};
   // Durable order identity supports read-only settlement reconciliation after a restart.
   // If this write fails, the original write journal still forbids another broker POST.
   if(kind==='CLOSE_POSITION'){
    const orderId=data.data.rootOrderId??data.data.orderId;
    const receipt=journalPath+'.ack.json';
    const fd=fs.openSync(receipt,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);
    try{fs.writeFileSync(fd,JSON.stringify({kind,orderId:String(orderId),positionId:String(input.positionId),size:input.size})+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
    const dirfd=fs.openSync(nodePath.dirname(receipt),fs.constants.O_RDONLY);try{fs.fsyncSync(dirfd)}finally{fs.closeSync(dirfd)}
    return {accepted:true,outcome:'ACKNOWLEDGED_NOT_FINAL',reconciliationRequired:true,orderId:String(orderId)};
   }
   return {accepted:true,outcome:'ACKNOWLEDGED_NOT_FINAL',reconciliationRequired:true};
  }catch{return {accepted:false,outcome:'UNKNOWN',reconciliationRequired:true}}
 }
 return Object.freeze({submitOnce});
}
