// Pure risk gate: no credentials, no network, no order transmission.
export const HOLD_MS = 4 * 60 * 60 * 1000;
const positiveInt = x => typeof x === 'number' || typeof x === 'string' ? /^[1-9]\d*$/.test(String(x)) && Number.isSafeInteger(Number(x)) : false;
const exactList = response => {
  if (!response || response.status !== 0 || !response.data) return null;
  const d=response.data;
  const rows=Array.isArray(d.list) ? d.list : Array.isArray(d) ? d : null;
  if (!rows || rows.length >= 100) return null;
  for(const k of ['totalCount','count']) if(k in d && (d[k]===null || !Number.isSafeInteger(Number(d[k])) || Number(d[k])<0 || Number(d[k])!==rows.length)) return null;
  // Without explicit totalCount pagination completeness cannot be proven.
  if (!Array.isArray(d) && !('totalCount' in d)) return null;
  return rows;
};
export function planFourHourExit({now,openedAt,positionId,side,size,positionsReply,ordersReply,executionsVerified=false,submittedExit=false,priorState='MONITORING'}) {
  const BLOCK=(reason)=>({decision:'BLOCK_AND_RECONCILE',reason,brokerWriteAllowed:false});
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(openedAt) || openedAt>now) return BLOCK('INVALID_TIMESTAMPS');
  if (!positiveInt(positionId) || !positiveInt(size) || !['BUY','SELL'].includes(side)) return BLOCK('INVALID_POSITION_ID_SIZE_SIDE');
  if (submittedExit || priorState!=='MONITORING') return BLOCK('EXISTING_EXIT_INTENT_OR_INCOMPLETE_STATE');
  const positions=exactList(positionsReply),orders=exactList(ordersReply);
  if(!positions || !orders) return BLOCK('UNVERIFIABLE_BROKER_PAGINATION');
  const matches=positions.filter(p=>String(p.positionId)===String(positionId));
  if(matches.length!==1 || positions.length!==1 || matches[0].side!==side || Number(matches[0].size)!==Number(size)) return BLOCK('POSITION_MISMATCH');
  if(now-openedAt<HOLD_MS) return {decision:'WAIT',reason:'HOLD_NOT_EXPIRED',brokerWriteAllowed:false};
  if(!executionsVerified) return BLOCK('EXECUTIONS_NOT_RECONCILED');
  if(orders.length===0) return BLOCK('NO_PROTECTIVE_ORDER_ON_OPEN_POSITION');
  // Demand explicit linkage of the same position for *every* active order.
  for(const o of orders) {
    if (!Array.isArray(o.settlePosition) || o.settlePosition.length!==1 || String(o.settlePosition[0].positionId)!==String(positionId)) return BLOCK('UNLINKED_OR_OTHER_ACTIVE_ORDER');
    if (o.settleType!=='CLOSE' || o.side===(side==='BUY'?'BUY':'SELL')) return BLOCK('INVALID_PROTECTION_DIRECTION');
  }
  // OCO may be represented by multiple child orders. This module only plans
  // a cancel/reconcile step; never licenses market-close directly.
  return {decision:'REQUIRES_MANUAL_CANCEL_RECONCILE',reason:'PROTECTION_PRESENT_4H_EXPIRED',brokerWriteAllowed:false,
    nextSteps:['Confirm exact parent/child identifiers using full broker order history','Cancel protection with idempotency & durable intent','Verify cancel completion and absence of working child orders','Re-read broker positions and executions before any separate close authorization']};
}
