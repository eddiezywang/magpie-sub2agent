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
