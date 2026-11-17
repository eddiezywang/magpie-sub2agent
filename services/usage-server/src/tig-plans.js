'use strict';
const fs=require('node:fs'),path=require('node:path');
// Reference ceilings, never proof of a particular TIG key's subscription.
const defaults={version:1,plans:{
 zp:{label:'Zhipu team advanced',unit:'GLM_POINTS',windows:[{id:'rolling_5h',limit:35000,duration_ms:18000000},{id:'subscription_week',limit:155000,duration_ms:604800000,anchor_required:true}]},
 hs:{label:'Volcengine AFP',unit:'VOLC_AFP',windows:[{id:'month',limit:200000,anchor_required:true}]},
 tc:{label:'TIG Tencent reference',unit:'TC_POINTS',windows:[{id:'subscription_week',limit:600000000,duration_ms:604800000,anchor_required:true}]}
},warning_thresholds:[0.8,0.95]};
function channel(id){return /(?:-openai)?-(zp|hs|tc)(?:-openai)?$/i.exec(String(id).split('/').pop())?.[1]?.toLowerCase()||null;}
function validate(v){
 if(!v||v.version!==1||!v.plans||!Array.isArray(v.warning_thresholds)||v.warning_thresholds.length!==2||!v.warning_thresholds.every(n=>Number.isFinite(n)&&n>0&&n<=1)||v.warning_thresholds[0]>=v.warning_thresholds[1])throw Error('invalid plan configuration');
 for(const [id,unit] of [['zp','GLM_POINTS'],['hs','VOLC_AFP'],['tc','TC_POINTS']]){const p=v.plans[id];if(!p||p.unit!==unit||typeof p.label!=='string'||!p.label||p.label.length>100||!Array.isArray(p.windows)||!p.windows.length||p.windows.length>4)throw Error('invalid plan');const seen=new Set();for(const w of p.windows){if(!['rolling_5h','subscription_week','month'].includes(w.id)||seen.has(w.id)||!Number.isFinite(w.limit)||w.limit<=0||w.limit>1e15||w.duration_ms!==undefined&&(!Number.isSafeInteger(w.duration_ms)||w.duration_ms<=0)||w.anchor_required!==undefined&&typeof w.anchor_required!=='boolean')throw Error('invalid window');seen.add(w.id);}}
 return JSON.parse(JSON.stringify(v));
}
function createPlanConfig({dataDir}){
 const file=path.join(dataDir,'tig-plan-config.json');let current=fs.existsSync(file)?validate(JSON.parse(fs.readFileSync(file,'utf8'))):validate(defaults);
 function set(next){next=validate(next);const temp=file+'.pending',fd=fs.openSync(temp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);current=next;return get();}
 function get(){return JSON.parse(JSON.stringify(current));}
 return {get,set};
}
// A returned model list is evidence of a route, not proof of the plan, pool,
// validity of credentials or availability. A failed listing stays unknown.
function detect(models){if(!Array.isArray(models))return {state:'unknown',channels:[]};return {state:'inferred',channels:[...new Set(models.map(m=>channel(typeof m==='string'?m:m?.id)).filter(Boolean))].sort()};}
// The v3 ledger is per user/provider, not per upstream key or pool. The
// returned totals are estimates of observed completed-minute usage only.
function usage(events,config,billing,now){
 const at=now.getTime();if(!Number.isFinite(at))throw Error('invalid time');
 const result=Object.fromEntries(['zp','hs','tc'].map(id=>[id,{channel:id,unit:config.plans[id].unit,rolling_5h:0,rolling_7d:0,rolling_30d:0,unpriced:0,models:{}}]));
 for(const event of events){const g=event._summary,t=Date.parse(event.ts);if(!g||!Number.isFinite(t)||t>at||at-t>=30*86400000||!/^(?:sub2agent-tigcodingplan|aiep-coding-plan)/.test(g.provider))continue;const id=channel(g.model);if(!id)continue;const row=result[id],c=billing.charge(g,event.ts);if(!c.priced||c.currency!==row.unit){row.unpriced+=g.attempts;continue;}row.rolling_30d+=c.amount;if(at-t<7*86400000)row.rolling_7d+=c.amount;if(at-t<5*3600000)row.rolling_5h+=c.amount;row.models[g.model]=(row.models[g.model]||0)+c.amount;}
 return {as_of:now.toISOString(),basis:'estimated_observed_user',completion_minute:true,account_attribution:'unavailable',period_anchors:'unknown',channels:result};
}
module.exports={channel,validate,createPlanConfig,detect,usage};
