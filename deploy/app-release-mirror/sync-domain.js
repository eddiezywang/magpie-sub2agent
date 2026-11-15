'use strict';
// Run inside the existing wemail Pod after the 0.177 release is published.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const [version, expected] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version||'') || !/^[a-f0-9]{64}$/.test(expected||'')) throw Error('invalid release');
const root='/app/dist/sub2agent/releases', name='magpie-windows-amd64.exe', dir=path.join(root,version), dest=path.join(dir,name);
async function digest(file) { const h=crypto.createHash('sha256'); await pipeline(fs.createReadStream(file),new Transform({transform(b,e,cb){h.update(b);cb();}})); return h.digest('hex'); }
(async()=>{
  const base='http://172.21.0.177:18989/sub2agent/releases';
  const r=await fetch(base+'/latest.json',{signal:AbortSignal.timeout(15000)}); if(!r.ok)throw Error('feed HTTP '+r.status);
  const text=await r.text(), data=JSON.parse(text), asset=data.assets?.[name];
  if(data.version!==version||asset?.sha256!==expected) throw Error('upstream version or hash mismatch');
  fs.mkdirSync(dir,{recursive:true});
  if(fs.existsSync(dest)){ if(await digest(dest)!==expected)throw Error('existing version differs'); }
  else {
    const tmp=path.join(dir,`.asset-${process.pid}.tmp`);
    try {
      const resp=await fetch(`${base}/${version}/${name}`,{signal:AbortSignal.timeout(240000)});if(!resp.ok)throw Error('asset HTTP '+resp.status);
      const h=crypto.createHash('sha256');let size=0;
      await pipeline(resp.body,new Transform({transform(b,e,cb){h.update(b);size+=b.length;cb(null,b);}}),fs.createWriteStream(tmp,{flags:'wx'}));
      if(h.digest('hex')!==expected||size!==asset.size)throw Error('asset checksum mismatch');
      fs.renameSync(tmp,dest);
    } finally { if(fs.existsSync(tmp))fs.unlinkSync(tmp); }
  }
  const tmp=path.join(root,`.latest-${process.pid}.tmp`);
  try {fs.writeFileSync(tmp,text,{flag:'wx'});fs.renameSync(tmp,path.join(root,'latest.json'));}
  finally {if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  console.log('DOMAIN_SYNC_OK',version,expected);
})().catch(e=>{console.error(e.message);process.exitCode=1});
