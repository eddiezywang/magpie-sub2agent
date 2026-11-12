// Keep the private provider implementation in its source checkout. The offline
// runtime is generated locally and shipped in the portable bundle, not Git.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.resolve(process.argv[2]||path.join(repo,'../sub2agent'));
const require=createRequire(path.join(source,'package.json'));
const {build}=require('esbuild');
const output=path.join(repo,'build/sub2agent-runtime');
await fs.mkdir(output,{recursive:true});
for(const kind of ['codebuddy','workbuddy','trae']) {
  await build({entryPoints:[path.join(repo,'plugins/sub2agent/'+kind+'.mjs')],bundle:true,platform:'node',format:'esm',
    outfile:path.join(output,kind,'index.js'),banner:{js:'import {createRequire as __createRequire} from "node:module";const require=__createRequire(import.meta.url);'},
    plugins:[{name:'private-sub2agent',setup(b){b.onResolve({filter:/^sub2agent\//},args=>({path:require.resolve(path.join(source,'src',args.path.slice(10)))}));}}]});
  await fs.writeFile(path.join(output,kind,'package.json'),JSON.stringify({name:'@sub2agent/'+kind,type:'module',main:'index.js',
    magpie:{name:kind==='workbuddy'?'WorkBuddy 企业':kind==='trae'?'Trae 企业':'CodeBuddy',icon:kind==='trae'?'trae':kind+'-color'}}));
}
await fs.writeFile(path.join(output,'source.json'),JSON.stringify({repository:'sub2agent',commit:execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim()},null,2));
console.log('Built three private Sub2Agent provider plugins.');
if(process.env.SUB2AGENT_TEST_BUNDLE) {
 await build({entryPoints:[path.join(repo,'plugins/sub2agent/factory.mjs')],bundle:true,platform:'node',format:'esm',
  outfile:path.join(output,'factory-test.mjs'),banner:{js:'import {createRequire as __createRequire} from "node:module";const require=__createRequire(import.meta.url);'},
  plugins:[{name:'private-sub2agent-test',setup(b){b.onResolve({filter:/^sub2agent\//},args=>({path:require.resolve(path.join(source,'src',args.path.slice(10)))}));}}]});
}
