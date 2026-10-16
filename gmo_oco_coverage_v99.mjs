export function verifyOcoCoverage({entry,first,second,details,submission}={}) {
 const deny=(reason)=>({verified:false,reason});
 if(!entry||!Number.isSafeInteger(Number(entry.positionId))||!Number.isSafeInteger(Number(entry.rootOrderId))||!['BUY','SELL'].includes(entry.side))return deny('INVALID_IDENTITY');
 if(!first?.complete||!second?.complete||!first?.brokerConfirmed||!second?.brokerConfirmed||first===second)return deny('UNTRUSTED_SNAPSHOT');
 const stable=x=>JSON.stringify([...x].sort((a,b)=>String(a.orderId??a.positionId).localeCompare(String(b.orderId??b.positionId))));
 if(stable(first.positions)!==stable(second.positions)||stable(first.orders)!==stable(second.orders))return deny('BROKER_SNAPSHOT_CHANGED');
 const positions=second.positions,orders=second.orders;
 if(positions.length!==1||String(positions[0].positionId)!==String(entry.positionId)||positions[0].side!==entry.side||positions[0].symbol!=='USD_JPY'||Number(positions[0].size)!==1000)return deny('POSITION_MISMATCH');
 const legs=orders.filter(x=>String(x.rootOrderId)===String(entry.rootOrderId));
 if(orders.length!==2||legs.length!==2||!Array.isArray(details)||details.length!==2)return deny('OCO_LEG_COUNT');
 const opposite=entry.side==='BUY'?'SELL':'BUY';
 for(const group of [legs,details]){
  if(group.some(x=>String(x.rootOrderId)!==String(entry.rootOrderId)||x.symbol!=='USD_JPY'||x.side!==opposite||x.orderType!=='OCO'||x.settleType!=='CLOSE'||Number(x.size)!==1000))return deny('OCO_LEG_ATTRIBUTES');
  if(group.map(x=>x.executionType).sort().join(',')!=='LIMIT,STOP')return deny('OCO_MISSING_STOP_OR_LIMIT');
  if(new Set(group.map(x=>String(x.orderId))).size!==2)return deny('OCO_DUPLICATE_LEG');
 }
 if(legs.map(x=>String(x.orderId)).sort().join(',')!==details.map(x=>String(x.orderId)).sort().join(','))return deny('OCO_ACTIVE_HISTORY_DIFFER');
 // Broker's GET orders lacks positionId. Two strict evidence tiers are distinguished.
 // A verified broker positionId on both OCO legs is independent linkage evidence.
 const rows=[...legs,...details];
 const linked=rows.every(x=>String(x.positionId)===String(entry.positionId));
 if(linked)return {verified:true,reason:'BROKER_PROVIDED_POSITION_LINKAGE',evidenceLevel:'INDEPENDENT'};
 // If there is no broker linkage field, use the EXACT durable OCO request, its
 // acknowledged root id, and an exclusive one-position/two-leg readback.
 // This is operational corroboration, NOT broker attestation of mapping.
 const body=submission?.body;
 const settled=body?.settlePosition;
 const proven= submission?.durablyReserved===true && submission?.brokerAccepted===true &&
  String(submission?.ackRootOrderId)===String(entry.rootOrderId) &&
  submission?.requestMethod==='POST' && submission?.requestPath==='/v1/closeOrder' &&
  body?.executionType==='OCO' && body?.symbol==='USD_JPY' &&
  body?.side===opposite && Array.isArray(settled) && settled.length===1 &&
  String(settled[0].positionId)===String(entry.positionId) &&
  Number(settled[0].size)===1000;
 if(!proven)return deny('NO_DURABLE_BROKER_ACK_POSITION_INTENT');
 // Ambiguous extra mapping fields must NEVER be ignored.
 if(rows.some(x=>x.positionId!==undefined && String(x.positionId)!==String(entry.positionId)))
  return deny('CONFLICTING_BROKER_POSITION_LINK');
 return {verified:true,reason:'EXCLUSIVE_OCO_SUBMISSION_CORROBORATED',evidenceLevel:'OPERATIONAL_NOT_INDEPENDENT'};
}
