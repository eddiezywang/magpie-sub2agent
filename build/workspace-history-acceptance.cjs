// Isolated packed-asset regression: no real accounts or Agent writes.
const {chromium,webkit}=require('playwright');
const {setup}=require('./workspace-guided-acceptance.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const out=process.env.ARTIFACT_DIR||path.resolve('../.build-tools/workspace-history');
async function test(browser,engine){
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.setDefaultTimeout(8000);
 page.on('pageerror',e=>{errors.push(e.message);if(errors.length===1)console.error(engine,e.stack);});await setup(page);
 await page.addInitScript(()=>{
  const base=window.fetch;window.historyQA={extra:0,tracePending:0,traceMax:0,reads:0};
  const now=Date.now(),seat={id:'workbuddy-demo',provider:'workbuddy',name:'WorkBuddy 企业',who:'演示账户',kind:'account',model:'示例模型 A'};
  const route=id=>({id,seq:id,time:new Date(now-id*2000).toISOString(),agent:'opencode',session:'demo-session-'+id,model:id===50?'深链请求 50':id===1?'历史首条 1':'示例模型 A',provider:'workbuddy',order:[seat],tries:[{id:seat.id,model:seat.model,start:new Date(now-id*2000).toISOString(),done:true,status:200,ms:1200}],done:true,status:200,ms:1200,tokens:2048});
  window.fetch=async(input,init={})=>{
   const u=new URL(String(input),location.href);
   if(u.pathname==='/api/gateway/trace'){
    historyQA.reads++;historyQA.tracePending++;historyQA.traceMax=Math.max(historyQA.traceMax,historyQA.tracePending);
    try{if(u.searchParams.has('wait'))await new Promise(r=>setTimeout(r,700));return Response.json({mine:true,now:new Date().toISOString(),seq:700+historyQA.extra,totals:{requests:700+historyQA.extra,rerouted:0,errors:0},routes:Array.from({length:60+historyQA.extra},(_,i)=>route(i+1)).filter(r=>!u.searchParams.has('wait')||r.id>Number(u.searchParams.get('after'))-640)});}finally{historyQA.tracePending--;}
   }
   if(u.pathname==='/api/gateway/history')return Response.json({cut:false,days:[{day:'2026-11-15',requests:700},{day:'2026-11-14',requests:2}],routes:u.searchParams.get('day')==='2026-11-15'?Array.from({length:700},(_,i)=>route(i+1)):u.searchParams.get('day')?[route(801),route(802)]:[]});
   return base(input,init);
  };
 });
 try{
  await page.goto('http://workspace.test/?view=routing&req=50');
  await page.locator('#ws-route-controls [data-ws-focus=strategy]').waitFor();
  await page.locator('#rtMore .rt-req').first().waitFor();
  await page.waitForFunction(()=>document.querySelector('.rt-req[aria-pressed=true]'));
  assert.match(await page.locator('.rt-req[aria-pressed=true]').innerText(),/深链请求 50/,'deep link selects the requested record');
  assert.equal(await page.evaluate(()=>view),'workspace','old routing URL opens workspace');
  assert.equal(await page.locator('#nav [data-view=routing]').count(),0);
  assert.equal(await page.locator('#nav [data-view=groups]').innerText(),'路由策略');
  assert.equal(await page.locator('#rtMore .ws-account-activity').getAttribute('open'),null);
  const layout=await page.evaluate(()=>{const l=document.querySelector('.ws-primary'),r=document.querySelector('.ws-providers'),w=document.querySelector('#view-workspace');return{left:l.scrollHeight>l.clientHeight,outer:w.scrollHeight-w.clientHeight,right:r.getBoundingClientRect().top,overflow:getComputedStyle(l).overflowY};});
  assert.equal(layout.left,true);assert.ok(layout.outer<3);assert.equal(layout.overflow,'auto');
  // Reach the history by scrolling the column, never a nested request scroller.
  await page.evaluate(()=>{const l=workspaceScrollRoot(),h=document.querySelector('#rtMore');l.scrollTop+=h.getBoundingClientRect().top-l.getBoundingClientRect().top;});
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.rt-reqs').evaluate(e=>getComputedStyle(e).overflowY),'visible');
  assert.ok(await page.locator('.rt-req').count()<=60,'live request retention is bounded');
  await page.screenshot({path:path.join(out,engine+'-requests-light.png')});
  const before=await page.evaluate(()=>{const v=workspaceScrollRoot(),b=v.getBoundingClientRect(),e=[...v.querySelectorAll('.rt-req')].find(e=>e.getBoundingClientRect().top>b.top+10);window.qaAnchor=e;return{top:e.getBoundingClientRect().top,scroll:v.scrollTop};});
  await page.evaluate(()=>historyQA.extra=1);await page.waitForTimeout(1400);
  const after=await page.evaluate(()=>({top:qaAnchor.getBoundingClientRect().top,right:document.querySelector('.ws-providers').getBoundingClientRect().top,connected:qaAnchor.isConnected}));
  assert.equal(after.connected,true);assert.ok(Math.abs(after.top-before.top)<4,'new request preserves the visible historical row');assert.ok(Math.abs(after.right-layout.right)<1,'providers stay fixed');
  await page.locator('.rt-day').filter({hasText:'11月15'}).click();
  await page.waitForFunction(()=>document.querySelector('.rt-reqs.win'));
  // The long history can be traversed and remains populated at the bottom.
  await page.evaluate(()=>{workspaceScrollRoot().scrollTop=workspaceScrollRoot().scrollHeight;});await page.waitForTimeout(450);
  assert.ok(await page.locator('.rt-req').count()>0);assert.ok(await page.locator('.rt-req').count()<250);
  await page.locator('.rt-req').filter({hasText:'历史首条 1'}).waitFor();
  await page.screenshot({path:path.join(out,engine+'-history-bottom.png')});
  await page.locator('.ws-account-activity summary').click();assert.equal(await page.locator('.ws-account-activity').getAttribute('open'),'');
  await page.locator('[data-by=session]').click();await page.locator('[data-by=request]').click();
  await page.locator('.rt-day').filter({hasText:'11月14'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.rt-req').length===2);
  await page.locator('.rt-req').first().click();
  await page.locator('#rt .rt-log').waitFor({state:'visible'});
  await page.locator('.rt-day').filter({hasText:'实时'}).click();
  await page.waitForTimeout(300);
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.documentElement.classList.add('dark');workspaceScrollRoot().scrollTop=0;});
  await page.screenshot({path:path.join(out,engine+'-workspace-top.png')});
  await page.evaluate(()=>show('agents'));await page.evaluate(()=>show('workspace'));await page.waitForTimeout(500);
  assert.equal(await page.locator('#view-routing').count(),1);assert.equal(await page.locator('#rtMore').count(),1);assert.equal(await page.evaluate(()=>historyQA.traceMax),1);
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>workspaceScrollRoot().id),'view-workspace');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'narrow viewport has no horizontal overflow');
  await page.mouse.move(200,500);
  await page.mouse.wheel(0,1500);
  await page.waitForTimeout(400);
  assert.ok(await page.evaluate(()=>workspaceScrollRoot().scrollTop)>300,'narrow workspace really scrolls');
  await page.screenshot({path:path.join(out,engine+'-requests-narrow.png')});
  assert.deepEqual(errors,[]);console.log(engine+': routing redirect, policy label, fixed inspector, single scroll, 700-row virtualization, live anchoring, account disclosure, lifecycle and narrow layout passed');
 }catch(e){await page.screenshot({path:path.join(out,engine+'-history-failure.png')});throw e;}finally{await page.close();}
}
(async()=>{await fs.mkdir(out,{recursive:true});for(const [engine,type]of [['chromium',chromium],['webkit',webkit]]){const browser=await type.launch(engine==='chromium'?{channel:'chrome'}:{});try{await test(browser,engine)}finally{await browser.close();}}})().catch(e=>{console.error(e);process.exitCode=1});
