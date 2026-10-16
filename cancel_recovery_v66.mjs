// Strict post-cancellation read-only reconciliation. No write operations.
// Prevent a stale STOP/OCO from closing a position after a separate market close.
const validId = v => /^[1-9][0-9]*$/.test(String(v)) && Number.isSafeInteger(Number(v));
const validQty = v => Number.isSafeInteger(Number(v)) && Number(v)>0 && v!==null && v!=='';
function normalized(s){
  if(s?.complete!==true || s?.brokerConfirmed!==true || s?.atomic!==false ||
     !Array.isArray(s.positions)||!Array.isArray(s.orders))return null;
  if(s.positions.some(p=>!validId(p.positionId))||s.orders.some(o=>!validId(o.orderId)))return null;
  if(new Set(s.positions.map(p=>String(p.positionId))).size!==s.positions.length)return null;
  if(new Set(s.orders.map(o=>String(o.orderId))).size!==s.orders.length)return null;
  return s;
}
const halt = reason => Object.freeze({ok:false,allowClose:false,reason});
export function checkCancelReconciliation({entry,before,after,executionsConfirmed=false,orderCancelConfirmed=false}={}){
  if(!validId(entry?.positionId)||!validId(entry?.rootOrderId)||!validQty(entry?.size)||
     !['BUY','SELL'].includes(entry?.side)||entry?.symbol!=='USD_JPY')return halt('INVALID_ENTRY');
  const a=normalized(before),b=normalized(after);
  if(!a||!b)return halt('UNVERIFIED_BROKER_SNAPSHOT');
  // Snapshot 2 has to be independently fetched by caller; inputs alone do not prove this.
  if(before===after)return halt('SAME_SNAPSHOT_OBJECT');
  if(!executionsConfirmed||!orderCancelConfirmed)return halt('BROKER_EVENT_HISTORY_UNCONFIRMED');
  for(const snap of [a,b]){
    if(snap.positions.length!==1||snap.orders.length!==0)return halt('OPEN_ORDERS_OR_UNEXPECTED_POSITIONS');
    const p=snap.positions[0];
    if(String(p.positionId)!==String(entry.positionId)||p.symbol!=='USD_JPY'||
       p.side!==entry.side||Number(p.size)!==Number(entry.size))return halt('POSITION_NOT_EXACTLY_MATCHED');
  }
  // Approval is never granted from these observations: concurrent broker changes
  // remain possible, and order-specific terminal status must be authenticated.
  return Object.freeze({ok:true,allowClose:false,phase:'CANCEL_RECONCILED_READ_ONLY',reason:'LIVE_CLOSE_REQUIRES_ATOMIC_BROKER_PROTECTION_AND_SEPARATE_AUTHORIZATION'});
}
