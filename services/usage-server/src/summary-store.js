 'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {dayStamp} = require('./store');
const SCHEMA = 'sub2agent-usage/3';
const counters = ['attempts','requests','success','failed','canceled','handed_on','input_tokens','output_tokens','cache_read_tokens','cache_write_5m_tokens','cache_write_1h_tokens','reasoning_tokens','zero_token_calls','cache_unknown_calls','cache_unknown_input_tokens','duration_ms_sum','duration_samples','ttft_ms_sum','ttft_samples'];
const dimensions = ['agent','provider','model','model_source','service_tier','rules_revision','context_tier'];
const label = (s,n=256) => typeof s==='string' && s.length<=n && !/[\x00-\x1f\x7f]/.test(s) && !s.includes('://');
const count = n => Number.isSafeInteger(n) && n>=0;
function normalizeSummary(identity, raw) {
 if (!raw || typeof raw.minute!=='string' || !label(identity.install_id) || !identity.install_id || !label(identity.username) || !identity.username || !label(raw.id,128) || !raw.id) return null;
 const at=new Date(raw.minute);
 if (!Number.isFinite(at.getTime()) || at.toISOString().replace('.000Z','Z')!==raw.minute.replace('.000Z','Z') || at.getUTCSeconds()!==0 || at.getUTCMilliseconds()!==0 || !Array.isArray(raw.groups) || !raw.groups.length || raw.groups.length>16) return null;
 const groups=[]; const seen=new Set();
 for (const g of raw.groups) {
  if (!g || !dimensions.every(k=>label(g[k])) || !counters.every(k=>count(g[k]))) return null;
  if (!['served','requested'].includes(g.model_source) || !/^(unclassified|base|above:[1-9][0-9]*)$/.test(g.context_tier)) return null;
  if (g.attempts<1 || g.requests+g.handed_on!==g.attempts || g.success+g.failed+g.canceled!==g.attempts || g.reasoning_tokens>g.output_tokens || g.duration_samples>g.attempts || g.ttft_samples>g.attempts || g.zero_token_calls>g.attempts || g.cache_unknown_calls>g.attempts) return null;
  if (g.cache_unknown_input_tokens>g.input_tokens+g.cache_read_tokens+g.cache_write_5m_tokens+g.cache_write_1h_tokens)return null;
  if (g.context_tier!=='unclassified' && !g.rules_revision) return null;
  const key=JSON.stringify(dimensions.map(k=>g[k])); if(seen.has(key))return null; seen.add(key);
  groups.push(Object.fromEntries([...dimensions,...counters].map(k=>[k,g[k]])));
 }
 return {schema:SCHEMA,install_id:identity.install_id,username:identity.username,id:raw.id,minute:at.toISOString(),groups};
}
function createSummaryStore({dataDir,keepDays=400,now=()=>new Date()}) {
 const dir=path.join(dataDir,'minute-summaries'); fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const rows=new Map(); let poisoned=false;
 const key=r=>JSON.stringify([r.install_id,r.id]);
 const digest=r=>crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
 const fileRE=/^summaries-(\d{8})\.jsonl$/;
 for(const name of fs.readdirSync(dir).filter(n=>fileRE.test(n))) {
  const file=path.join(dir,name); const bytes=fs.readFileSync(file); const end=bytes.lastIndexOf(10)+1;
  if(end<bytes.length) {
   // An unacknowledged torn append is preserved before truncation. Complete
   // corrupt rows fail startup rather than appearing as an empty ledger.
   fs.writeFileSync(file+'.partial-'+Date.now(),bytes.subarray(end),{flag:'wx',mode:0o600});
   const fd=fs.openSync(file,'r+');try{fs.ftruncateSync(fd,end);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }
  for(const line of bytes.subarray(0,end).toString('utf8').split('\n').filter(Boolean)) {
   const raw=JSON.parse(line); const row=normalizeSummary(raw,raw);
   if(!row)throw new Error('Invalid persisted minute summary');
   const old=rows.get(key(row));if(old && digest(old)!==digest(row))throw new Error('Conflicting persisted summary');
   rows.set(key(row),row);
  }
 }
 function append(identity,raw) {
  const row=normalizeSummary(identity,raw); if(!row)return 'rejected';
  const age=now().getTime()-Date.parse(row.minute);
  if(age < -300000 || age>keepDays*86400000)return 'rejected';
  const k=key(row);const existing=rows.get(k);
  if(existing)return digest(existing)===digest(row)?'duplicate':'rejected';
  if(poisoned)return 'failed';
  const file=path.join(dir,'summaries-'+dayStamp(new Date(row.minute))+'.jsonl');
  let fd;try {
   fd=fs.openSync(file,'a',0o600);fs.writeFileSync(fd,JSON.stringify(row)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
   if(process.platform!=='win32'){const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
   rows.set(k,row);return 'accepted';
  }catch{poisoned=true;return 'failed';}finally{if(fd!==undefined)fs.closeSync(fd);}
 }
 function prune() {
  const cutoff=now().getTime()-keepDays*86400000;
  for(const name of fs.readdirSync(dir).filter(n=>fileRE.test(n))) {
   const stamp=fileRE.exec(name)[1];const end=new Date(Number(stamp.slice(0,4)),Number(stamp.slice(4,6))-1,Number(stamp.slice(6,8))+1).getTime();
   if(end<cutoff){fs.unlinkSync(path.join(dir,name));for(const [k,r]of rows)if(dayStamp(new Date(r.minute))===stamp)rows.delete(k);}
  }
 }
 function projected(start,end) {
  const out=[];
  for(const r of rows.values()) {
   const stamp=dayStamp(new Date(r.minute));if(stamp<start||stamp>end)continue;
   for(const g of r.groups)out.push({...g,_summary:g,ts:r.minute,install_id:r.install_id,username:r.username,cache_write_tokens:g.cache_write_5m_tokens+g.cache_write_1h_tokens,cache_unknown_tokens:g.cache_unknown_input_tokens,cache_unknown:g.cache_unknown_calls>0});
  }
  return out;
 }
 return {append,projected,prune,rows:()=>[...rows.values()]};
}
function withSummaries(store,summaries) {
 const users=()=>{
  const all=[...store.users()];
  for(const r of summaries.rows())if(!all.some(u=>u.id===r.install_id&&u.username===r.username))all.push({id:r.install_id,username:r.username,key:'id:'+r.install_id,last_seen:r.minute});
  return all;
 };
 const readRange=(start,end)=>[...store.readRange(start,end),...summaries.projected(start,end)];
 const mine=(event,key)=>key.startsWith('install:')?event.install_id===key.slice(8):key.startsWith('username:')?event.username===key.slice(9):false;
 const eventsForUser=(key,start,end)=>{
  if(!key.startsWith('install:')&&!key.startsWith('username:'))return store.eventsForUser(key,start,end);
  return readRange(start,end).filter(r=>mine(r,key));
 };
 return {...store,users,readRange,eventsForUser,
  resolveUser(needle){
   const all=users();const byId=all.find(u=>u.id===needle);
   if(byId)return {key:'install:'+needle,install_id:needle,username:byId.username};
   const match=all.filter(u=>u.username===needle);
   if(!match.length)return null;
   if(needle==='unknown'&&new Set(match.map(u=>u.id)).size>1)return 'ambiguous';
   return {key:'username:'+needle,install_id:null,username:needle};
  },
  activeDaysForUser(key,start,end){return new Set(eventsForUser(key,start,end).filter(e=>e._summary?e._summary.attempts>0:true).map(e=>dayStamp(new Date(e.ts))));}
 };
}
module.exports={SCHEMA,counters,dimensions,normalizeSummary,createSummaryStore,withSummaries};
