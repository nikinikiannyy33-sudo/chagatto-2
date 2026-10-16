// Crash-recovery journal inspector. This module NEVER writes, clears or retries a broker order.
import fs from 'node:fs';
import path from 'node:path';
const validId = x => /^[1-9][0-9]*$/.test(String(x)) && Number.isSafeInteger(Number(x));
const block=(reason,extra={})=>Object.freeze({safeToSend:false,safeToAutoRetry:false,liveWriteAuthorized:false,reason,...extra});
export function inspectDurableWriteIntent({journalPath,expectedKind,expectedPositionId,expectedRootOrderId,expectedSize,volumeRoot='/data',maxBytes=8192}={}){
 if(typeof journalPath!=='string'||!path.isAbsolute(journalPath)||typeof volumeRoot!=='string'||!path.isAbsolute(volumeRoot))return block('INVALID_JOURNAL_LOCATION');
 const base=path.resolve(volumeRoot),resolved=path.resolve(journalPath);
 if(!resolved.startsWith(base+path.sep))return block('JOURNAL_OUTSIDE_VOLUME');
 let stat,data;
 try{
  stat=fs.lstatSync(resolved);
  if(!stat.isFile()||stat.isSymbolicLink())return block('JOURNAL_NOT_REGULAR_FILE');
  if(stat.size===0||stat.size>maxBytes)return block('JOURNAL_INVALID_LENGTH');
  data=JSON.parse(fs.readFileSync(resolved,'utf8'));
 }catch(e){return block(e?.code==='ENOENT'?'MISSING_JOURNAL':'UNREADABLE_OR_CORRUPT_JOURNAL')}
 if(data?.schemaVersion!==1||data?.phase!=='WRITE_OUTCOME_UNKNOWN_UNTIL_BROKER_RECONCILIATION'||!['CANCEL_OCO','CLOSE_POSITION'].includes(data?.kind))return block('UNKNOWN_JOURNAL_SCHEMA');
 if(expectedKind!==data.kind)return block('JOURNAL_KIND_MISMATCH');
 if(expectedRootOrderId!==undefined&&(!validId(expectedRootOrderId)||String(data.rootOrderId)!==String(expectedRootOrderId)))return block('ROOT_ORDER_ID_MISMATCH');
 if(expectedPositionId!==undefined&&(!validId(expectedPositionId)||String(data.positionId)!==String(expectedPositionId)))return block('POSITION_ID_MISMATCH');
 if(expectedSize!==undefined&&(!validId(expectedSize)||String(data.size)!==String(expectedSize)))return block('SIZE_MISMATCH');
 // An existing intent cannot be replayed based on JSON content or HTTP ACK.
 return block('DURABLE_WRITE_ATTEMPT_REQUIRES_BROKER_RECONCILIATION',{attemptKnown:true,kind:data.kind,createdAt:data.createdAt??null});
}
