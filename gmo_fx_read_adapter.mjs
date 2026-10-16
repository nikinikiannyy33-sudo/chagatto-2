// Authenticated GMO FX read-only adapter. No write request exists in this module.
import crypto from 'node:crypto';
const BASE='https://forex-api.coin.z.com';
const allowed=new Set(['/v1/openPositions','/v1/activeOrders','/v1/orders','/v1/executions']);
const id=v=>/^[1-9][0-9]*$/.test(String(v)) && Number.isSafeInteger(Number(v));
const rowsOf=data=>Array.isArray(data?.list)?data.list:Array.isArray(data)?data:null;
export function parseBrokerPage(payload,{requirePaged=true}={}){
 if(payload?.status!==0)return {ok:false,reason:'BROKER_STATUS_NOT_ZERO'};
 const rows=rowsOf(payload.data);
 if(!rows)return {ok:false,reason:'UNEXPECTED_BROKER_RESPONSE'};
 if(requirePaged){
  // Some endpoints return a bare list without pagination metadata. An empty list is
  // not evidence of completeness unless an endpoint guarantees unpaged semantics.
  if(Array.isArray(payload.data))return {ok:false,reason:'PAGINATION_NOT_PROVEN'};
  const t=Number(payload.data.totalCount);
  if(!Number.isSafeInteger(t)||t<rows.length)return {ok:false,reason:'INVALID_TOTAL_COUNT'};
  return {ok:true,rows,totalCount:t};
 }
 return {ok:true,rows};
}
export function createGmoFxReader({apiKey,secret,fetchImpl=globalThis.fetch,clock=Date.now,maxPages=20}={}){
 if(typeof apiKey!=='string'||!apiKey||typeof secret!=='string'||!secret)throw new Error('MISSING_GMO_READ_CREDENTIALS');
 if(typeof fetchImpl!=='function')throw new Error('MISSING_FETCH');
 let previousTimestamp=0;
 async function get(path,params={}){
  if(!allowed.has(path))throw new Error('READ_ENDPOINT_NOT_ALLOWLISTED');
  if(Object.keys(params).some(k=>!['symbol','count','prevId','orderId','rootOrderId'].includes(k)))throw new Error('QUERY_NOT_ALLOWED');
  if(path==='/v1/executions' && (!id(params.orderId)||Object.keys(params).some(k=>k!=='orderId')))throw new Error('EXECUTION_REQUIRES_ORDER_ID');
  if(path==='/v1/orders' && (!id(params.rootOrderId)||Object.keys(params).some(k=>k!=='rootOrderId')))throw new Error('ORDER_REQUIRES_ROOT_ID');
  const query=new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)]));
  const uri=`/private${path}${query.size?'?'+query:''}`;
  // GMO signs the path, excluding the /private prefix and URL query.
  const timestamp=String(Math.max(Number(clock()),previousTimestamp+1));previousTimestamp=Number(timestamp);
  const sign=crypto.createHmac('sha256',secret).update(timestamp+'GET'+path).digest('hex');
  const response=await fetchImpl(BASE+uri,{method:'GET',headers:{'API-KEY':apiKey,'API-TIMESTAMP':timestamp,'API-SIGN':sign},signal:AbortSignal.timeout(9000)});
  if(!response.ok)throw new Error('GMO_READ_HTTP_FAILURE');
  const payload=await response.json();
  if(payload?.status!==0)throw new Error('GMO_READ_API_FAILURE');
  return payload;
 }
 async function allPages(path,symbol='USD_JPY'){
  if(path!=='/v1/openPositions'&&path!=='/v1/activeOrders')throw new Error('UNSUPPORTED_PAGED_ENDPOINT');
  let all=[],prevId=null;
  for(let page=1;page<=maxPages;page++){
   const params={symbol,count:100};
   if(prevId!==null)params.prevId=prevId;
   const payload=await get(path,params);
   // FX API uses prevId cursor and returns data.list without totalCount.
   const parsed=parseBrokerPage(payload,{requirePaged:false});
   if(!parsed.ok)throw new Error(parsed.reason);
   const rows=parsed.rows;
   if(rows.length>100)throw new Error('BROKER_PAGE_TOO_LARGE');
   const key=path==='/v1/openPositions'?'positionId':'orderId';
   if(rows.some(o=>!id(o[key])))throw new Error('INVALID_BROKER_PAGE_ID');
   const ids=rows.map(o=>Number(o[key]));
   if(prevId!==null && ids.some(i=>i>=prevId))throw new Error('BROKER_CURSOR_NOT_DESCENDING');
   if(new Set(ids).size!==ids.length)throw new Error('DUPLICATE_BROKER_PAGE_ID');
   all.push(...rows);
   if(new Set(all.map(o=>String(o[key]))).size!==all.length)throw new Error('DUPLICATE_BROKER_RECORD');
   if(rows.length<100)return {complete:true,brokerConfirmed:true,rows:all,totalCount:all.length};
   prevId=Math.min(...ids);
  }
  throw new Error('BROKER_MAX_PAGES_EXCEEDED');
 }
 async function exactOrder(rootOrderId){
  if(!id(rootOrderId))throw new Error('INVALID_ORDER_ID');
  const payload=await get('/v1/orders',{rootOrderId});
  const parsed=parseBrokerPage(payload,{requirePaged:false});
  if(!parsed.ok||parsed.rows.some(x=>String(x.rootOrderId)!==String(rootOrderId)))throw new Error('BROKER_ORDER_DETAILS_UNVERIFIED');
  return parsed.rows;
 }
 async function exactExecutions(orderId){
  if(!id(orderId))throw new Error('INVALID_EXECUTION_ORDER_ID');
  const payload=await get('/v1/executions',{orderId});
  const parsed=parseBrokerPage(payload,{requirePaged:false});
  if(!parsed.ok||parsed.rows.some(x=>String(x.orderId)!==String(orderId)))throw new Error('BROKER_EXECUTIONS_UNVERIFIED');
  if(new Set(parsed.rows.map(x=>String(x.executionId))).size!==parsed.rows.length||parsed.rows.some(x=>!id(x.executionId)||!id(x.positionId)||!id(x.size)))throw new Error('INVALID_EXECUTIONS');
  return parsed.rows;
 }
 // Complete, order-scoped execution reader: never infer completeness from a bare list.
 // GMO may expose only a capped subset. That response must block settlement proof.
 // FX /executions response normally has data.list with no totalCount.
 // Exact order identity and the *known full order size* can establish a complete
 // fill without metadata. Without expectedSize, still fail closed.
 async function completeExecutions(orderId,{expectedSize='1000'}={}){
  if(!id(orderId)||!id(expectedSize))throw new Error('INVALID_EXECUTION_ORDER_OR_EXPECTED_SIZE');
  const payload=await get('/v1/executions',{orderId});
  const parsed=parseBrokerPage(payload,{requirePaged:false});
  if(!parsed.ok)throw new Error('EXECUTION_HISTORY_UNREADABLE:'+parsed.reason);
  const rows=parsed.rows;
  if(rows.length===0)throw new Error('NO_EXECUTIONS');
  if(rows.some(x=>String(x.orderId)!==String(orderId)))throw new Error('BROKER_EXECUTIONS_UNVERIFIED');
  if(new Set(rows.map(x=>String(x.executionId))).size!==rows.length ||
    rows.some(x=>!id(x.executionId)||!id(x.positionId)||!id(x.size)))throw new Error('INVALID_EXECUTIONS');
  const sizes=rows.map(x=>Number(x.size));
  const fullSize=sizes.reduce((a,b)=>a+b,0);
  if(!Number.isSafeInteger(fullSize)||fullSize!==Number(expectedSize))throw new Error('FULL_EXECUTION_QUANTITY_UNPROVEN');
  if(new Set(rows.map(x=>String(x.positionId))).size!==1)throw new Error('MULTIPLE_EXECUTION_POSITION_IDS');
  // When broker explicitly supplies a count, reject truncation or inconsistency.
  const count=payload?.data?.totalCount;
  if(count!==undefined && (!Number.isSafeInteger(Number(count))||Number(count)!==rows.length))
    throw new Error('EXECUTION_HISTORY_COUNT_MISMATCH');
  return Object.freeze({rows,complete:true,orderId:String(orderId),totalCount:rows.length,
    completeBy:'ORDER_SCOPED_EXACT_FILL_SIZE'});
 }
 async function positionAndOrders(){
  // Two successive snapshots are NOT atomic. Do not grant live write permission
  // based on them; before a close, verify order-specific executions as well.
  const positions=await allPages('/v1/openPositions');
  const orders=await allPages('/v1/activeOrders');
  return {complete:positions.complete&&orders.complete,brokerConfirmed:true,
    positions:positions.rows,orders:orders.rows,atomic:false,liveWriteAuthorized:false};
 }
 return Object.freeze({get,allPages,exactOrder,exactExecutions,completeExecutions,positionAndOrders});
}
