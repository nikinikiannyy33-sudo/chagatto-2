// After an uncertain cancellation, determine whether it is safe to consider the
// order terminal. Never authorizes a market close from non-atomic snapshots.
const positive = x => /^[1-9][0-9]*$/.test(String(x)) && Number.isSafeInteger(Number(x));
const fail = reason => Object.freeze({ok:false,allowClose:false,reason});
function canonical(x){
  if(x?.complete!==true || x?.brokerConfirmed!==true || x?.atomic!==false || !Array.isArray(x.positions)||!Array.isArray(x.orders))return null;
  const ids=x.orders.map(v=>String(v.orderId));
  if(ids.some(x=>!positive(x))||ids.length!==new Set(ids).size)return null;
  return x;
}
export function inspectTerminalCancel({entry,first,second,orderHistory,executionHistory}={}){
  if(!positive(entry?.positionId)||!positive(entry?.rootOrderId)||!positive(entry?.size)||!['BUY','SELL'].includes(entry?.side))return fail('INVALID_ENTRY');
  if(first===second||!canonical(first)||!canonical(second))return fail('BROKER_SNAPSHOTS_UNVERIFIED');
  if(!Array.isArray(orderHistory)||!Array.isArray(executionHistory))return fail('MISSING_TERMINAL_BROKER_HISTORY');
  if(!orderHistory.length)return fail('MISSING_ORDER_HISTORY');
  if(orderHistory.some(x=>String(x.rootOrderId)!==String(entry.rootOrderId)))return fail('FOREIGN_ORDER_IN_HISTORY');
  if(orderHistory.some(x=>!positive(x.orderId)))return fail('INVALID_ORDER_HISTORY');
  if(new Set(orderHistory.map(x=>String(x.orderId))).size!==orderHistory.length)return fail('DUPLICATE_ORDER_HISTORY');
  if(orderHistory.some(x=>!['CANCELED','CANCELLED','EXPIRED','EXECUTED'].includes(x.status)))return fail('NONTERMINAL_ORDER_STATUS');
  if(orderHistory.some(x=>x.status==='EXECUTED'))return fail('EXECUTED_ORDER_REQUIRES_FILL_RECONCILIATION');
  if(executionHistory.some(x=>String(x.rootOrderId)===String(entry.rootOrderId)))return fail('OCO_EXECUTION_REQUIRES_POSITION_RECONCILIATION');
  for(const snap of [first,second]){
    if(snap.orders.some(x=>String(x.rootOrderId)===String(entry.rootOrderId)))return fail('PROTECTIVE_ORDER_STILL_ACTIVE');
    if(snap.positions.length!==1)return fail('UNEXPECTED_POSITION_COUNT');
    const p=snap.positions[0];
    if(String(p.positionId)!==String(entry.positionId)||p.side!==entry.side||p.symbol!=='USD_JPY'||Number(p.size)!==Number(entry.size))return fail('POSITION_CHANGED');
  }
  // The broker could update between GETs. No automated close permission.
  return Object.freeze({ok:true,phase:'CANCEL_TERMINAL_HISTORY_CORROBORATED',allowClose:false,reason:'NONATOMIC_READS_CANNOT_AUTHORIZE_LIVE_CLOSE'});
}
