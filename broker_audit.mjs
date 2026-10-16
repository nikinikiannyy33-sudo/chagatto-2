// v59: Read-only broker audit (no order/cancel/change paths).
// Metadata may be absent or partial; never infer position safety from that.
const numericId = x => /^[1-9]\d*$/.test(String(x ?? ''));
const arr = r => r && r.status===0 && (Array.isArray(r.data?.list) ? r.data.list : Array.isArray(r.data) ? r.data : null);
const safeCount = (x,n) => x !== undefined && x !== null && x !== '' && !['boolean','object'].includes(typeof x) && Number.isSafeInteger(Number(x)) && Number(x)===n;
export function auditSnapshot(positionReply, orderReply, executionReply) {
 const blocked = reason => ({status:'BLOCK',reason,liveApproved:false,submitOrder:false,submitClose:false,submitCancel:false});
 const positions=arr(positionReply),orders=arr(orderReply),executions=arr(executionReply);
 if(!positions||!orders||!executions)return blocked('BROKER_READ_INVALID');
 if(positions.length>=100||orders.length>=100||executions.length>=100)return blocked('PAGINATION_UNVERIFIED');
 // Broker APIs can return arrays with no total count; such responses are not proof of completeness.
 for(const [r,rows] of [[positionReply,positions],[orderReply,orders],[executionReply,executions]]){
   if(!r.data || Array.isArray(r.data) || !safeCount(r.data.totalCount, rows.length))return blocked('TOTAL_COUNT_NOT_PROVEN');
 }
 if(positions.length>1)return blocked('MORE_THAN_ONE_POSITION');
 if(positions.length===0){
   if(orders.length)return blocked('STALE_OR_OPEN_ORDER_WITHOUT_POSITION');
   return { ...blocked('NO_POSITION_FOUND_BUT_LIVE_NOT_AUTHORIZED'),positions:0,activeOrders:0};
 }
 const p=positions[0];
 if(!numericId(p.positionId)||!['BUY','SELL'].includes(p.side)||!numericId(p.size)||p.symbol!=='USD_JPY')return blocked('INVALID_POSITION');
 if(!orders.length)return blocked('OPEN_POSITION_WITHOUT_ACTIVE_PROTECTION');
 if(orders.some(o=>o.symbol!=='USD_JPY'||o.settleType!=='CLOSE'||o.side!==(p.side==='BUY'?'SELL':'BUY')))return blocked('ACTIVE_ORDER_MISMATCH');
 const roots=[...new Set(orders.map(o=>String(o.rootOrderId??'')))];
 if(roots.length!==1||!numericId(roots[0]))return blocked('OCO_ROOT_NOT_UNIQUE');
 if(orders.some(o=>o.orderType!=='OCO'||!['STOP','LIMIT'].includes(o.executionType)))return blocked('OCO_LEGS_INVALID');
 const legs=[...new Set(orders.map(o=>o.executionType))];
 if(legs.length!==2)return blocked('OCO_LEGS_INCOMPLETE');
 if(orders.some(o=>Number(o.size)!==Number(p.size)))return blocked('OCO_SIZE_MISMATCH');
 // No exact position link in activeOrders documented response: cannot certify full coverage.
 return {...blocked('POSITION_TO_OCO_LINK_NOT_BROKER_VERIFIED'),positionCount:1,orderCount:orders.length,rootOrderId:roots[0],legs};
}
