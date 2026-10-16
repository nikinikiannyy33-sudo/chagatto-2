import fs from 'node:fs';
import path from 'node:path';
import {runExitTick} from './gmo_live_exit_v98.mjs';
const id=x=>/^[1-9][0-9]*$/.test(String(x));
export function writeProtectedEntry(entry,dir='/data/safety'){
 if(!entry||!id(entry.positionId)||!id(entry.rootOrderId)||!['BUY','SELL'].includes(entry.side)||!Number.isSafeInteger(entry.openedAt)||Number(entry.size)!==1000||entry.coverageVerified!==true||!['INDEPENDENT','OPERATIONAL_NOT_INDEPENDENT'].includes(entry.coverageEvidenceLevel))throw Error('INVALID_PROTECTED_ENTRY');
 if(!dir.startsWith('/data/safety')||!fs.statSync(dir).isDirectory())throw Error('DURABLE_VOLUME_REQUIRED');
 const target=path.join(dir,'protected-position-v99.json');
 const fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(entry)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd)}
 const d=fs.openSync(dir,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
 return target;
}
export async function autoExitMonitor({dir='/data/safety',enabled=false,now=Date.now(),apiKey,secret,run=runExitTick}={}){
 if(!enabled)return {ok:false,reason:'AUTO_EXIT_DISABLED',orderSent:false};
 const file=path.join(dir,'protected-position-v99.json');
 if(!fs.existsSync(file))return {ok:false,reason:'NO_PROTECTED_ENTRY',orderSent:false};
 let entry;
 try{entry=JSON.parse(fs.readFileSync(file,'utf8'))}catch{return {ok:false,reason:'INVALID_DURABLE_ENTRY',orderSent:false}}
 if(!id(entry.positionId)||!id(entry.rootOrderId)||!Number.isSafeInteger(entry.openedAt)||now<entry.openedAt||entry.coverageVerified!==true||!['INDEPENDENT','OPERATIONAL_NOT_INDEPENDENT'].includes(entry.coverageEvidenceLevel)||Number(entry.size)!==1000)return {ok:false,reason:'INVALID_DURABLE_ENTRY',orderSent:false};
 if(now-entry.openedAt<14400000)return {ok:true,reason:'HOLD_NOT_EXPIRED',orderSent:false};
 // Each tick is one broker write at most; restart uses durable cancel/close write journals.
 return await run({entry,apiKey,secret,persistentDirectory:dir,approved:true,liveEnabled:true,now});
}
