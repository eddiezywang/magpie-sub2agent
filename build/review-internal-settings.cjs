// Synthetic settings only. All writes are intercepted; no host configuration changes.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const assets=path.resolve('internal/gui/assets');
const ids=['gateway','login','lightweight','data','log','cli','remote','uninstall'];
(async()=>{
 const output=process.argv[2];await fs.mkdir(output,{recursive:true});const results=[];
 for(const engine of process.env.BROWSER?[process.env.BROWSER]:['chromium','webkit']) {
  const browser=await(engine==='webkit'?webkit.launch():chromium.launch({channel:'chrome'}));
  try {for(const lang of process.env.LANG_CASE?[process.env.LANG_CASE]:['zh','en','zh-TW','ja','de']) for(const width of process.env.WIDTH_CASE?[Number(process.env.WIDTH_CASE)]:[1440,420]) {
   const page=await browser.newPage({viewport:{width,height:1100},reducedMotion:'reduce'});
   const errors=[],posts=[],reads=[];let s={lang,theme:'light',version:'0.1.3913-sub2agent.17',port:8989,gateway:'http://127.0.0.1:8989',dir:'D:/sub2agent/data',log:'D:/sub2agent/data/logs/app.log',portable:true,login:false,lightweight:false,proxy:'fixture-hidden-proxy',builtins:[]};
   page.on('pageerror',e=>{if(!e.message.startsWith('ResizeObserver loop'))errors.push(e.message);});
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url()),json=data=>route.fulfill({json:data}),method=route.request().method();
    if(u.pathname==='/boot.js')return route.fulfill({contentType:'text/javascript',body:`window.bootPrefs=${JSON.stringify({lang,theme:'light',web:false,intranet:true,version:s.version,featuresOff:['library','middleware','otel','redact','search','tools','warmups']})};`});
    if(u.pathname==='/wails/runtime.js')return route.fulfill({contentType:'text/javascript',body:'export const Window={};'});
    if(u.pathname.startsWith('/api/')) {
     if(method==='POST')posts.push({path:u.pathname,body:route.request().postDataJSON()});else reads.push(u.pathname);
     if(u.pathname==='/api/settings') {if(method==='POST')s={...s,...route.request().postDataJSON()};return json(s);}
     if(u.pathname==='/api/settings/login'){s.login=route.request().postDataJSON().on;return json(s);}
     if(u.pathname==='/api/settings/port'){s.port=route.request().postDataJSON().port;s.gateway='http://127.0.0.1:'+s.port;return json({settings:s,port:{moved:[]}});}
     if(u.pathname==='/api/remote')return json({url:method==='POST'?route.request().postDataJSON().url:'',hasKey:false});
     if(u.pathname==='/api/cli')return json({exe:'D:/sub2agent/sub2agent.exe',dir:'D:/sub2agent',command:'D:/sub2agent/sub2agent.com',ours:true,windows:true,shells:[]});
     if(u.pathname==='/api/state')return json({agents:[],profiles:[],settings:s});
     if(u.pathname==='/api/agents/connections')return json({agents:[],checks:{}});
     if(u.pathname==='/api/plugins')return json({plugins:[]});
     if(u.pathname==='/api/providers')return json({providers:[],presets:[],excluded:[],gateway:{running:true,url:s.gateway}});
     if(u.pathname==='/api/gateway/trace')return u.searchParams.get('wait')?new Promise(()=>{}):json({seq:1,totals:{requests:0,rerouted:0,errors:0},routes:[]});
     if(u.pathname==='/api/groups')return json({models:[],groups:[],templates:[]});
     if(u.pathname==='/api/uninstall')throw new Error('Uninstall must never run in this review');
     return json({});
    }
    if(u.host!=='sub2agent.test')return route.abort();
    try {
     let body=await fs.readFile(path.join(assets,u.pathname==='/'?'index.html':u.pathname));
     if(u.pathname==='/')body=body.toString().replaceAll('<title>magpie</title>','<title>sub2agent</title>').replaceAll('<span>magpie</span>','<span>sub2agent</span>');
     return route.fulfill({body,contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[path.extname(u.pathname)]||'text/html'});
    }catch{return route.fulfill({status:404,body:''});}
   });
   await page.goto('http://sub2agent.test/?view=settings&tab=privacy&q=GitHub');
   const root=page.locator('#internalSettings');await root.locator('[data-setting=uninstall]').waitFor();
   assert.deepEqual(await root.locator(':scope > [data-setting]').evaluateAll(ns=>ns.map(n=>n.dataset.setting)),ids);
   assert.equal(await page.locator('#setTabs:visible,#setQ:visible,.nav-sub[data-view=settings]:visible').count(),0);
   assert.ok(!new URL(page.url()).searchParams.has('tab'));
   assert.doesNotMatch(await root.innerText(),/GitHub|Discord|magpie|fixture-hidden-proxy/);
   assert.equal(await root.locator('.remote-key').getAttribute('type'),'password');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
   await page.screenshot({path:path.join(output,`17-settings-${engine}-${lang}-${width}.png`),fullPage:true});
   const login=root.locator('[data-setting=login]');await login.locator('button').last().click();
   await page.waitForFunction(()=>document.querySelector('[data-setting=login] button:last-child')?.classList.contains('on'));
   assert.equal(posts.find(p=>p.path==='/api/settings/login')?.body.on,true);
   await root.locator('[data-setting=lightweight] button').last().click();
   await page.waitForFunction(()=>document.querySelector('[data-setting=lightweight] button:last-child')?.classList.contains('on'));
   assert.equal(s.lightweight,true);assert.equal(s.proxy,'fixture-hidden-proxy');assert.equal(s.lang,lang);
   const port=root.locator('.gateway-port');await port.fill('1023');await root.locator('[data-setting=gateway] .val > button').first().click();
   assert.equal(posts.filter(p=>p.path==='/api/settings/port').length,0);
   await root.locator('.gateway-port').fill('18989');const changed=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/settings/port');await root.locator('[data-setting=gateway] .val > button').first().click();await changed;
   await page.waitForFunction(()=>document.querySelector('.gateway-port')?.value==='18989');
   assert.equal(s.port,18989);
   await root.locator('[data-setting=uninstall] button').click();await page.locator('dialog.action-confirm[open]').waitFor();await page.keyboard.press('Escape');
   const unexpected=reads.filter(p=>/\/fonts|\/settings\/(https|mtls|cors)|\/github|\/sync/.test(p));
   assert.deepEqual(unexpected,[],'omitted settings renderer made a request');
   assert.deepEqual(errors,[]);results.push({engine,lang,width,items:ids.length,flat:true,writesVerified:true});await page.close();
  }}finally{await browser.close();}
 }
 await fs.writeFile(path.join(output,'17-settings-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1;});
