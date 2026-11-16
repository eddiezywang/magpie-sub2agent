// Real frontend assets with synthetic accounts; no vendor or user data.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium, webkit} = require('playwright');
const assets = path.resolve(process.env.WORKSPACE_ASSETS || 'internal/gui/assets');
const models = [
 {id:'tig/glm-5.3-flash-zp',name:'GLM 5.3 Flash · TIG',providerName:'TIG',icon:'generic'},
 {id:'wb/glm-5.3-flash-maas',name:'GLM 5.3 Flash · WorkBuddy',providerName:'WorkBuddy',icon:'workbuddy-color'},
 {id:'tig/glm-5.3-zp',name:'GLM 5.3 · TIG',providerName:'TIG',icon:'generic'},
 {id:'wb/glm-5.3-maas',name:'GLM 5.3 · WorkBuddy',providerName:'WorkBuddy',icon:'workbuddy-color'},
];
const templates = ['smart','thrifty','steady','plan','fast','even'].map(kind=>({kind,group:{id:kind,name:kind,members:models.map(m=>m.id),routing:'order',...(kind==='smart'?{classifier:models[1].id,rules:[{use:models[0].id,intent:'hard task'},{use:models[1].id,intent:'easy task'}]}:{})}}));
templates.unshift(...['flash-first','flagship-first'].map(kind=>({kind,group:{id:kind,name:kind,members:models.filter(m=>m.id.includes('flash')===(kind==='flash-first')).map(m=>m.id),routing:'rotate',affinity:'session'}})));
(async()=>{
 const output=process.argv[2];await fs.mkdir(output,{recursive:true});
 const results=[];
 for(const engine of ['chromium','webkit']) {
  const browser=await(engine==='webkit'?webkit.launch():chromium.launch({channel:'chrome'}));
  try {for(const [locale,width] of [['zh',1440],['zh',420],['en',1440],['zh-TW',1440],['ja',1440],['de',1440]]) {
   const page=await browser.newPage({viewport:{width,height:1100},reducedMotion:'reduce'});
   const errors=[];page.on('pageerror',e=>{if(!e.message.startsWith('ResizeObserver loop'))errors.push(e.message);});
   let checks=0;
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url()),json=data=>route.fulfill({json:data});
    if(u.pathname==='/boot.js')return route.fulfill({contentType:'text/javascript',body:`window.bootPrefs=${JSON.stringify({lang:locale,theme:'light',web:true,intranet:true,featuresOff:['library','middleware','otel','redact','search','tools','warmups']})};`});
    if(u.pathname==='/wails/runtime.js')return route.fulfill({contentType:'text/javascript',body:'export const Window={};'});
    if(u.pathname==='/api/state')return json({agents:[{id:'codex',name:'Codex',path:'fixture/config.toml',fields:[]}],profiles:[],settings:{lang:locale,theme:'light'}});
    if(u.pathname==='/api/agents/connections'){checks++;return json({checks:{codex:{status:'configured',managed:false,path:'fixture/config.toml'},claude:{status:'disconnected',managed:false,path:'fixture/settings.json'}},agents:[{id:'codex',name:'Codex',path:'fixture/config.toml',fields:[]},{id:'claude',name:'Claude Code',path:'fixture/settings.json',fields:[]}]});}
    if(u.pathname==='/api/plugins')return json({plugins:[]});
    if(u.pathname==='/api/groups')return json({models,pools:[],deciders:[],found:true,groups:[],templates});
    if(u.pathname==='/api/groups/save')return json({models,pools:[],deciders:[],found:true,groups:[],templates});
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
   const cards=page.locator('.rt-gtpl-card');await cards.nth(7).waitFor();
   assert.deepEqual(await cards.evaluateAll(cs=>cs.map(c=>c.dataset.kind)),['flash-first','flagship-first','smart','thrifty','steady','plan','fast','even']);
   if(locale==='zh')assert.deepEqual(await cards.locator('b').allTextContents(),['Flash 优先','旗舰模型优先','难题给强模型，简单的给便宜模型','便宜优先','永不卡住','计划优先','最快优先','均匀分担']);
   assert.equal(await page.title(),'Sub2Agent');
   assert.ok(!/magpie/i.test(await page.locator('body').innerText()));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:path.join(output,`16-routing-${engine}-${locale}-${width}.png`),fullPage:true});
   for(const kind of ['flash-first','flagship-first']) {
    await page.locator(`.rt-gtpl-card[data-kind="${kind}"] .rt-gtpl-edit`).click();
    const editor=page.locator('.rt-gedit');await editor.waitFor();
    assert.equal(await editor.locator('[data-seg="session"][aria-pressed="true"]').count(),1,'editing must preserve session affinity');
    const posted=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/groups/save');
    await editor.locator('.view-foot .primary').click();
    const payload=(await posted).postDataJSON();
    assert.equal(payload.routing,'rotate');assert.equal(payload.affinity,'session');
    assert.deepEqual(payload.members,templates.find(t=>t.kind===kind).group.members);
    await editor.waitFor({state:'detached'});await cards.nth(7).waitFor();
   }
   await page.route('**/api/groups',route=>route.fulfill({json:{models,pools:[],deciders:[],found:true,groups:[],templates:templates.map(tp=>tp.kind==='plan'?{...tp,need:'providers',of:'WorkBuddy 企业',group:{...tp.group,members:[]}}:tp)}}));
   await page.evaluate(()=>{show('routing');show('groups');});
   const unavailable=page.locator('.rt-gtpl-card[data-kind=plan]');
   await unavailable.locator('.why').waitFor();
   if(locale==='zh')await unavailable.getByText('需要两家供应商的模型：目前只有 WorkBuddy 企业',{exact:true}).waitFor();
   assert.equal(await unavailable.locator('button').count(),0,'unavailable plan must have no create/edit controls');
   assert.deepEqual(errors,[]);
   results.push({engine,locale,width,templates:8,branding:true});await page.close();
  }}finally{await browser.close();}
 }
 await fs.writeFile(path.join(output,'16-routing-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1;});
