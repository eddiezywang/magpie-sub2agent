// Packed intranet assets, isolated synthetic APIs; never touches Agent configs.
const {chromium,webkit}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const assets=process.env.WORKSPACE_ASSETS||path.join(process.env.TEMP,'workspace-assets/assets');
const output=process.env.ARTIFACT_DIR||path.resolve('../.build-tools/workspace-acceptance');
async function fixture(page){
 let source=await fs.readFile('design-preview/workspace-fixtures.js','utf8');
 source=source.replace('template:kind,','template:kind,templateKind:kind,ref: `group/${kind}`,')
 .replace('agents,checks:{}','agents,checks:Object.fromEntries(agents.map(a=>[a.id,{status:a.wired?"configured":"not-configured",managed:a.wired}]))');
 await page.addInitScript(source);
 await page.addInitScript(()=>{
  const original=window.fetch;window.qa={failed:false,delay:0,calls:[],sets:0,unavailable:false,telemetryCalls:0,telemetryPending:0,telemetryMax:0,telemetryDelay:0,unknown:false,epoch:1};
  window.fetch=async(input,init={})=>{
   const url=new URL(String(input),location.href);
   if(url.pathname==='/api/agents/connections'){
    qa.connectionReads=(qa.connectionReads||0)+1;
    if(qa.connectionReadFails)return new Response(JSON.stringify({error:'synthetic connection read failed'}),{status:503});
    const response=await original(input,init),data=await response.json();
    if(qa.unknownAgent)data.checks[qa.unknownAgent]={status:'unknown'};
    return Response.json(data);
   }
   if(url.pathname==='/api/set'){
    qa.sets++;
    if(qa.rejectPick)return new Response(JSON.stringify({error:'Routing group is no longer available'}),{status:400});
    if(qa.holdPick){qa.holdPick=false;await new Promise(resolve=>qa.releasePick=resolve);}
   }
   if(url.pathname==='/api/provider/save')qa.providerSaves=(qa.providerSaves||0)+1;
   if(url.pathname==='/api/groups'&&qa.holdGroups){
    qa.holdGroups=false;const response=await original(input,init);
    await new Promise(resolve=>qa.releaseGroups=resolve);qa.groupsReleased=true;return response;
   }
   if(url.pathname==='/api/gateway/throughput'){
    qa.telemetryCalls++;qa.telemetryPending++;qa.telemetryMax=Math.max(qa.telemetryMax,qa.telemetryPending);
    try{if(qa.telemetryDelay)await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,qa.telemetryDelay);init.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'))},{once:true})});}finally{qa.telemetryPending--;}
    const points=Array.from({length:180},(_,i)=>Math.round(40+18*Math.sin(i/9)+8*Math.cos(i/4)));
    const total=qa.unknown?{current:null,peak:null,points:Array(180).fill(null)}:{current:qa.epoch===1?42:3,peak:qa.epoch===1?68:5,points};
    return new Response(JSON.stringify(qa.unavailable?{version:1,status:'unavailable'}:{version:1,status:qa.unknown?'partial':'ok',asOf:Math.floor(Date.now()/1000),epoch:qa.epoch,total,providers:[{...total,id:'workbuddy',name:'WorkBuddy 企业'}],models:[{...total,id:'model-a',name:'示例模型 A'}],sessions:[{...total,id:'demo',name:'demo-session',agent:'opencode'}]}));
   }
   if(url.pathname.startsWith('/api/agents/connect/')){
    qa.calls.push(url.pathname);if(qa.delay)await new Promise(r=>setTimeout(r,qa.delay));
    if(qa.failed&&url.pathname.endsWith('/codex'))return new Response(JSON.stringify({error:'演示：配置只读'}),{status:409});
   }
   return original(input,init);
  };
 });
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.pathname==='/boot.js')return route.fulfill({body:'',contentType:'text/javascript'});
  const file=path.join(assets,u.pathname==='/'?'index.html':u.pathname);
  try{await route.fulfill({body:await fs.readFile(file),contentType:{'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)]});}
  catch{await route.fulfill({status:404,body:''});}
 });
}
async function open(browser,width=1440,route='/?view=workspace'){
 const page=await browser.newPage({viewport:{width,height:1000}});page.errors=[];page.on('pageerror',e=>page.errors.push(e.message));await fixture(page);
 await page.goto('http://workspace.test'+route);await page.locator('#view-workspace').waitFor({state:'visible'});await page.locator('#ws-current').getByText('42.0 token/s',{exact:true}).waitFor();return page;
}
async function test(browser,engine){
 const page=await open(browser);
 try{
  assert.equal(await page.locator('#ws-agents').getAttribute('open'),null);
  assert.equal(await page.getByRole('button',{name:'一键全部接入（8）'}).isVisible(),false);
  await page.locator('#ws-agents summary').click();await page.getByRole('button',{name:'一键全部接入（8）'}).waitFor();
  await page.evaluate(()=>qa.failed=true);await page.getByRole('button',{name:'一键全部接入（8）'}).click();
  await page.getByRole('button',{name:'重试失败项'}).waitFor();
  assert.match(await page.locator('.agent-bulk-result').innerText(),/已接入 7 · 失败 1 · 跳过 0/);
  assert.match(await page.locator('.agent-bulk-result').innerText(),/Codex.*配置只读/);
  assert.equal(await page.evaluate(()=>state.agents.filter(a=>a.wired).length),9);
  await page.evaluate(()=>qa.failed=false);await page.getByRole('button',{name:'重试失败项'}).click();
  await page.getByText('已接入 1 · 失败 0 · 跳过 0',{exact:true}).waitFor();
  await page.locator('#ws-route-controls').getByRole('button',{name:'稳定优先',exact:true}).click();
  await page.waitForFunction(()=>state.agents.find(a=>a.id==='opencode').fields[0].value==='group/steady');
  assert.equal(await page.evaluate(()=>state.agents.find(a=>a.id==='pi').fields[0].value),'workbuddy/model-a');
  await page.locator('#ws-throughput summary').click();
  for(const dimension of ['providers','models','sessions']){
   await page.locator(`[data-dimension="${dimension}"]`).click();assert.equal(await page.locator('#ws-throughput-rows svg path').count(),1);
  }
  await page.evaluate(()=>qa.unavailable=true);await page.getByText(/连接中断 · 保留最后数据/).waitFor();
  assert.equal(await page.locator('#ws-current').innerText(),'42.0 token/s');await page.evaluate(()=>qa.unavailable=false);
  await page.locator('#providers>.row.provider').click();await page.locator('#modal').getByRole('button',{name:'取消',exact:true}).click();
  for(const target of ['agents','groups','providers','routing','sessions','gateway','usage','settings','plugins','workspace']){
   const nav=page.locator(`#nav button[data-view="${target}"]`);if(!await nav.count())continue;
   await nav.click();await page.locator('#view-'+target).waitFor({state:'visible'});
  }
  assert.deepEqual(page.errors,[]);
  await page.locator('#ws-agents').evaluate(e=>e.open=false);
  await page.locator('#ws-throughput').evaluate(e=>e.open=true);
  for(const theme of ['light','dark'])for(const width of [1440,1024,390]){
   await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   await page.evaluate(async()=>{document.querySelectorAll('*').forEach(e=>{if(e.scrollTop)e.scrollTop=0});await document.fonts.ready;document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).forEach(a=>{try{a.finish()}catch{}});});
   await page.screenshot({path:path.join(output,`${engine}-${theme}-${width}.png`),fullPage:true,animations:'disabled'});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${engine} ${theme} ${width} horizontal overflow`);
  }
  console.log(`${engine}: bulk partial failure/retry, group attribution, telemetry dimensions/outage, retained navigation, 6 layouts passed`);
 }finally{await page.close();}
 const leaving=await open(browser);
 try{
  await leaving.locator('#ws-agents summary').click();await leaving.getByRole('button',{name:'一键全部接入（8）'}).waitFor();
  await leaving.evaluate(()=>qa.delay=400);await leaving.getByRole('button',{name:'一键全部接入（8）'}).click();
  await leaving.waitForFunction(()=>qa.calls.length===1);await leaving.locator('#nav button[data-view=agents]').click();
  await leaving.waitForFunction(()=>!window.agentConnectionBusy('claude'));
  assert.equal(await leaving.evaluate(()=>qa.calls.length),1);assert.doesNotMatch(await leaving.locator('.agent-bulk-result').innerText(),/接入中/);
  assert.deepEqual(leaving.errors,[]);console.log(`${engine}: leave stops remaining bulk writes and clears progress`);
 }finally{await leaving.close();}
 const missing=await open(browser);
 try{
  await missing.locator('#ws-agents summary').click();
  await missing.evaluate(()=>{state.agents.find(a=>a.id==='codex').cliMissing=true;renderAgents()});
  await missing.getByRole('button',{name:'一键全部接入（7）',exact:true}).click();
  await missing.getByText('已接入 7 · 失败 0 · 跳过 0',{exact:true}).waitFor();
  assert.equal(await missing.evaluate(()=>qa.calls.some(x=>x.endsWith('/codex'))),false);
  assert.equal(await missing.evaluate(()=>state.agents.find(a=>a.id==='codex').wired),false);
  assert.deepEqual(missing.errors,[]);
  console.log(`${engine}: missing CLI excluded from bulk candidates and writes`);
 }finally{await missing.close();}
 const locking=await open(browser);
 try{
  await locking.locator('#ws-agents summary').click();await locking.getByRole('button',{name:'一键全部接入（8）'}).waitFor();
  await locking.evaluate(()=>qa.delay=600);
  await locking.locator('#agents .agent[data-id=claude] .ag-conn').click();
  await locking.waitForFunction(()=>qa.calls.length===1);
  assert.equal(await locking.locator('.agent-bulk button').first().isDisabled(),true);
  await locking.waitForFunction(()=>!window.agentConnectionBusy('claude'));
  await locking.getByRole('button',{name:'一键全部接入（7）'}).click();
  await locking.waitForFunction(()=>qa.calls.length===2);
  await locking.evaluate(()=>{const a=state.agents.find(a=>a.id==='pi');return setPick(a,a.fields[0],'group/steady',{ref:'group/steady',label:'稳定优先'})});
  assert.equal(await locking.evaluate(()=>qa.sets),0);
  await locking.getByText('已接入 7 · 失败 0 · 跳过 0',{exact:true}).waitFor();
  assert.equal(await locking.evaluate(()=>qa.calls.length),8);assert.deepEqual(locking.errors,[]);
  console.log(`${engine}: native row, bulk connection and model saves share write locks`);
 }finally{await locking.close();}
 const connections=await open(browser);
 try{
  await connections.evaluate(async()=>{qa.unknownAgent='codex';await import('/agentconnections.js').then(m=>m.refresh())});
  await connections.locator('#ws-agent-counts').getByText('已接入 2 · 未接入 7 · 未知 1',{exact:true}).waitFor();
  await connections.locator('#ws-agents summary').click();
  await connections.getByRole('button',{name:'一键全部接入（7）',exact:true}).waitFor();
  assert.equal(await connections.locator('#agents .connection-check').count(),0);
  await connections.evaluate(async()=>{qa.connectionReadFails=true;await import('/agentconnections.js').then(m=>m.refresh())});
  await connections.locator('#ws-agent-counts').getByText('已接入 0 · 未接入 0 · 未知 10',{exact:true}).waitFor();
  await connections.getByText('接入 Agent 后可选择路由组',{exact:true}).waitFor();
  assert.equal(await connections.locator('#agents .ag-st.on').count(),0,'unknown state has no connected green indicator');
  assert.equal(await connections.getByRole('button',{name:'一键全部接入（0）',exact:true}).isDisabled(),true);
  const failedReadCount=await connections.evaluate(()=>qa.connectionReads);
  await connections.evaluate(()=>{renderAgents();renderAgents()});
  assert.equal(await connections.evaluate(()=>qa.connectionReads),failedReadCount,'failed read does not loop on redraw');
  await connections.evaluate(()=>{qa.connectionReadFails=false;qa.unknownAgent=null});
  await connections.locator('.connection-recheck').click();
  await connections.locator('#ws-agent-counts').getByText('已接入 2 · 未接入 8',{exact:true}).waitFor();
  await connections.getByRole('button',{name:'一键全部接入（8）',exact:true}).waitFor();
  assert.equal(await connections.locator('.connection-recheck').count(),0);
  assert.deepEqual(connections.errors,[]);
  console.log(`${engine}: unknown rows excluded from counts/bulk, failed snapshots stay unknown and explicit retry recovers`);
 }finally{await connections.close();}
 const drafts=await open(browser);
 try{
  await drafts.locator('#providers>.row.provider').click();
  await drafts.locator('#modal').getByRole('button',{name:'全不选',exact:true}).click();
  assert.equal(await drafts.evaluate(()=>providerDirty()),true);
  // The native editor is modal; exercise the shell's attempted navigation
  // without forcing a pointer through its intentionally inert backdrop.
  await drafts.evaluate(()=>{qa.navigation=show('agents')});
  await drafts.locator('dialog.action-confirm[open] button').first().click();
  await drafts.evaluate(()=>qa.navigation);
  assert.equal(await drafts.evaluate(()=>view),'workspace');
  assert.equal(await drafts.evaluate(()=>providerDirty()),true);
  assert.equal(await drafts.locator('#modal').isVisible(),true);
  assert.equal(await drafts.evaluate(()=>qa.providerSaves||0),0);
  await drafts.evaluate(()=>{qa.navigation=show('agents')});
  await drafts.locator('dialog.action-confirm[open] button').last().click();
  await drafts.waitForFunction(()=>view==='agents'&&editing===null);
  for(const id of ['agents','routing','providers']){
   assert.equal(await drafts.locator('#view-'+id).count(),1);
   assert.equal(await drafts.locator('#view-workspace #view-'+id).count(),0);
  }
  await drafts.locator('#nav button[data-view=workspace]').click();
  await drafts.waitForFunction(()=>view==='workspace'&&document.querySelectorAll('#view-workspace #view-agents,#view-workspace #view-routing,#view-workspace #view-providers').length===3);
  for(const id of ['agents','routing','providers'])assert.equal(await drafts.locator('#view-workspace #view-'+id).count(),1);
  await drafts.locator('#ws-route-controls').getByRole('button',{name:'编辑路由组 ›',exact:true}).click();
  await drafts.waitForFunction(()=>view==='groups');
  await drafts.locator('#nav button[data-view=workspace]').click();
  await drafts.locator('#ws-route-controls').getByRole('button',{name:'稳定优先',exact:true}).waitFor();
  assert.equal(await drafts.evaluate(()=>qa.providerSaves||0),0);
  assert.deepEqual(drafts.errors,[]);
  console.log(`${engine}: provider draft navigation cancellation/discard, unique native hosts and group management return`);
 }finally{await drafts.close();}
 const races=await open(browser);
 try{
  const controls=races.locator('#ws-route-controls');
  await controls.getByRole('button',{name:'稳定优先',exact:true}).waitFor();
  await races.evaluate(()=>qa.rejectPick=true);
  await controls.getByRole('button',{name:'稳定优先',exact:true}).click();
  await races.waitForFunction(()=>qa.sets===1&&!window.agentConnectionBusy('opencode'));
  assert.equal(await races.evaluate(()=>state.agents.find(a=>a.id==='opencode').fields[0].value),'workbuddy/model-a');
  await controls.getByRole('button',{name:'稳定优先',exact:true}).waitFor();
  assert.equal(await controls.getByRole('button',{name:'稳定优先',exact:true}).getAttribute('aria-pressed'),'false');
  await races.evaluate(()=>{qa.rejectPick=false;qa.holdPick=true});
  await controls.getByRole('button',{name:'稳定优先',exact:true}).click();
  await races.waitForFunction(()=>typeof qa.releasePick==='function');
  await races.evaluate(()=>{document.querySelector('#ws-route-controls').dataset.agent='pi';magpie.call('workspace','render')});
  await controls.locator('button.proto').getByText('Pi',{exact:true}).waitFor();
  await races.evaluate(()=>qa.releasePick());
  await races.waitForFunction(()=>!window.agentConnectionBusy('opencode'));
  assert.equal(await races.evaluate(()=>state.agents.find(a=>a.id==='pi').fields[0].value),'workbuddy/model-a');
  await controls.locator('button.proto').getByText('Pi',{exact:true}).waitFor();
  assert.equal(await controls.getByRole('button',{name:'稳定优先',exact:true}).getAttribute('aria-pressed'),'false');
  await races.evaluate(()=>{workspaceSamples.groups.find(g=>g.id==='steady').name='过期路由组';qa.holdGroups=true;magpie.call('workspace','render')});
  await races.waitForFunction(()=>typeof qa.releaseGroups==='function');
  await races.evaluate(()=>{workspaceSamples.groups.find(g=>g.id==='steady').name='当前路由组';magpie.call('workspace','render')});
  await controls.getByRole('button',{name:'当前路由组',exact:true}).waitFor();
  await races.evaluate(()=>qa.releaseGroups());await races.waitForFunction(()=>qa.groupsReleased);
  assert.equal(await controls.getByRole('button',{name:'过期路由组',exact:true}).count(),0);
  assert.equal(await controls.getByRole('button',{name:'当前路由组',exact:true}).count(),1);
  assert.deepEqual(races.errors,[]);
  console.log(`${engine}: refused group restores old pick, late save preserves new target and stale group reads cannot replace controls`);
 }finally{await races.close();}
 const history=await open(browser,1440,'/');
 try{
  await history.evaluate(()=>show('agents'));await history.reload();await history.locator('#view-agents').waitFor({state:'visible'});
  await history.waitForFunction(()=>typeof view!=='undefined'&&view==='agents');
  await history.goto('http://workspace.test/?view=routing');await history.waitForFunction(()=>view==='routing');
  await history.goto('http://workspace.test/?view=workspace');await history.locator('#ws-route-controls').getByRole('button',{name:'稳定优先',exact:true}).waitFor();
  const summary=history.locator('#ws-agents summary');await summary.focus();await history.keyboard.press('Enter');assert(await history.locator('#ws-agents').evaluate(e=>e.open));
  await history.keyboard.press('Enter');assert.equal(await history.locator('#ws-agents').evaluate(e=>e.open),false);
  await history.evaluate(()=>{workspaceSamples.groups.find(g=>g.id==='steady').ready=false;workspaceSamples.groups.push({id:'manual',name:'手工配置组',ref:'group/manual',ready:true});magpie.call('workspace','render')});
  await history.waitForFunction(()=>document.querySelector('#ws-route-controls button[aria-pressed]')?.disabled===false);
  assert(await history.locator('#ws-route-controls').getByRole('button',{name:'稳定优先',exact:true}).isDisabled());
  assert.equal(await history.locator('#ws-route-controls').getByRole('button',{name:'手工配置组',exact:true}).count(),0);
  await history.evaluate(()=>{workspaceSamples.groups.splice(0);magpie.call('workspace','render')});await history.getByText('暂无已配置的预定义路由组',{exact:true}).waitFor();
  await history.evaluate(()=>{state.agents.forEach(a=>a.wired=false);renderAgents()});await history.getByText('接入 Agent 后可选择路由组',{exact:true}).waitFor();
  assert.deepEqual(history.errors,[]);console.log(`${engine}: default/history/deep links, keyboard disclosure, predefined unavailable/empty groups and reactive targets`);
 }finally{await history.close();}
 for(const [lang,title,bulk,calibration] of [
  ['en','Workspace','Connect every Agent','Awaiting calibration'],
  ['zh','工作台','一键全部接入','待校准'],
  ['zh-TW','工作台','一鍵全部接入','待校準'],
  ['ja','ワークスペース','すべての Agent を接続','較正待ち'],
  ['de','Arbeitsbereich','Alle Agents verbinden','Kalibrierung ausstehend'],
 ]){
  const localized=await open(browser,1024,'/?view=workspace&locale='+lang);
  try{
   assert.equal(await localized.locator('#nav button[data-view=workspace] span').innerText(),title);
   assert.equal(await localized.locator('#pageTitle').innerText(),title);
   await localized.locator('#ws-agents summary').click();
   assert.equal(await localized.locator('.agent-bulk button').first().innerText(),bulk+'（8）');
   await localized.locator('#ws-throughput summary').click();
   await localized.evaluate(()=>qa.unknown=true);
   await localized.locator('#ws-current').getByText(calibration,{exact:true}).waitFor();
   assert.equal(await localized.locator('#ws-throughput-rows svg path').count(),1);
   assert.equal(await localized.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.deepEqual(localized.errors,[]);
  }finally{await localized.close();}
 }
 console.log(`${engine}: workspace labels, Agent toolbar and telemetry in all five languages`);
 const telemetry=await open(browser);
 try{
  await telemetry.evaluate(()=>qa.unknown=true);await telemetry.locator('#ws-current').getByText('待校准',{exact:true}).waitFor();
  assert.equal(await telemetry.locator('#ws-total-curve path').getAttribute('d'),'');
  await telemetry.evaluate(()=>{qa.unknown=false;qa.epoch=2});await telemetry.locator('#ws-peak').getByText('5.0 token/s',{exact:true}).waitFor();
  await telemetry.evaluate(()=>qa.telemetryDelay=1800);const start=await telemetry.evaluate(()=>qa.telemetryCalls);
  await telemetry.waitForFunction(n=>qa.telemetryCalls>=n+2,start,{timeout:10000});assert.equal(await telemetry.evaluate(()=>qa.telemetryMax),1);
  await telemetry.waitForFunction(()=>qa.telemetryPending===1);
  await telemetry.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
  await telemetry.waitForFunction(()=>qa.telemetryPending===0);const paused=await telemetry.evaluate(()=>qa.telemetryCalls);
  await telemetry.waitForTimeout(1200);assert.equal(await telemetry.evaluate(()=>qa.telemetryCalls),paused);
  await telemetry.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))});
  await telemetry.waitForFunction(n=>qa.telemetryCalls>n,paused);
  await telemetry.evaluate(()=>show('agents'));await telemetry.waitForFunction(()=>qa.telemetryPending===0);
  const stopped=await telemetry.evaluate(()=>qa.telemetryCalls);await telemetry.waitForTimeout(1200);assert.equal(await telemetry.evaluate(()=>qa.telemetryCalls),stopped);
  assert.deepEqual(telemetry.errors,[]);console.log(`${engine}: unknown gaps, epoch peak reset, single-flight slow reads, background pause/resume and leave cancellation`);
 }finally{await telemetry.close();}
}
(async()=>{await fs.mkdir(output,{recursive:true});for(const [name,type]of [['chromium',chromium],['webkit',webkit]]){const browser=await type.launch(name==='chromium'?{channel:'chrome'}:{});try{await test(browser,name)}finally{await browser.close();}}})().catch(err=>{console.error(err);process.exitCode=1;});
