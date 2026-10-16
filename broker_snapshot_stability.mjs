// Read-only two-pass broker snapshot diagnostic. NEVER authorizes a trade or cancellation.
// Two equal snapshots mitigate pagination drift but cannot prove OCO/position linkage.
const isId=v=>/^[1-9][0-9]*$/.test(String(v)) && Number.isSafeInteger(Number(v));
const numeric=v=>typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v)||typeof v==='number'&&Number.isFinite(v);
const canon=o=>Object.keys(o).sort().map(k=>[k,o[k]]);
function normalize(items,idField){
 if(!Array.isArray(items))return null;
 const result=[]; const ids=new Set();
 for(const item of items){
  if(!item||typeof item!=='object'||Array.isArray(item)||!isId(item[idField]))return null;
  const id=String(item[idField]);if(ids.has(id))return null;ids.add(id);
  if(item.symbol!=='USD_JPY'||!['BUY','SELL'].includes(item.side)||!numeric(item.size)||Number(item.size)<=0)return null;
  result.push(canon(item));
 }
 return result.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
export async function checkStableBrokerSnapshot(reader,{expectedPositionId,expectedRootOrderId}={}){
 if(!reader||typeof reader.positionAndOrders!=='function')return {ok:false,reason:'READ_ADAPTER_MISSING',writeAuthorized:false};
 let a,b;
 try{a=await reader.positionAndOrders();b=await reader.positionAndOrders();}
 catch{return {ok:false,reason:'BROKER_READ_FAILED',writeAuthorized:false};}
 for(const snapshot of [a,b]){
  if(snapshot?.complete!==true||snapshot?.brokerConfirmed!==true||snapshot?.atomic!==false||snapshot?.liveWriteAuthorized!==false)
   return {ok:false,reason:'SNAPSHOT_ATTESTATION_FAILED',writeAuthorized:false};
 }
 const aP=normalize(a.positions,'positionId'),bP=normalize(b.positions,'positionId');
 const aO=normalize(a.orders,'orderId'),bO=normalize(b.orders,'orderId');
 if(!aP||!bP||!aO||!bO)return {ok:false,reason:'BROKER_SHAPE_UNVERIFIED',writeAuthorized:false};
 if(JSON.stringify(aP)!==JSON.stringify(bP)||JSON.stringify(aO)!==JSON.stringify(bO))return {ok:false,reason:'BROKER_STATE_CHANGED',writeAuthorized:false};
 const positions=a.positions,orders=a.orders;
 if(expectedPositionId!==undefined){
  if(!isId(expectedPositionId)||positions.filter(p=>String(p.positionId)===String(expectedPositionId)).length!==1)
   return {ok:false,reason:'TARGET_POSITION_NOT_UNIQUE',writeAuthorized:false};
 }
 if(expectedRootOrderId!==undefined){
  if(!isId(expectedRootOrderId)||orders.filter(o=>String(o.rootOrderId)===String(expectedRootOrderId)).length===0)
   return {ok:false,reason:'TARGET_OCO_NOT_PRESENT',writeAuthorized:false};
 }
 return {ok:true,readOnly:true,stableAcrossTwoReads:true,positionCount:positions.length,activeOrderCount:orders.length,
  linkageProven:false,writeAuthorized:false,reason:'TWO_READS_DO_NOT_PROVE_POSITION_OCO_LINKAGE'};
}
