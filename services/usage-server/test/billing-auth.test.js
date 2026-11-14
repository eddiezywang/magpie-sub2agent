'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {billingVerifier}=require('../src/billing-auth');
const key='12'.repeat(32), now=1800000000000;
function request(path='/reports/alice/daily.json?date=2026-11-14',ts=String(now),nonce='aa'.repeat(16)) {
 const method='GET', text=`sub2agent-billing-v1\n${method}\n${path}\n${ts}\n${nonce}`;
 return {method,url:path,headers:{'x-sub2agent-timestamp':ts,'x-sub2agent-nonce':nonce,'x-sub2agent-signature':crypto.createHmac('sha256',Buffer.from(key,'hex')).update(text).digest('hex')}};
}
test('signature binds method and exact target, expires and prevents replay',()=>{
 const verify=billingVerifier(key,()=>now), good=request();
 assert.equal(verify(good),true);assert.equal(verify(good),false,'replay');
 let bad=request(undefined,String(now),'bb'.repeat(16));bad.url='/reports/bob/daily.json?date=2026-11-14';assert.equal(verify(bad),false,'path');
 bad=request(undefined,String(now),'cc'.repeat(16));bad.url+='&x=1';assert.equal(verify(bad),false,'query');
 bad=request(undefined,String(now),'dd'.repeat(16));bad.method='POST';assert.equal(verify(bad),false,'method');
 assert.equal(verify(request(undefined,String(now-300001),'ee'.repeat(16))),false,'old');
 assert.equal(verify(request(undefined,String(now+300001),'ff'.repeat(16))),false,'future');
 assert.equal(verify({method:'GET',url:'/users',headers:{}}),false,'missing');
 assert.equal(billingVerifier('',()=>now)(request()),false,'missing key fails closed');
});
const {createUsageServer}=require('../src/server');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const http=require('node:http');
function get(base,target,headers={}) {return new Promise((resolve,reject)=>{const r=http.get(base+target,{headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});r.on('error',reject)});}
test('HTTP report routes reject unsigned access while ingestion and health stay available',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'billing-auth-'));
 const app=createUsageServer({host:'127.0.0.1',port:0,dataDir:dir,billingSigningKey:key});
 try {
  const port=await app.start(),base='http://127.0.0.1:'+port;
  assert.equal(await get(base,'/healthz'),200);
  assert.equal(await get(base,'/usage/aggregation-rules'),200);
  assert.equal(await get(base,'/users'),401);
  const target='/reports/unknown/daily.json?date=2026-11-14';
  assert.equal(await get(base,target),401);
  const ms=String(Date.now()),nonce=crypto.randomBytes(16).toString('hex');
  const msg=`sub2agent-billing-v1\nGET\n${target}\n${ms}\n${nonce}`;
  const headers={'x-sub2agent-timestamp':ms,'x-sub2agent-nonce':nonce,'x-sub2agent-signature':crypto.createHmac('sha256',Buffer.from(key,'hex')).update(msg).digest('hex')};
  assert.equal(await get(base,target,headers),404,'signed request reaches report handler');
  assert.equal(await get(base,target,headers),401,'replay rejected');
 } finally {await app.stop();fs.rmSync(dir,{recursive:true,force:true})}
});
