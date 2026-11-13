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
const version=process.env.SUB2AGENT_PROVIDER_VERSION||'1.0.0';
for(const kind of ['codebuddy','workbuddy','trae','aiep']) {
  await build({entryPoints:[path.join(repo,'plugins/sub2agent/'+kind+'.mjs')],bundle:true,platform:'node',format:'esm',
    outfile:path.join(output,kind,'index.js'),banner:{js:'import {createRequire as __createRequire} from "node:module";const require=__createRequire(import.meta.url);'},
    plugins:[{name:'private-sub2agent',setup(b){b.onResolve({filter:/^sub2agent\//},args=>({path:require.resolve(path.join(source,'src',args.path.slice(10)))}));}}]});
  await fs.writeFile(path.join(output,kind,'package.json'),JSON.stringify({name:'@sub2agent/'+kind,version,type:'module',main:'index.js',
    magpie:{name:kind==='workbuddy'?'WorkBuddy 企业':kind==='trae'?'Trae 企业':kind==='aiep'?'行内 Coding Plan':'CodeBuddy',icon:kind==='aiep'?'generic':kind==='trae'?'trae':kind+'-color',...(kind==='aiep'?{nativeProvider:{id:'aiep-coding-plan',name:'行内 Coding Plan',anthropic:'http://172.21.11.82/public',keysUrl:'https://aiep.weoa.com',website:'http://docs.weoa.com/docs/47kgJOEB8WTo77qV'}}:{})}}));
}
await fs.writeFile(path.join(output,'source.json'),JSON.stringify({repository:'sub2agent',commit:execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim()},null,2));
console.log('Built four offline Sub2Agent provider adapters.');
if(process.env.SUB2AGENT_TEST_BUNDLE) {
 await build({entryPoints:[path.join(repo,'plugins/sub2agent/factory.mjs')],bundle:true,platform:'node',format:'esm',
  outfile:path.join(output,'factory-test.mjs'),banner:{js:'import {createRequire as __createRequire} from "node:module";const require=__createRequire(import.meta.url);'},
  plugins:[{name:'private-sub2agent-test',setup(b){b.onResolve({filter:/^sub2agent\//},args=>({path:require.resolve(path.join(source,'src',args.path.slice(10)))}));}}]});
}
