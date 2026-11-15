// Real frontend assets with synthetic accounts; no vendor or user data.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium, webkit} = require('playwright');
const assets = path.resolve('internal/gui/assets');
const models = [
 {id:'plan/capable-flash',name:'Coding Plan Flash',providerName:'Coding Plan',icon:'generic'},
 {id:'enterprise/promotion',name:'企业模型',providerName:'企业账号',icon:'generic'},
];
const templates = ['plan','smart','thrifty','steady'].map(kind=>({kind,group:{id:kind,name:kind,members:models.map(m=>m.id),routing:'order',...(kind==='smart'?{classifier:models[1].id,rules:[{use:models[0].id,intent:'hard task'},{use:models[1].id,intent:'easy task'}]}:{})}}));
(async()=>{
 const output=process.argv[2];await fs.mkdir(output,{recursive:true});
 const results=[];
 for(const engine of ['chromium','webkit']) {
  const browser=await(engine==='webkit'?webkit.launch():chromium.launch({channel:'chrome'}));
  try {for(const width of [1440,420]) {
   const page=await browser.newPage({viewport:{width,height:1100},reducedMotion:'reduce'});
   const errors=[];page.on('pageerror',e=>{if(!e.message.startsWith('ResizeObserver loop'))errors.push(e.message);});
   let checks=0;
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url()),json=data=>route.fulfill({json:data});
    if(u.pathname==='/boot.js')return route.fulfill({contentType:'text/javascript',body:`window.bootPrefs=${JSON.stringify({lang:'zh',theme:'light',web:true,intranet:true,featuresOff:['library','middleware','otel','redact','search','tools','warmups']})};`});
    if(u.pathname==='/wails/runtime.js')return route.fulfill({contentType:'text/javascript',body:'export const Window={};'});
    if(u.pathname==='/api/state')return json({agents:[{id:'codex',name:'Codex',path:'fixture/config.toml',fields:[]}],profiles:[],settings:{lang:'zh',theme:'light'}});
    if(u.pathname==='/api/agents/connections'){checks++;return json({checks:{codex:{status:'configured',managed:false,path:'fixture/config.toml'},claude:{status:'disconnected',managed:false,path:'fixture/settings.json'}},agents:[{id:'codex',name:'Codex',path:'fixture/config.toml',fields:[]},{id:'claude',name:'Claude Code',path:'fixture/settings.json',fields:[]}]});}
    if(u.pathname==='/api/plugins')return json({plugins:[]});
    if(u.pathname==='/api/groups')return json({models,pools:[],deciders:[],found:true,groups:[],templates});
    if(u.pathname==='/api/gateway/trace')return u.searchParams.get('wait')?new Promise(()=>{}):json({mine:true,now:new Date().toISOString(),seq:1,totals:{requests:0,rerouted:0,errors:0},routes:[]});
    if(u.pathname==='/api/gateway/history')return json({cut:false,days:[],routes:[]});
    if(u.pathname==='/api/providers')return json({providers:[],presets:[],excluded:[],gateway:{running:true,url:'http://127.0.0.1:8989'}});
    if(u.pathname.startsWith('/api/'))return json({});
    if(u.host!=='sub2agent.test')return route.abort();
    try {
     let body=await fs.readFile(path.join(assets,u.pathname==='/'?'index.html':u.pathname));
     if(u.pathname==='/')body=body.toString().split('\n').map(line=>line.includes('<span class="logo"')?'<span class="logo" aria-hidden="true"><img src="icons/sub2agent.svg" width="22" height="22" alt=""></span>':line).join('\n').replaceAll('<title>magpie</title>','<title>sub2agent</title>').replaceAll('<span>magpie</span>','<span>sub2agent</span>');
     return route.fulfill({body,contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[path.extname(u.pathname)]||'text/html'});
    }catch{return route.fulfill({status:404,body:''});}
   });
   await page.goto('http://sub2agent.test/?view=groups');
   const cards=page.locator('.rt-gtpl-card');await cards.nth(3).waitFor();
   assert.deepEqual(await cards.evaluateAll(cs=>cs.map(c=>c.dataset.kind)),['plan','smart','thrifty','steady']);
   assert.deepEqual(await cards.locator('b').allTextContents(),['计划优先','均衡优先','便宜优先','稳定优先']);
   assert.equal(await page.title(),'sub2agent');
   assert.ok(!/magpie/i.test(await page.locator('body').innerText()));
   await page.screenshot({path:path.join(output,`16-routing-${engine}-${width}.png`),fullPage:true});
   await page.evaluate(()=>show('agents'));
   await page.locator('.connection-check').nth(1).waitFor({state:'attached',timeout:5000}).catch(async e=>{console.error({checks,errors,body:await page.locator('#view-agents').innerText()});throw e;});
   assert.equal(checks,1);
   assert.ok((await page.locator('#agents [data-id=codex] .connection-check').textContent()).includes('已配置'));
   assert.ok((await page.locator('#agents [data-id=claude] .connection-check').textContent()).includes('未配置'));
   assert.equal(await page.locator('#agents .agent:visible').count(),2);
   await page.screenshot({path:path.join(output,`16-agent-connections-${engine}-${width}.png`),fullPage:true});
   await page.evaluate(()=>show('groups'));await page.evaluate(()=>show('agents'));
   await page.waitForFunction(()=>document.querySelectorAll('.connection-check').length===2);
   assert.equal(checks,2);
   const refreshed=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/agents/connections');
   await page.locator('#sync').click();await refreshed;
   assert.equal(checks,3);assert.deepEqual(errors,[]);
   results.push({engine,width,templates:4,oncePerVisit:true,branding:true});await page.close();
  }}finally{await browser.close();}
 }
 await fs.writeFile(path.join(output,'16-routing-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1;});
