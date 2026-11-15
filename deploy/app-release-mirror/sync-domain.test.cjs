'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');const crypto=require('node:crypto');const {spawn}=require('node:child_process');
test('domain sync stores all release assets and checks their hashes',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'domain-sync-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const version='0.6.1', files={'magpie-windows-amd64.exe':Buffer.from('windows fixture'),'magpie-darwin-arm64.zip':Buffer.from('arm fixture'),'magpie-darwin-amd64.zip':Buffer.from('intel fixture')};
 const sha=b=>crypto.createHash('sha256').update(b).digest('hex');const manifest=JSON.stringify({version,assets:Object.fromEntries(Object.entries(files).map(([n,b])=>[n,{sha256:sha(b),size:b.length}]))});
 const server=http.createServer((req,res)=>{if(req.url==='/latest.json'){res.end(manifest);return;}const name=req.url.split('/').pop();if(files[name])res.end(files[name]);else{res.statusCode=404;res.end();}});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>new Promise(ok=>server.close(ok)));
 const root=path.join(dir,'releases'),source=fs.readFileSync(path.join(__dirname,'sync-domain.js'),'utf8').replace("'/app/dist/sub2agent/releases'",JSON.stringify(root)).replace("'http://172.21.0.177:18989/sub2agent/releases'",JSON.stringify(`http://127.0.0.1:${server.address().port}`));
 const script=path.join(dir,'sync.js');fs.writeFileSync(script,source);
 const run=hash=>new Promise(resolve=>{const c=spawn(process.execPath,[script,version,hash]);let out='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>out+=b);c.on('exit',code=>resolve({code,out}));});
 let r=await run(sha(manifest));assert.equal(r.code,0,r.out);assert.match(r.out,/DOMAIN_SYNC_OK/);assert.equal(fs.readFileSync(path.join(root,'latest.json'),'utf8'),manifest);
 for(const [n,b] of Object.entries(files))assert.deepEqual(fs.readFileSync(path.join(root,version,n)),b);
 r=await run(sha(manifest));assert.equal(r.code,0,r.out);
 fs.writeFileSync(path.join(root,version,'magpie-darwin-arm64.zip'),'corrupt');r=await run(sha(manifest));assert.notEqual(r.code,0);assert.match(r.out,/existing version differs/);
});
