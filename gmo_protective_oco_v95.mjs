// Broker-specific OCO protective CLOSE order. Explicit operator approval required.
// Order ACK never means position protection is verified. Live scheduler stays disabled.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const API='https://forex-api.coin.z.com/private/v1/closeOrder';
const id=v=>/^[1-9][0-9]*$/.test(String(v))&&Number.isSafeInteger(Number(v));
export function protectiveOcoBody({positionId,positionSide,size='1000',entryPrice}){
 if(!id(positionId)||!['BUY','SELL'].includes(positionSide)||size!=='1000')throw Error('POSITION_ID_SIDE_OR_SIZE_INVALID');
 if(!Number.isFinite(entryPrice)||entryPrice<20||entryPrice>500)throw Error('ENTRY_PRICE_INVALID');
 // JPY gross P&L on 1000 USD: 550 JPY = 0.550 JPY/USD; 150 JPY = 0.150 JPY/USD.
 const dir=positionSide==='BUY'?1:-1;
 const tp=entryPrice+dir*0.55,sl=entryPrice-dir*0.15;
 if(tp<=0||sl<=0||Math.abs(tp-sl)<0.001)throw Error('INVALID_OCO_PRICES');
 return {symbol:'USD_JPY',side:positionSide==='BUY'?'SELL':'BUY',executionType:'OCO',limitPrice:tp.toFixed(3),stopPrice:sl.toFixed(3),settlePosition:[{positionId:Number(positionId),size}]};
}
function durableReserve(filename,body,now){
 if(typeof filename!=='string'||!filename.startsWith('/data/safety/')||!path.isAbsolute(filename))throw Error('RAILWAY_VOLUME_REQUIRED');
 const directory=path.dirname(filename),stat=fs.lstatSync(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('UNSAFE_JOURNAL_DIRECTORY');
 const fd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,JSON.stringify({schema:95,phase:'POST_RESULT_UNKNOWN',createdAt:now,body})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const d=fs.openSync(directory,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
}
export function parseOcoAck(reply){
 if(reply?.status!==0||!id(reply?.data?.rootOrderId))return {accepted:false,protectionVerified:false};
 return {accepted:true,rootOrderId:String(reply.data.rootOrderId),protectionVerified:false};
}
export function createProtectiveOcoSender({apiKey,secret,fetchImpl=globalThis.fetch,clock=Date.now,armed=false,journalDirectory='/data/safety'}={}){
 let used=false;
 return Object.freeze({async submit({positionId,positionSide,size='1000',entryPrice,approved=false,fillProof}={}){
  if(!armed||!approved)throw Error('OPERATOR_APPROVAL_REQUIRED');
  if(used)throw Error('SINGLE_USE_SENDER');used=true;
  if(!apiKey||!secret)throw Error('MISSING_CREDENTIALS');
  // Broker fill must be independently established by order-scoped executions;
  // caller assertions alone are never treated as broker evidence.
  if(fillProof?.brokerReadConfirmed!==true||fillProof?.complete!==true||
   String(fillProof.positionId)!==String(positionId)||String(fillProof.size)!==size||
   fillProof.side!==positionSide||fillProof.orderScoped!==true)throw Error('EXACT_FILL_PROOF_REQUIRED');
  const body=protectiveOcoBody({positionId,positionSide,size,entryPrice});
  const now=clock(),file=path.join(journalDirectory,`oco-${positionId}.json`);
  durableReserve(file,body,now);
  const raw=JSON.stringify(body),ts=String(now);
  const sig=crypto.createHmac('sha256',secret).update(ts+'POST'+'/v1/closeOrder'+raw).digest('hex');
  try{
   const res=await fetchImpl(API,{method:'POST',headers:{'Content-Type':'application/json','API-KEY':apiKey,'API-TIMESTAMP':ts,'API-SIGN':sig},body:raw,signal:AbortSignal.timeout(9000)});
   const ack=res.ok?parseOcoAck(await res.json()):{accepted:false,protectionVerified:false};
   return {...ack,submission:ack.accepted?{body,requestMethod:'POST',requestPath:'/v1/closeOrder',durablyReserved:true,brokerAccepted:true,ackRootOrderId:ack.rootOrderId}:null,orderSent:true,requiresBrokerOcoReadback:true,blockFurtherEntries:true};
  }catch{return {accepted:false,orderSent:'UNKNOWN',protectionVerified:false,requiresBrokerOcoReadback:true,blockFurtherEntries:true};}
 }});
}
