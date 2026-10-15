// Candidate A hypothetical paper portfolio. No broker calls, no order actions.
import fs from 'node:fs';
import path from 'node:path';
export const CONFIG=Object.freeze({size:1000,tpYen:550,slYen:150,maxHoldMs:14400000,roundTripCostYen:20,dailyStopYen:-1200,maxDailyEntries:20,maxLossStreak:3});
export function dayJst(ms){return new Date(ms+9*3600000).toISOString().slice(0,10)}
export function initialState(){return {schema:1,position:null,trades:[],lastDecisionBar:null,createdAt:new Date().toISOString()}}
export function validState(s){return s&&s.schema===1&&Array.isArray(s.trades)&&s.trades.length<=100000&&('position'in s)&&('lastDecisionBar'in s);}
export function readState(file){if(!fs.existsSync(file))return initialState();const s=JSON.parse(fs.readFileSync(file,'utf8'));if(!validState(s))throw Error('PAPER_STATE_INVALID');return s;}
export function writeState(file,s){if(!validState(s))throw Error('PAPER_STATE_INVALID');fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(s),{mode:0o600,flag:'wx'});fs.renameSync(tmp,file)}finally{try{fs.rmSync(tmp,{force:true})}catch{}}}
// BUY entries mark to BID, SELL entries mark to ASK. Since the feed is BID-only,
// simulate a 2 pip exit cost on either direction; NOT a real executable quote.
export function pnlYen(pos,mark){const direction=pos.side==='BUY'?1:-1;return Math.round((mark-pos.entryPrice)*direction*pos.size-CONFIG.roundTripCostYen)}
export function step(state,{now,barTime,mark,signal,pattern}){
 if(!validState(state))throw Error('PAPER_STATE_INVALID');
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(barTime)||!Number.isFinite(mark)||mark<=0)throw Error('INVALID_MARKET_OBSERVATION');
 if(!['BUY','SELL','WAIT'].includes(signal))throw Error('INVALID_SIGNAL');
 const events=[];
 if(state.lastDecisionBar!==null&&barTime<=state.lastDecisionBar)return {state,events:[{action:'DUPLICATE_OR_OLD_BAR_SKIPPED'}]};
 if(state.position){
  const pos=state.position;const net=pnlYen(pos,mark);const age=now-pos.openedAt;
  const reason=net>=CONFIG.tpYen?'TP':net<=-CONFIG.slYen?'SL':age>=CONFIG.maxHoldMs?'TIME':null;
  if(reason){state.trades.push({...pos,closedAt:now,exitPrice:mark,pnlYen:net,closeReason:reason,hypothetical:true});state.position=null;events.push({action:'PAPER_CLOSE',reason,pnlYen:net});}
  else events.push({action:'PAPER_HOLD',pnlYen:net,holdMinutes:Math.round(age/60000)});
  // No close-and-reopen on same cycle.
  state.lastDecisionBar=barTime;return {state,events};
 }
 const today=dayJst(now);
 const closedToday=state.trades.filter(t=>dayJst(t.closedAt)===today);
 const realized=closedToday.reduce((n,t)=>n+t.pnlYen,0);
 const entriesToday=state.trades.filter(t=>dayJst(t.openedAt)===today).length;
 const last=state.trades.filter(t=>dayJst(t.closedAt)===today).slice(-CONFIG.maxLossStreak);
 const threeLoss=last.length===CONFIG.maxLossStreak&&last.every(t=>t.pnlYen<0);
 if(realized<=CONFIG.dailyStopYen||entriesToday>=CONFIG.maxDailyEntries||threeLoss){events.push({action:'PAPER_ENTRY_BLOCKED',reason:realized<=CONFIG.dailyStopYen?'DAILY_STOP':entriesToday>=CONFIG.maxDailyEntries?'DAILY_MAX':'THREE_LOSSES'});}
 else if(signal==='BUY'||signal==='SELL'){
  state.position={side:signal,pattern:pattern??null,openedAt:now,entryBarTime:barTime,entryPrice:mark,size:CONFIG.size,hypothetical:true};
  events.push({action:'PAPER_OPEN',side:signal,pattern,estimatedEntryPrice:mark});
 }else events.push({action:'PAPER_WAIT'});
 state.lastDecisionBar=barTime;
 return {state,events};
}
