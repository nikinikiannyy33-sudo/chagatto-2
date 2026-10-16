// Production-path broker exposure triage. Read-only: never authorizes a market order.
import {classifyLiveBrokerExposure} from './live_position_age_v92.mjs';
const positive=x=>/^[1-9][0-9]*$/.test(String(x)) && Number.isSafeInteger(Number(x));
export function reviewLiveExitExposure(snapshot, now) {
  if(snapshot?.complete!==true || snapshot?.brokerConfirmed!==true || snapshot?.atomic!==false ||
    !Array.isArray(snapshot.positions)||!Array.isArray(snapshot.orders))
    return Object.freeze({ok:false,reason:'BROKER_SNAPSHOT_NOT_COMPLETE',blocked:true,writeAllowed:false});
  if(snapshot.positions.some(p=>!positive(p.positionId)) || snapshot.orders.some(o=>!positive(o.orderId)))
    return Object.freeze({ok:false,reason:'BROKER_IDENTITY_INVALID',blocked:true,writeAllowed:false});
  const seenIds=new Set(snapshot.positions.map(p=>String(p.positionId)));
  if(seenIds.size!==snapshot.positions.length)
    return Object.freeze({ok:false,reason:'DUPLICATE_POSITION_ID',blocked:true,writeAllowed:false});
  const seenOrders=new Set(snapshot.orders.map(o=>String(o.orderId)));
  if(seenOrders.size!==snapshot.orders.length)
    return Object.freeze({ok:false,reason:'DUPLICATE_ORDER_ID',blocked:true,writeAllowed:false});
  const age=classifyLiveBrokerExposure(snapshot.positions,now);
  // Broker active orders do not, by themselves, prove exact position-linked OCO coverage.
  const reviewRequired=age.expiredCount>0 || age.unknownCount>0 || snapshot.positions.length>0 || snapshot.orders.length>0;
  const reason=age.expiredCount>0?'FOUR_HOUR_EXIT_REQUIRES_ORDER_SCOPED_RECONCILIATION':
    age.unknownCount>0?'POSITION_AGE_UNKNOWN':
    snapshot.positions.length>0?'POSITION_PROTECTION_UNVERIFIED':
    snapshot.orders.length>0?'ORPHAN_OR_UNVERIFIED_BROKER_ORDER':'NO_BROKER_EXPOSURE';
  return Object.freeze({ok:true,reason,reviewRequired,age,positionCount:snapshot.positions.length,
     activeOrderCount:snapshot.orders.length,writeAllowed:false,orderSent:false});
}
