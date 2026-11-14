// Prepare a signed release for the read-only intranet server. The signing key
// remains on the administrator's computer and is never copied to the server.
import {createHash,createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
const [input, version, keyPath, out] = process.argv.slice(2);
if (!input || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || '') || !keyPath || !out)
  throw new Error('usage: node build/intranet-release/prepare.mjs <single-file.exe> <version> <private-key.pem> <output-dir>');
const name='magpie-windows-amd64.exe';
const data=await readFile(input), digest=createHash('sha256').update(data).digest('hex');
const privateKey=createPrivateKey(await readFile(keyPath));
const publicKey=createPublicKey(privateKey).export({type:'spki',format:'der'}).subarray(-32).toString('base64');
if(publicKey!=='vZLjKd13KX+3te66w3nBbJRkLGwd81sJNx3UgCrqJ9Y=') throw new Error('Release signing key does not match the application public key');
const sums=`${digest}  ${name}\n`;
const sig=sign(null,Buffer.from(`magpie release ${version}\n${sums}`),privateKey).toString('base64');
const url=`http://172.21.0.177/sub2agent/releases/${version}/${name}`;
const release={version,notes:'Sub2Agent 内网版本更新',url:'http://172.21.0.177/sub2agent/releases/',assets:{[name]:{url,size:data.length,sha256:digest}},signed:{sums,sig}};
const dest=path.resolve(out);await mkdir(path.join(dest,version),{recursive:true});
await copyFile(input,path.join(dest,version,name));
await writeFile(path.join(dest,'latest.json'),JSON.stringify(release,null,2)+'\n');
console.log(JSON.stringify({version,bytes:data.length,sha256:digest,output:dest}));
