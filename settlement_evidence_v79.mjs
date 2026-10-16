// An acknowledged market-close order is not evidence of settlement.
// Fail closed unless independently fetched records conclusively prove the exact fill.
const posid = x => /^[1-9][0-9]*$/.test(String(x)) && Number.isSafeInteger(Number(x));
const block = reason => Object.freeze({settled:false,allowNewEntry:false,reason});
function snapshot(x){
 if(!x || x.complete!==true || x.brokerConfirmed!==true || !Array.isArray(x.positions) || !Array.isArray(x.orders)) return false;
 const ids=x.positions.map(p=>String(p.positionId));
 return ids.every(posid)&&new Set(ids).size===ids.length;
}
export function verifyExactSettlement({entry,closeOrderId,first,second,executions,executionHistoryComplete=false}={}){
 if(!posid(entry?.positionId)||!posid(entry?.size)||!posid(closeOrderId)||!['BUY','SELL'].includes(entry?.side))return block('INVALID_IDENTITY');
 if(first===second||!snapshot(first)||!snapshot(second))return block('UNVERIFIED_SNAPSHOTS');
 if(!Array.isArray(executions)||executionHistoryComplete!==true)return block('INCOMPLETE_EXECUTION_HISTORY');
 if(first.positions.some(p=>String(p.positionId)===String(entry.positionId))||second.positions.some(p=>String(p.positionId)===String(entry.positionId)))return block('POSITION_STILL_PRESENT');
 if(first.orders.some(o=>String(o.positionId)===String(entry.positionId))||second.orders.some(o=>String(o.positionId)===String(entry.positionId)))return block('RESIDUAL_POSITION_ORDER');
 if(!executions.length)return block('NO_CLOSE_FILLS');
 if(executions.some(e=>String(e.orderId)!==String(closeOrderId)||String(e.positionId)!==String(entry.positionId)||e.symbol!=='USD_JPY'||e.side!==(entry.side==='BUY'?'SELL':'BUY')||!posid(e.size)))return block('FOREIGN_OR_INVALID_EXECUTION');
 const execIds=executions.map(x=>String(x.executionId));
 if(execIds.some(x=>!posid(x))||new Set(execIds).size!==execIds.length)return block('INVALID_OR_DUPLICATE_EXECUTION_ID');
 const sum=executions.reduce((n,e)=>n+Number(e.size),0);
 if(!Number.isSafeInteger(sum)||sum!==Number(entry.size))return block('FILL_QUANTITY_MISMATCH');
 // Read-only evidence allows marking a tracked position settled. It does not
 // authorize another trade; reconciliation and risk gates must run separately.
 return Object.freeze({settled:true,allowNewEntry:false,reason:'EXACT_FILL_AND_TWO_FLAT_SNAPSHOTS_VERIFIED',closeOrderId:String(closeOrderId),filledSize:sum});
}
