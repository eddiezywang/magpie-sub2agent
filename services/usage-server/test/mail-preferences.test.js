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
