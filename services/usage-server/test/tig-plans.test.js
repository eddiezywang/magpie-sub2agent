'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {channel,detect,createPlanConfig,usage}=require('../src/tig-plans');
test('TIG model list detects multiple channels without treating failed reads as empty',()=>{
 assert.equal(channel('glm-5.3-openai-zp'),'zp');assert.equal(channel('glm-5.3-hs-openai'),'hs');assert.equal(channel('deepseek-v4-tc'),'tc');assert.equal(channel('unrelated-zp-other'),null);
 assert.deepEqual(detect(null),{state:'unknown',channels:[]});assert.deepEqual(detect([{id:'glm-5.3-zp'},{id:'glm-5.3-openai-zp'},'glm-5.3-hs','glm-5.3-tc']),{state:'inferred',channels:['hs','tc','zp']});
});
test('TIG reference limits are validated and persist independently',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tig-plans-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let p=createPlanConfig({dataDir:dir});const value=p.get();assert.equal(value.plans.zp.windows[0].limit,35000);assert.equal(value.plans.zp.windows[1].limit,155000);assert.equal(value.plans.hs.windows[0].limit,200000);assert.equal(value.plans.tc.windows[0].limit,600000000);
 value.plans.hs.windows[0].limit=12345;p.set(value);p=createPlanConfig({dataDir:dir});assert.equal(p.get().plans.hs.windows[0].limit,12345);value.plans.zp.windows[0].limit=-1;assert.throws(()=>p.set(value));assert.equal(p.get().plans.zp.windows[0].limit,35000);
});

test('rolling observed totals keep channels distinct and unpriced attempts visible',()=>{
 const now=new Date('2026-11-17T10:00:00Z'),config={plans:{zp:{unit:'GLM_POINTS'},hs:{unit:'VOLC_AFP'},tc:{unit:'TC_POINTS'}}};
 const event=(provider,model,ts,amount)=>({ts,_summary:{provider,model,attempts:1,amount}});
 const billing={charge:g=>g.amount===null?{priced:false}:{priced:true,currency:({zp:'GLM_POINTS',hs:'VOLC_AFP',tc:'TC_POINTS'})[channel(g.model)],amount:g.amount}};
 const result=usage([event('sub2agent-tigcodingplan','glm-5.3-zp','2026-11-17T09:00:00Z',10),event('sub2agent-tigcodingplan','glm-5.3-hs','2026-11-16T09:00:00Z',3),event('sub2agent-tigcodingplan','glm-5.3-tc','2026-11-17T09:00:00Z',null),event('other','glm-5.3-zp','2026-11-17T09:00:00Z',99)],config,billing,now);
 assert.equal(result.channels.zp.rolling_5h,10);assert.equal(result.channels.hs.rolling_7d,3);assert.equal(result.channels.hs.rolling_5h,0);assert.equal(result.channels.tc.unpriced,1);assert.equal(result.account_attribution,'unavailable');assert.equal(result.period_anchors,'unknown');
});
