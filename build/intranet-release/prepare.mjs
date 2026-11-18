// Prepare one signed release with Windows and optional macOS app archives.
// The release signing key remains on the administrator's machine.
import {createHash,createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
import path from 'node:path';
const [input, version, keyPath, out, macArm64, macAmd64] = process.argv.slice(2);
if (!input || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || '') || !keyPath || !out)
  throw new Error('usage: node prepare.mjs <windows.exe> <version> <private-key.pem> <output-dir> [mac-arm64.zip] [mac-amd64.zip]');
const inputs=[['magpie-windows-amd64.exe',input],...(macArm64?[['magpie-darwin-arm64.zip',macArm64]]:[]),...(macAmd64?[['magpie-darwin-amd64.zip',macAmd64]]:[])];
const dest=path.resolve(out); try {await access(path.join(dest,version));throw Error('version directory already exists')} catch(e) {if(e.code!=='ENOENT')throw e;}
const privateKey=createPrivateKey(await readFile(keyPath));
const publicKey=createPublicKey(privateKey).export({type:'spki',format:'der'}).subarray(-32).toString('base64');
if(publicKey!=='vZLjKd13KX+3te66w3nBbJRkLGwd81sJNx3UgCrqJ9Y=') throw Error('Release signing key does not match the application public key');
const files=[];for(const [name,file] of inputs){const data=await readFile(file);files.push({name,file,size:data.length,sha256:createHash('sha256').update(data).digest('hex')});}
const sums=files.map(f=>`${f.sha256}  ${f.name}\n`).join('');
const sig=sign(null,Buffer.from(`magpie release ${version}\n${sums}`),privateKey).toString('base64');
const base='http://172.21.0.177:18989/sub2agent/releases/';
const assets=Object.fromEntries(files.map(f=>[f.name,{url:`${base}${version}/${f.name}`,size:f.size,sha256:f.sha256}]));
const release={version,notes:'Sub2Agent 内网版本更新',url:base,assets,signed:{sums,sig}};
await mkdir(path.join(dest,version),{recursive:true});
for(const f of files)await copyFile(f.file,path.join(dest,version,f.name));
// Keep the historical signed asset for installed clients; downloads use the
// branded filename, with the same bytes and SHA-256.
await copyFile(input,path.join(dest,version,'Sub2Agent-windows-amd64.exe'));
await writeFile(path.join(dest,'latest.json'),JSON.stringify(release,null,2)+'\n');
console.log(JSON.stringify({version,files:files.map(({name,size,sha256})=>({name,size,sha256})),output:dest}));
