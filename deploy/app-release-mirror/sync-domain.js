'use strict';
// The domain Pod keeps its own copies of every signed release asset.
const fs=require('fs'),crypto=require('crypto'),path=require('path');
const {pipeline}=require('stream/promises');const {Transform}=require('stream');
const [version,manifestSha]=process.argv.slice(2);
if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version||'')||!/^[a-f0-9]{64}$/.test(manifestSha||''))throw Error('invalid release');
const root='/app/dist/sub2agent/releases',dir=path.join(root,version),base='http://172.21.0.177:18989/sub2agent/releases';
const allowed=new Set(['magpie-windows-amd64.exe','magpie-darwin-arm64.zip','magpie-darwin-amd64.zip']);
async function digest(file){const h=crypto.createHash('sha256');await pipeline(fs.createReadStream(file),new Transform({transform(b,e,cb){h.update(b);cb();}}));return h.digest('hex');}
(async()=>{
 const r=await fetch(base+'/latest.json',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('feed HTTP '+r.status);
 const text=await r.text();if(crypto.createHash('sha256').update(text).digest('hex')!==manifestSha)throw Error('manifest checksum mismatch');
 const data=JSON.parse(text), entries=Object.entries(data.assets||{});if(data.version!==version||!entries.length||entries.some(([n,a])=>!allowed.has(n)||!/^[a-f0-9]{64}$/.test(a.sha256)))throw Error('invalid manifest');
 fs.mkdirSync(dir,{recursive:true});
 for(const [name,asset] of entries){
  const dest=path.join(dir,name);if(fs.existsSync(dest)){if(await digest(dest)!==asset.sha256)throw Error('existing version differs: '+name);continue;}
  const tmp=path.join(dir,`.${name}-${process.pid}.tmp`);
  try{const resp=await fetch(`${base}/${version}/${name}`,{signal:AbortSignal.timeout(300000)});if(!resp.ok)throw Error('asset HTTP '+resp.status);const h=crypto.createHash('sha256');let size=0;
   await pipeline(resp.body,new Transform({transform(b,e,cb){h.update(b);size+=b.length;cb(null,b);}}),fs.createWriteStream(tmp,{flags:'wx'}));
   if(h.digest('hex')!==asset.sha256||size!==asset.size)throw Error('asset checksum mismatch');fs.renameSync(tmp,dest);
  }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
 }
 const tmp=path.join(root,`.latest-${process.pid}.tmp`);try{fs.writeFileSync(tmp,text,{flag:'wx'});fs.renameSync(tmp,path.join(root,'latest.json'));}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
 console.log('DOMAIN_SYNC_OK',version,manifestSha);
})().catch(e=>{console.error(e.message);process.exitCode=1});
