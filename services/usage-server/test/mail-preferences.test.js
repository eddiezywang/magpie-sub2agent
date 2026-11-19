'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMailPreferences}=require('../src/mail-preferences');
test('persistent preference uses revisions to reject stale offline updates',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mail-preferences-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let store=createMailPreferences(dir),a='abcdefghijklmnop',b='qrstuvwxyzABCDEF';
 assert.deepEqual(store.get('alice'),{exists:false,enabled:true,revision:0});
 assert.deepEqual(store.set('alice',true,0,a),{exists:true,enabled:true,revision:1});
 assert.deepEqual(store.set('alice',true,0,a),{exists:true,enabled:true,revision:1},'retry is idempotent');
 assert.deepEqual(store.set('alice',false,1,b),{exists:true,enabled:false,revision:2});
 assert.deepEqual(store.set('alice',true,0,a),{conflict:true,exists:true,enabled:false,revision:2},'old retry cannot restore enabled');
 store=createMailPreferences(dir);assert.equal(store.get('alice').enabled,false);assert.equal(store.get('bob').exists,false);
 assert.throws(()=>store.set('alice',true,2,b),/collision/);
 fs.writeFileSync(path.join(dir,'mail-preferences.json'),'{broken');assert.throws(()=>store.get('alice'));
});
test('signed preference API persists choices and rejects stale or unsigned writes',async t=>{
 const crypto=require('node:crypto'),http=require('node:http'),{createUsageServer}=require('../src/server');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mail-api-')),key='12'.repeat(32),app=createUsageServer({host:'127.0.0.1',port:0,dataDir:dir,billingSigningKey:key});
 t.after(async()=>{await app.stop();fs.rmSync(dir,{recursive:true,force:true})});const port=await app.start();
 async function call(method,target,signed=true){const ts=String(Date.now()),nonce=crypto.randomBytes(16).toString('hex'),signature=crypto.createHmac('sha256',Buffer.from(key,'hex')).update(`sub2agent-billing-v1\n${method}\n${target}\n${ts}\n${nonce}`).digest('hex');return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:target,method,headers:signed?{'x-sub2agent-timestamp':ts,'x-sub2agent-nonce':nonce,'x-sub2agent-signature':signature}:{}},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}))});req.on('error',reject);req.end()})}
 const a='/mail-preferences/Alice',first='?enabled=true&revision=0&operation=abcdefghijklmnop',off='?enabled=false&revision=1&operation=qrstuvwxyzABCDEF';
 assert.equal((await call('POST',a+first,false)).status,401);
 assert.deepEqual((await call('GET',a)).body,{exists:false,enabled:true,revision:0});
 assert.equal((await call('POST',a+first)).status,200);assert.equal((await call('POST',a+off)).body.enabled,false);
 const stale=await call('POST',a+first);assert.equal(stale.status,409);assert.equal(stale.body.enabled,false);
 assert.equal((await call('GET','/mail-preferences/alice')).body.revision,2);
 assert.equal((await call('POST',a+'?enabled=true&revision=2&operation=abcdefghijklmnop&enabled=false')).status,400);
});
