 'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const initial={revision:'internal-2026-11-13-1',models:[
 {provider:'sub2agent-workbuddy*',model:'hy4free',currency:'POINTS',coefficient:0,above:[],promotion:true},
 ...Object.entries({'glm-5.3-flash-maas':1,'hy3-maas':1,'deepseek-v4-flash-maas':2,'deepseek-v4.1-flash-maas':2,'minimax-m3-maas':2.5,'glm-5.3-maas':7,'deepseek-v4-pro-maas':8.5}).map(([model,coefficient])=>({provider:'sub2agent-workbuddy*',model,currency:'POINTS',coefficient,above:[]})),
 {provider:'sub2agent-tigcodingplan*',model:'glm-5.3-flash',currency:'PLAN_TOKENS',coefficient:1,above:[],weekday_afternoon_factor:0.5},
 {provider:'aiep-coding-plan*',model:'glm-5.3-flash',currency:'PLAN_TOKENS',coefficient:1,above:[],weekday_afternoon_factor:0.5},
 {provider:'sub2agent-tigcodingplan*',model:'glm-*',currency:'PLAN_TOKENS',coefficient:1,above:[],weekday_afternoon_factor:0.5},
 {provider:'aiep-coding-plan*',model:'glm-*',currency:'PLAN_TOKENS',coefficient:1,above:[],weekday_afternoon_factor:0.5},
]};
function canonical(model){return String(model).split('/').pop().toLowerCase().replace(/-maas-[a-z0-9_.-]+$/,'-maas').replace(/-zp(?:-openai)?$/,'');}
function providerMatches(pattern,id){return pattern.endsWith('*')?id.startsWith(pattern.slice(0,-1)):id===pattern;}
function validate(raw){
 if(!raw||typeof raw.revision!=='string'||!raw.revision||raw.revision.length>128||!Array.isArray(raw.models)||raw.models.length>4096)throw new Error('Invalid billing policy');
 const seen=new Set();
 for(const r of raw.models){
  if(!r||typeof r.provider!=='string'||!r.provider||!r.model||typeof r.model!=='string'||!Array.isArray(r.above)||r.above.length>32)throw new Error('Invalid policy model');
  const k=JSON.stringify([r.provider,r.model,r.service_tier||'']);if(seen.has(k))throw new Error('Duplicate policy model');seen.add(k);
  if(r.above.some((n,i)=>!Number.isSafeInteger(n)||n<=0||(i>0&&n<=r.above[i-1])))throw new Error('Invalid context boundaries');
  if(r.coefficient!==undefined&&(!Number.isFinite(r.coefficient)||r.coefficient<0))throw new Error('Invalid coefficient');
  if(r.currency&&!['POINTS','PLAN_TOKENS','USD'].includes(r.currency))throw new Error('Invalid currency');
  if(r.valid_until&&!Number.isFinite(Date.parse(r.valid_until)))throw new Error('Invalid promotion end');
  if(r.weekday_afternoon_factor!==undefined&&(!Number.isFinite(r.weekday_afternoon_factor)||r.weekday_afternoon_factor<0))throw new Error('Invalid afternoon factor');
  if(r.usd_rates && !['input','output','cache_read','cache_write_5m','cache_write_1h'].every(k=>Number.isFinite(r.usd_rates[k])&&r.usd_rates[k]>=0))throw new Error('Invalid USD rates');
 }
 return JSON.parse(JSON.stringify(raw));
}
function createBillingPolicy({dataDir}){
 const dir=path.join(dataDir,'billing-policies');fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const file=path.join(dataDir,'billing-policy.json');
 const revisionFile=revision=>path.join(dir,crypto.createHash('sha256').update(revision).digest('hex')+'.json');
 const atomic=(f,obj)=>{const t=f+'.pending';const fd=fs.openSync(t,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(obj)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(t,f);};
 let current=fs.existsSync(file)?validate(JSON.parse(fs.readFileSync(file,'utf8'))):validate(initial);
 function set(next){
  next=validate(next);const archived=revisionFile(next.revision);
  if(fs.existsSync(archived)&&JSON.stringify(JSON.parse(fs.readFileSync(archived,'utf8')))!==JSON.stringify(next))throw new Error('Revision is immutable; use a new revision');
  atomic(archived,next);atomic(file,next);current=next;return snapshot();
 }
 function snapshot(){return JSON.parse(JSON.stringify(current));}
 if(!fs.existsSync(file))set(current);else if(!fs.existsSync(revisionFile(current.revision)))atomic(revisionFile(current.revision),current);
 function rules(){return {revision:current.revision,models:current.models.map(r=>({provider:r.provider,model:r.model,service_tier:r.service_tier||'',above:r.above}))};}
 function match(policy,provider,model,tier){return policy.models.find(r=>providerMatches(r.provider,provider)&&(r.model.endsWith('*')?canonical(model).startsWith(canonical(r.model.slice(0,-1))):canonical(r.model)===canonical(model))&&(r.service_tier||'')===(tier||''));}
 function charge(g,minute){
  const at=new Date(minute);const r=match(current,g.provider,g.model,g.service_tier);
  if(!r||r.valid_until&&at>=new Date(r.valid_until))return {priced:false,reason:'no_active_price'};
  if(g.context_tier==='unclassified'||!g.rules_revision)return {priced:false,reason:'unclassified'};
  const oldFile=revisionFile(g.rules_revision);if(!fs.existsSync(oldFile))return {priced:false,reason:'unknown_rules_revision'};
  const old=match(JSON.parse(fs.readFileSync(oldFile,'utf8')),g.provider,g.model,g.service_tier);
  if(!old||JSON.stringify(old.above)!==JSON.stringify(r.above))return {priced:false,reason:'context_rules_changed'};
  if(g.context_tier!=='base' && !r.above.includes(Number(g.context_tier.slice(6))))return {priced:false,reason:'unknown_context_tier'};
  let factor=1;
  // Billing rule only: Monday-Friday 14:00 <= China time <18:00. It
  // neither changes remaining quota nor invents a vendor reset response.
  const china=new Date(at.getTime()+8*3600000);const weekday=china.getUTCDay(),hour=china.getUTCHours();
  if(r.weekday_afternoon_factor!==undefined&&weekday>=1&&weekday<=5&&hour>=14&&hour<18)factor=r.weekday_afternoon_factor;
  const total=g.input_tokens+g.output_tokens+g.cache_read_tokens+g.cache_write_5m_tokens+g.cache_write_1h_tokens;
  const selected=g.context_tier==='base'?r.usd_rates:r.tiers?.[g.context_tier];
  if(r.currency==='USD'&&selected){const amount=(g.input_tokens*selected.input+g.output_tokens*selected.output+g.cache_read_tokens*selected.cache_read+g.cache_write_5m_tokens*selected.cache_write_5m+g.cache_write_1h_tokens*selected.cache_write_1h)/1e6*factor;return {priced:true,currency:'USD',amount,revision:current.revision,factor};}
  if(r.coefficient!==undefined)return {priced:true,currency:r.currency,amount:total*r.coefficient*factor,revision:current.revision,factor};
  return {priced:false,reason:'missing_rate'};
 }
 return {snapshot,set,rules,charge};
}
module.exports={createBillingPolicy,canonical,providerMatches,validate};
