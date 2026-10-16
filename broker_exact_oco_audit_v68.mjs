// Strict read-only broker order audit. Never authorizes writes from non-atomic GETs.
const id = v => /^(?:[1-9][0-9]*)$/.test(String(v)) && Number.isSafeInteger(Number(v));
const qty = v => id(v);
const blocked = (reason, extra={}) => Object.freeze({readOnly:true, allowNewEntry:false,allowCancel:false,allowMarketClose:false, verified:false,reason,...extra});
export function auditExactBrokerOco({entry,first,second,orderDetails}={}) {
 if(!id(entry?.positionId)||!id(entry?.rootOrderId)||!qty(entry?.size)||!['BUY','SELL'].includes(entry?.side))return blocked('INVALID_ENTRY');
 const snaps=[first,second];
 for(const s of snaps){
  if(s?.complete!==true||s?.brokerConfirmed!==true||s?.atomic!==false||!Array.isArray(s.positions)||!Array.isArray(s.orders))return blocked('INCOMPLETE_BROKER_SNAPSHOT');
  if(s.positions.some(p=>!id(p.positionId))||s.orders.some(o=>!id(o.orderId)))return blocked('INVALID_BROKER_IDENTIFIERS');
  if(new Set(s.positions.map(p=>String(p.positionId))).size!==s.positions.length||new Set(s.orders.map(o=>String(o.orderId))).size!==s.orders.length)return blocked('DUPLICATE_BROKER_IDENTIFIERS');
 }
 if(first===second)return blocked('SNAPSHOT_NOT_INDEPENDENT');
 const signature=s=>JSON.stringify({positions:[...s.positions].sort((a,b)=>String(a.positionId).localeCompare(String(b.positionId))),orders:[...s.orders].sort((a,b)=>String(a.orderId).localeCompare(String(b.orderId)))});
 if(signature(first)!==signature(second))return blocked('SNAPSHOTS_CHANGED');
 const p=second.positions;
 if(p.length!==1||String(p[0].positionId)!==String(entry.positionId)||p[0].symbol!=='USD_JPY'||p[0].side!==entry.side||Number(p[0].size)!==Number(entry.size))return blocked('POSITION_NOT_EXACT');
 if(!Array.isArray(orderDetails))return blocked('ORDER_DETAILS_MISSING');
 const active=second.orders, details=orderDetails;
 if(active.length!==2||details.length!==2)return blocked('OCO_LEG_COUNT_MISMATCH');
 const opposite=entry.side==='BUY'?'SELL':'BUY';
 for(const legs of [active,details]){
  if(legs.some(o=>String(o.rootOrderId)!==String(entry.rootOrderId)||o.symbol!=='USD_JPY'||o.side!==opposite||Number(o.size)!==Number(entry.size)))return blocked('OCO_LEG_ATTRIBUTES_MISMATCH');
  const kinds=legs.map(o=>String(o.executionType).toUpperCase()).sort();
  if(kinds.join(',')!=='LIMIT,STOP')return blocked('OCO_STOP_LIMIT_MISMATCH');
  if(new Set(legs.map(o=>String(o.orderId))).size!==2)return blocked('DUPLICATE_OCO_LEGS');
 }
 if(active.map(o=>String(o.orderId)).sort().join(',')!==details.map(o=>String(o.orderId)).sort().join(','))return blocked('ACTIVE_DETAILS_DIFFER');
 // OCO root+legs alone do not prove broker-enforced linkage to a given open position.
 // Never convert this read-only diagnosis into an order/close permission.
 return blocked('BROKER_POSITION_LINKAGE_NOT_VERIFIED', {snapshotStable:true,matchingOcoLegs:2,positionFound:true});
}
