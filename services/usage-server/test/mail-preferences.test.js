'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMailPreferences}=require('../src/mail-preferences');
test('preference store records each account choice',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mail-preferences-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let store=createMailPreferences(dir);
 assert.deepEqual(store.get('alice'),{exists:false,enabled:true,revision:0});
 assert.deepEqual(store.set('alice',false),{exists:true,enabled:false,revision:1});
 assert.deepEqual(store.get('alice'),{exists:true,enabled:false,revision:1});
 assert.equal(store.get('bob').exists,false);
 store.set('alice',true);
 assert.deepEqual(store.get('alice'),{exists:true,enabled:true,revision:2},'each write bumps the revision');
 store=createMailPreferences(dir);
 assert.equal(store.get('alice').enabled,true,'choice survives a restart');
 assert.throws(()=>store.get(''),/invalid user/);
 fs.writeFileSync(path.join(dir,'mail-preferences.json'),'{broken');
 assert.throws(()=>store.get('alice'));
});
test('stored records keep the revision+operation shape older clients validate',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mail-preferences-shape-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=createMailPreferences(dir);
 store.set('alice',false);
 store.set('bob',false,'abcdefghijklmnop');
 const raw=JSON.parse(fs.readFileSync(path.join(dir,'mail-preferences.json'),'utf8'));
 for(const row of Object.values(raw.users)){
  assert.equal(typeof row.enabled,'boolean');
  assert.ok(Number.isSafeInteger(row.revision)&&row.revision>=1);
  assert.equal(typeof row.operation,'string');
 }
 assert.equal(raw.users.alice.operation,'','a push-only write carries an empty operation');
 assert.deepEqual(store.get('bob'),{exists:true,enabled:false,revision:1});
 assert.throws(()=>store.set('bob',false,'short'),'operation format still checked when sent');
});
test('a lost-response retry with the same operation is idempotent',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mail-preferences-retry-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=createMailPreferences(dir);
 store.set('alice',false,'abcdefghijklmnop');
 assert.deepEqual(store.set('alice',false,'abcdefghijklmnop'),{exists:true,enabled:false,revision:1},'replay returns the stored choice without rewriting');
 assert.throws(()=>store.set('alice',true,'abcdefghijklmnop'),'a replay changing the choice collides');
});
test('signed preference API serves old and push-only clients and refuses unsigned or malformed writes',async t=>{
 const crypto=require('node:crypto'),http=require('node:http'),{createUsageServer}=require('../src/server');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mail-api-')),key='12'.repeat(32),app=createUsageServer({host:'127.0.0.1',port:0,dataDir:dir,billingSigningKey:key});
 t.after(async()=>{await app.stop();fs.rmSync(dir,{recursive:true,force:true})});const port=await app.start();
 async function call(method,target,signed=true){const ts=String(Date.now()),nonce=crypto.randomBytes(16).toString('hex'),signature=crypto.createHmac('sha256',Buffer.from(key,'hex')).update(`sub2agent-billing-v1\n${method}\n${target}\n${ts}\n${nonce}`).digest('hex');return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:target,method,headers:signed?{'x-sub2agent-timestamp':ts,'x-sub2agent-nonce':nonce,'x-sub2agent-signature':signature}:{}},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}))});req.on('error',reject);req.end()})}
 const a='/mail-preferences/Alice';
 const off='?enabled=false';
 const legacy='?enabled=false&revision=1&operation=abcdefghijklmnop';
 assert.equal((await call('POST',a+off,false)).status,401,'unsigned writes are refused');
 assert.deepEqual((await call('POST',a+off)).body,{exists:true,enabled:false,revision:1},'push-only clients write a bare enabled');
 assert.equal((await call('POST',a+'?enabled=true')).body.enabled,true);
 assert.deepEqual((await call('POST',a+legacy)).body,{exists:true,enabled:false,revision:3},'old clients keep posting revision+operation');
 assert.deepEqual((await call('POST',a+legacy)).body,{exists:true,enabled:false,revision:3},'their retry replays idempotently');
 assert.equal((await call('POST',a+'?enabled=false&revision=1')).status,400,'partial forms are refused');
 assert.equal((await call('POST',a+'?enabled=maybe')).status,400);
 assert.equal((await call('POST',a+'?enabled=false&revision=1&operation=short')).status,400);
 assert.deepEqual((await call('GET',a)).body,{exists:true,enabled:false,revision:3},'old clients poll the stored choice');
 assert.equal((await call('GET',a+'?x=1')).status,400);
 assert.equal(createMailPreferences(dir).get('alice').enabled,false);
});
