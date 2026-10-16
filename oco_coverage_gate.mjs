// Independent broker snapshot policy. Read-only, strictly fail-closed.
// A matching OCO root and prices are not proof of protective execution or position linkage.
const integer = (x) => typeof x !== 'boolean' && x !== null && x !== '' && /^\d+$/.test(String(x)) && Number.isSafeInteger(Number(x));
const positive = x => integer(x) && Number(x)>0;
function full(reply){
  if(reply?.status !== 0 || !reply.data || Array.isArray(reply.data) || !Array.isArray(reply.data.list)) return null;
  const {list,totalCount,count}=reply.data;
  if(!integer(totalCount)||Number(totalCount)!==list.length||list.length>=100)return null;
  if(count!==undefined && (!integer(count)||Number(count)!==list.length))return null;
  return list;
}
export function auditOcoCoverage({entry,positionsReply,activeOrdersReply,orderDetailsReply}){
 const stop=(reason)=>({verified:false,allowNewEntry:false,allowCancel:false,allowMarketClose:false,reason});
 if(!entry || !positive(entry.positionId)||!positive(entry.rootOrderId)||!positive(entry.size)||!['BUY','SELL'].includes(entry.side))return stop('INVALID_ENTRY');
 const p=full(positionsReply),a=full(activeOrdersReply),d=full(orderDetailsReply);
 if(!p||!a||!d)return stop('INCOMPLETE_OR_UNVERIFIABLE_BROKER_DATA');
 if(p.length!==1||String(p[0].positionId)!==String(entry.positionId)||Number(p[0].size)!==Number(entry.size)||p[0].side!==entry.side)return stop('POSITION_MISMATCH');
 if(d.length!==2 || a.length!==2)return stop('OCO_LEG_COUNT_UNVERIFIABLE');
 const opposite=entry.side==='BUY'?'SELL':'BUY';
 for(const rows of [a,d]){
   const legs=rows.filter(x=>String(x.rootOrderId)===String(entry.rootOrderId));
   if(legs.length!==2 || legs.some(x=>x.symbol!=='USD_JPY'||x.settleType!=='CLOSE'||x.side!==opposite||!positive(x.size)||Number(x.size)!==Number(entry.size)))return stop('OCO_ROOT_SIDE_OR_SIZE_MISMATCH');
   if(!legs.some(x=>x.executionType==='STOP')||!legs.some(x=>x.executionType==='LIMIT'))return stop('OCO_STOP_LIMIT_NOT_PROVEN');
 }
 // Even this precise-looking snapshot cannot prove that both orders settle the
 // intended position; the broker may not expose an authoritative position link.
 return stop('POSITION_LINK_AND_STOP_TRIGGER_NOT_BROKER_VERIFIED');
}
