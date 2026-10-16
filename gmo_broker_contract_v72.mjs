// Enforce official GMO Forex API response fields; reject invented linkage fields.
// These inspections never authorize live orders or infer OCO position coverage.
const integerId = x => /^(?:[1-9][0-9]*)$/.test(String(x)) && Number.isSafeInteger(Number(x));
const positiveSize = x => typeof x === 'string' && /^[1-9][0-9]*$/.test(x) && Number.isSafeInteger(Number(x));
const fail = reason => Object.freeze({ok:false,reason,liveWriteAuthorized:false});
export function inspectOfficialOcoOrders({rootOrderId,rawOrders}={}){
 if(!integerId(rootOrderId) || !Array.isArray(rawOrders))return fail('INVALID_INPUT');
 if(rawOrders.length!==2)return fail('OCO_REQUIRES_EXACTLY_TWO_LEGS');
 if(rawOrders.some(o=>!integerId(o.orderId)||!integerId(o.rootOrderId)||String(o.rootOrderId)!==String(rootOrderId)))return fail('ORDER_IDENTIFIERS_UNVERIFIED');
 if(new Set(rawOrders.map(o=>String(o.orderId))).size!==2)return fail('DUPLICATE_LEG');
 if(rawOrders.some(o=>o.orderType!=='OCO'||o.settleType!=='CLOSE'||o.symbol!=='USD_JPY'||!positiveSize(o.size)||!['BUY','SELL'].includes(o.side)))return fail('ORDER_ATTRIBUTES_UNVERIFIED');
 if(rawOrders.some(o=>!['WAITING','ORDERED'].includes(o.status)))return fail('OCO_NOT_ACTIVE');
 const types=rawOrders.map(o=>o.executionType).sort().join(',');
 if(types!=='LIMIT,STOP')return fail('OCO_REQUIRES_LIMIT_AND_STOP');
 if(rawOrders[0].size!==rawOrders[1].size||rawOrders[0].side!==rawOrders[1].side)return fail('OCO_LEG_SIZE_OR_SIDE_MISMATCH');
 if(rawOrders.some(o=>typeof o.price!=='string'||!/^\d+\.\d+$/.test(o.price)||Number(o.price)<=0))return fail('OCO_PRICE_UNVERIFIED');
 // Even matching exchange-issued OCO orders do not establish WHICH position they settle.
 return Object.freeze({ok:true,rootOrderId:String(rootOrderId),legOrderIds:rawOrders.map(o=>String(o.orderId)),quantity:rawOrders[0].size,side:rawOrders[0].side,ocoLegsPresent:true,positionCoverageProven:false,liveWriteAuthorized:false});
}
export function inspectExactBrokerPosition({positionId,side,size,rawPositions}={}){
 if(!integerId(positionId)||!positiveSize(String(size))||!['BUY','SELL'].includes(side)||!Array.isArray(rawPositions))return fail('INVALID_INPUT');
 if(rawPositions.length!==1)return fail('ACCOUNT_NOT_EXCLUSIVE');
 const [p]=rawPositions;
 if(!integerId(p.positionId)||String(p.positionId)!==String(positionId)||p.symbol!=='USD_JPY'||p.side!==side||String(p.size)!==String(size))return fail('POSITION_NOT_EXACT');
 return Object.freeze({ok:true,positionId:String(positionId),liveWriteAuthorized:false});
}
export function inspectCancelOrderHistory({rootOrderId,rawOrders}={}){
 if(!integerId(rootOrderId)||!Array.isArray(rawOrders)||rawOrders.length!==2)return fail('INVALID_OR_PARTIAL_HISTORY');
 if(rawOrders.some(o=>String(o.rootOrderId)!==String(rootOrderId)||!integerId(o.orderId)))return fail('UNRELATED_ORDER');
 if(new Set(rawOrders.map(o=>String(o.orderId))).size!==2)return fail('DUPLICATE_LEG');
 if(rawOrders.some(o=>o.status!=='CANCELED'))return fail('CANCEL_NOT_FINAL');
 // This proves cancellation of both known order legs, not absence of other orders.
 return Object.freeze({ok:true,knownLegsCanceled:true,accountWideOpenOrdersProvenAbsent:false,liveWriteAuthorized:false});
}
