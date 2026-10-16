// GMO Coin FX: real signed MARKET order implementation (not activated by default).
// A market fill is NOT a protected position. Never enable without verified OCO and recovery.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {createGmoFxReader} from './gmo_fx_read_adapter.mjs';
const URL='https://forex-api.coin.z.com/private/v1/order';
const SIDE=new Set(['BUY','SELL']);
const positiveId=v=>/^[1-9][0-9]*$/.test(String(v))&&Number.isSafeInteger(Number(v));
export function validateMarketEntry({symbol='USD_JPY',side,size,triggerCandleTime,now=Date.now(),pattern}){
 if(symbol!=='USD_JPY'||!SIDE.has(side)||size!=='1000')throw Error('ENTRY_SYMBOL_SIDE_OR_SIZE_INVALID');
 if(!((pattern==='UUB'||pattern==='BUU')&&side==='BUY'||pattern==='LLN'&&side==='SELL'))throw Error('PATTERN_SIDE_MISMATCH');
 if(!Number.isSafeInteger(triggerCandleTime)||triggerCandleTime<=0||triggerCandleTime%300000!==0||triggerCandleTime+300000>now||now-triggerCandleTime>=600000)throw Error('STALE_OR_UNCLOSED_BAR');
 return {symbol,side,executionType:'MARKET',size};
}
export function interpretMarketAck(json){
 if(!json||json.status!==0)return {accepted:false,reason:'API_NOT_ACCEPTED'};
 const rootOrderId=json.data?.rootOrderId??json.data?.orderId;
 if(!positiveId(rootOrderId))return {accepted:false,reason:'ORDER_ID_NOT_CONFIRMED'};
 return {accepted:true,rootOrderId:String(rootOrderId),filled:false,protected:false};
}
function reserveExclusive(filepath,payload){
 if(!path.isAbsolute(filepath)||!filepath.startsWith('/data/'))throw Error('PERSISTENT_RAILWAY_VOLUME_REQUIRED');
 const dir=path.dirname(filepath);if(!fs.statSync(dir).isDirectory())throw Error('NO_JOURNAL_DIRECTORY');
 const fd=fs.openSync(filepath,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(payload)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const dirfd=fs.openSync(dir,fs.constants.O_RDONLY);try{fs.fsyncSync(dirfd);}finally{fs.closeSync(dirfd);}
}
export function createLiveMarketEntry({apiKey,secret,fetchImpl=globalThis.fetch,clock=Date.now,journalDirectory='/data/safety',armed=false}={}){
 let used=false;
 async function submit({side,size='1000',pattern,triggerCandleTime,approved=false}={}){
  if(!armed||!approved)throw Error('LIVE_ENTRY_NOT_APPROVED');
  if(used)throw Error('SINGLE_USE_ENTRY_ADAPTER');used=true;
  if(!apiKey||!secret)throw Error('MISSING_GMO_KEYS');
  const now=clock();
  const body=validateMarketEntry({side,size,pattern,triggerCandleTime,now});
  // At least one empty account snapshot; a non-atomic snapshot is NOT an order lock.
  const reader=createGmoFxReader({apiKey,secret,fetchImpl,clock});
  const snapshot=await reader.positionAndOrders();
  if(!snapshot.complete||snapshot.positions.length||snapshot.orders.length)throw Error('BROKER_NOT_FLAT_OR_NOT_VERIFIED');
  const filename=path.join(journalDirectory,`entry-${triggerCandleTime}.json`);
  reserveExclusive(filename,{version:94,state:'UNKNOWN_UNTIL_BROKER_RECONCILIATION',triggerCandleTime,pattern,side,size,createdAt:new Date(now).toISOString()});
  const raw=JSON.stringify(body),ts=String(clock()),sign=crypto.createHmac('sha256',secret).update(ts+'POST'+'/v1/order'+raw).digest('hex');
  try{
   const reply=await fetchImpl(URL,{method:'POST',headers:{'Content-Type':'application/json','API-KEY':apiKey,'API-TIMESTAMP':ts,'API-SIGN':sign},body:raw,signal:AbortSignal.timeout(9000)});
   const json=await reply.json();const ack=reply.ok?interpretMarketAck(json):{accepted:false,reason:'BROKER_HTTP_FAILURE'};
   return {...ack,orderSent:true,orderResultFinal:false,requiresOrderFillAndProtectiveOcoReconciliation:true,blockFurtherEntries:true};
  }catch{return {accepted:false,orderSent:'UNKNOWN',orderResultFinal:false,requiresOrderFillAndProtectiveOcoReconciliation:true,blockFurtherEntries:true};}
 }
 return Object.freeze({submit});
}
