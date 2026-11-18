// Real provider editor, synthetic provider and managed rules only.
const {chromium,webkit}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const assets=process.env.WORKSPACE_ASSETS;
if(!assets)throw Error('WORKSPACE_ASSETS must name packed intranet assets');
const preset={id:'aiep-coding-plan',name:'TIG Coding Plan',icon:'tig-color',kind:'relay',anthropic:'http://172.21.11.82/public',website:'http://docs.weoa.com/docs/47kgJOEB8WTo77qV'};
const provider={id:'aiep-coding-plan',preset:preset.id,name:preset.name,icon:preset.icon,host:'172.21.11.82',anthropic:preset.anthropic,key:{set:true,masked:'••••demo'},ready:true,agents:[],models:[{id:'glm-5.3-zp',on:true,routingBilling:{state:'active',currency:'GLM_POINTS',credit_rates:{input:6.9,cache_read:1.7,output:24}}}]};
const config={plans:{zp:{unit:'GLM_POINTS',windows:[{id:'rolling_5h',limit:35000},{id:'subscription_week',limit:155000}]},hs:{unit:'VOLC_AFP',windows:[{id:'month',limit:200000}]},tc:{unit:'TC_POINTS',windows:[{id:'subscription_week',limit:600000000}]}}};
const rates=[{model:'glm-5.3-zp',deployment:'zp',currency:'GLM_POINTS',credit_rates:{input:6.9,cache_read:1.7,output:24}},{model:'glm-5.3-flash-hs',deployment:'hs',currency:'VOLC_AFP',coefficient:.5},{model:'glm-5.3-tc',deployment:'tc',currency:'TC_POINTS',coefficient:7}];
(async()=>{for(const [name,type] of [['chromium',chromium],['webkit',webkit]]){
 const b=await type.launch(name==='chromium'?{channel:'chrome'}:{});
 try{const p=await b.newPage({viewport:{width:1440,height:1000}}),errors=[];let saved=true;p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',async route=>{const u=new URL(route.request().url()),json=data=>route.fulfill({json:data});
  if(u.pathname==='/boot.js')return route.fulfill({contentType:'text/javascript',body:`window.bootPrefs=${JSON.stringify({lang:'zh',theme:'light',web:true,intranet:true})};`});
  if(u.pathname==='/wails/runtime.js')return route.fulfill({contentType:'text/javascript',body:'export const Window={};'});
  if(u.pathname==='/api/state')return json({agents:[],profiles:[],settings:{lang:'zh',theme:'light',builtins:[]}});
  if(u.pathname==='/api/providers')return json({providers:saved?[provider]:[],excluded:[],unmoved:[],presets:[preset],gateway:{lanes:[]}});
  if(u.pathname==='/api/accounting/tig-plans')return json({config,rates});
  if(u.pathname.startsWith('/api/'))return json({});
  const file=path.join(assets,u.pathname==='/'?'index.html':u.pathname);
  try{return route.fulfill({body:await fs.readFile(file),contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)]});}catch{return route.fulfill({status:404});}
 });
 await p.goto('http://fixture.test/?view=providers');await p.locator('.row.provider').first().click();
 let editor=p.locator('.editor'), tabs=editor.locator('.tig-plan-tabs');await tabs.waitFor();
 assert.equal(await editor.getByText('大模型运维助手 · 企微安全须知').count(),0);
 assert.equal(await tabs.getByRole('tab').count(),1);assert.match(await tabs.innerText(),/智谱/);assert.doesNotMatch(await tabs.innerText(),/推测|火山|腾讯/);
 await editor.getByText('模型系数',{exact:true}).click();assert.match(await editor.locator('.tig-plan-rates').innerText(),/glm-5.3-zp/);assert.doesNotMatch(await editor.locator('.tig-plan-rates').innerText(),/-hs|-tc/);
 assert.match(await editor.locator('.models').innerText(),/6\.9 \/ 1\.7 \/ 24/);
 await p.screenshot({path:path.resolve('../.build-tools/mail-settings-review/tig-configured-'+name+'.png'),animations:'disabled'});
 saved=false;await p.goto('http://fixture.test/?view=providers');await p.locator('#addSheet button').filter({hasText:'TIG Coding Plan'}).click();editor=p.locator('.editor.new');tabs=editor.locator('.tig-plan-tabs');await tabs.waitFor();
 assert.equal(await editor.getByText('大模型运维助手 · 企微安全须知').count(),1);assert.equal(await tabs.getByRole('tab').count(),3);
 await tabs.getByRole('tab').nth(1).click();await editor.getByText('模型系数',{exact:true}).click();assert.match(await editor.locator('.tig-plan-rates').innerText(),/-hs/);assert.doesNotMatch(await editor.locator('.tig-plan-rates').innerText(),/-zp|-tc/);
 await tabs.getByRole('tab').nth(2).click();await editor.getByText('模型系数',{exact:true}).click();assert.match(await editor.locator('.tig-plan-rates').innerText(),/-tc/);
 await p.screenshot({path:path.resolve('../.build-tools/mail-settings-review/tig-add-'+name+'.png'),animations:'disabled'});
 assert.deepEqual(errors,[]);console.log(name+': configured and pre-key tabs, rates, and safety notice verified');
 }finally{await b.close();}
}})().catch(e=>{console.error(e);process.exitCode=1});
