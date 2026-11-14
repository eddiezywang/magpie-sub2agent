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
const version=process.env.SUB2AGENT_PROVIDER_VERSION||'1.0.6';
for(const kind of ['codebuddy','workbuddy','trae','aiep']) {
  await build({entryPoints:[path.join(repo,'plugins/sub2agent/'+kind+'.mjs')],bundle:true,platform:'node',format:'esm',
    outfile:path.join(output,kind,'index.js'),banner:{js:'import {createRequire as __createRequire} from "node:module";const require=__createRequire(import.meta.url);'},
    plugins:[{name:'private-sub2agent',setup(b){b.onResolve({filter:/^sub2agent\//},args=>({path:require.resolve(path.join(source,'src',args.path.slice(10)))}));}}]});
  await fs.writeFile(path.join(output,kind,'package.json'),JSON.stringify({name:'@sub2agent/'+kind,version,type:'module',main:'index.js',
    magpie:{name:kind==='workbuddy'?'WorkBuddy 企业':kind==='trae'?'Trae 企业':kind==='aiep'?'TIG Coding Plan':'CodeBuddy',icon:kind==='aiep'?'tig-color':kind==='trae'?'trae':kind+'-color',...(kind==='aiep'?{nativeProvider:{id:'aiep-coding-plan',name:'TIG Coding Plan',anthropic:'http://172.21.11.82/public',keysUrl:'https://aiep.weoa.com',website:'http://docs.weoa.com/docs/47kgJOEB8WTo77qV'}}:{})}}));
}
// The community packages retired from Magpie's core are bundled from a pinned
// checkout so both the portable baseline and marketplace use identical code.
const community=path.resolve(process.env.MAGPIE_COMMUNITY_SOURCE || path.join(repo,'../.build-tools/community-plugins'));
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:community,encoding:'utf8'}).trim();
if(commit!=='e90d6f011a7320372c5570600e9b267f75b34714') throw new Error('Community source does not match the reviewed commit');
for(const kind of ['antigravity','commandcode','cursor','devin','factory','grok','kiro','mimo','qoder','workbuddy','zcode','zed']) {
 const dir=path.join(community,'packages',kind), target=path.join(output,'community-'+kind);
 const manifest=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'));
 await fs.mkdir(target,{recursive:true});
 await build({entryPoints:[path.join(dir,manifest.main)],bundle:true,platform:'node',format:'esm',outfile:path.join(target,'index.js'),
  banner:{js:'// Magpie community plugins, MIT license, https://github.com/magpie-community/plugins\nimport {createRequire as __createRequire} from "node:module";const require=__createRequire(import.meta.url);'}});
 delete manifest.exports; delete manifest.files; delete manifest.scripts;
 manifest.main='index.js'; manifest.type='module';
 const icons={antigravity:'antigravity-color',commandcode:'commandcode',cursor:'cursor',devin:'devin',factory:'factory',grok:'grok',kiro:'kiro-color',mimo:'mimocode',qoder:'qoder',workbuddy:'workbuddy-color',zcode:'zcode',zed:'zed'};
 manifest.magpie={...(manifest.magpie||{}),name:kind[0].toUpperCase()+kind.slice(1),icon:icons[kind]};
 await fs.writeFile(path.join(target,'package.json'),JSON.stringify(manifest,null,2));
 await fs.copyFile(path.join(community,'LICENSE'),path.join(target,'LICENSE'));
}
await fs.writeFile(path.join(output,'source.json'),JSON.stringify({repository:'sub2agent',commit:execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim()},null,2));
console.log('Built four offline Sub2Agent provider adapters.');
if(process.env.SUB2AGENT_TEST_BUNDLE) {
 await build({entryPoints:[path.join(repo,'plugins/sub2agent/factory.mjs')],bundle:true,platform:'node',format:'esm',
  outfile:path.join(output,'factory-test.mjs'),banner:{js:'import {createRequire as __createRequire} from "node:module";const require=__createRequire(import.meta.url);'},
  plugins:[{name:'private-sub2agent-test',setup(b){b.onResolve({filter:/^sub2agent\//},args=>({path:require.resolve(path.join(source,'src',args.path.slice(10)))}));}}]});
}
