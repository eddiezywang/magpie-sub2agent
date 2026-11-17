'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {channel,detect,createPlanConfig}=require('../src/tig-plans');
test('TIG model list detects multiple channels without treating failed reads as empty',()=>{
 assert.equal(channel('glm-5.3-openai-zp'),'zp');assert.equal(channel('glm-5.3-hs-openai'),'hs');assert.equal(channel('deepseek-v4-tc'),'tc');assert.equal(channel('unrelated-zp-other'),null);
 assert.deepEqual(detect(null),{state:'unknown',channels:[]});assert.deepEqual(detect([{id:'glm-5.3-zp'},{id:'glm-5.3-openai-zp'},'glm-5.3-hs','glm-5.3-tc']),{state:'inferred',channels:['hs','tc','zp']});
});
test('TIG reference limits are validated and persist independently',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tig-plans-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let p=createPlanConfig({dataDir:dir});const value=p.get();assert.equal(value.plans.zp.windows[0].limit,35000);assert.equal(value.plans.zp.windows[1].limit,155000);assert.equal(value.plans.hs.windows[0].limit,200000);assert.equal(value.plans.tc.windows[0].limit,600000000);
 value.plans.hs.windows[0].limit=12345;p.set(value);p=createPlanConfig({dataDir:dir});assert.equal(p.get().plans.hs.windows[0].limit,12345);value.plans.zp.windows[0].limit=-1;assert.throws(()=>p.set(value));assert.equal(p.get().plans.zp.windows[0].limit,35000);
});
