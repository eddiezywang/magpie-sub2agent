'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createBillingPolicy}=require('../src/billing-policy');

test('routing exports typed point coefficients independently from relative scores',()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'routing-billing-'));
 try {
  const policy=createBillingPolicy({dataDir});
  policy.set({revision:'typed-v1',models:[{provider:'wb',model:'glm',currency:'POINTS',coefficient:7,routing_score:2,source:'MaaS',above:[]}]});
  const rule=policy.routing().models[0];
  assert.equal(rule.currency,'POINTS');assert.equal(rule.coefficient,7);assert.equal(rule.score,2);assert.equal(rule.source,'MaaS');
  assert.equal(rule.pool,undefined,'unconfirmed balance pool is not invented');
  assert.throws(()=>policy.set({revision:'bad',models:[{provider:'wb',model:'glm',source:{},above:[]}]}));
 } finally {fs.rmSync(dataDir,{recursive:true,force:true});}
});

test('routing publishes the same TIG schedule as charge and keeps activation across restarts',()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'tig-policy-'));
 try {
  const policy=createBillingPolicy({dataDir});
  const {effective_at,tig_peak}=policy.routing();
  assert.ok(Number.isFinite(Date.parse(effective_at)));
  policy.set(policy.snapshot());
  assert.equal(policy.routing().effective_at,effective_at);
  const reopened=createBillingPolicy({dataDir});
  assert.equal(reopened.routing().effective_at,effective_at);
  const usage={provider:'aiep-coding-plan',model:'glm-5.3-zp',input_tokens:10000,output_tokens:0,
   cache_read_tokens:0,cache_write_5m_tokens:0,cache_write_1h_tokens:0};
  assert.deepEqual(tig_peak,{utc_offset_minutes:480,weekdays:[1,2,3,4,5],start_hour:14,end_hour:18,peak_factor:1,off_peak_factor:0.5});
  assert.equal(policy.charge(usage,'2026-11-16T06:00:00Z').factor,tig_peak.peak_factor);
  assert.equal(policy.charge(usage,'2026-11-16T10:00:00Z').factor,tig_peak.off_peak_factor);
 } finally {fs.rmSync(dataDir,{recursive:true,force:true});}
});
