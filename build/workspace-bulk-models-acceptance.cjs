// Native model-list recovery inside the serial bulk queue, isolated APIs only.
const {chromium,webkit}=require('playwright'),{open}=require('./workspace-acceptance.cjs');
const assert=require('node:assert/strict');
(async()=>{for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch(engine==='chromium'?{channel:'chrome'}:{});
 try{for(const action of ['cancel','pick','leave','read-error']){
  const page=await open(browser);
  try{
   await page.evaluate(action=>{
    const original=window.fetch;qa.modelHidden=true;qa.modelWrites=0;
    window.fetch=async(input,init={})=>{
     const url=new URL(String(input),location.href);
     if(url.pathname==='/api/agent-models/claude'){
      if(action==='read-error')return Response.json({error:'Synthetic model read failed'},{status:503});
      if(init.method==='POST'){await new Promise(resolve=>setTimeout(resolve,120));qa.modelHidden=JSON.parse(init.body).hidden.includes('workbuddy/model-a');qa.modelWrites++;return Response.json({});}
      return Response.json({models:[{id:'workbuddy/model-a',name:'Existing model',group:'WorkBuddy',hidden:qa.modelHidden}],ordered:false});
     }
     if(url.pathname==='/api/agents/connect/claude'&&qa.modelHidden){qa.calls.push(url.pathname);return Response.json({error:'No models selected',code:'all_hidden'},{status:400});}
     return original(input,init);
    };
   },action);
   if(action==='pick')await page.evaluate(()=>{workspaceSamples.agents.find(a=>a.id==='claude').hidden=true;state.agents.find(a=>a.id==='claude').hidden=true;renderAgents()});
   await page.locator('#ws-agents summary').click();
   await page.getByRole('button',{name:'一键全部接入（8）'}).click();
   if(action==='read-error'){
    await page.waitForFunction(()=>!window.agentConnectionBusy('claude'));
    assert.match(await page.locator('.agent-bulk-result').innerText(),/已接入 7 · 失败 1 · 跳过 0/);
    assert.equal(await page.evaluate(()=>qa.modelWrites),0);
    assert.equal(await page.evaluate(()=>state.agents.find(a=>a.id==='claude').wired),false);
    assert.deepEqual(page.errors,[]);
    console.log(`${engine}: bulk native model picker read-error passed`);
    continue;
   }
   await page.locator('.am-pop').waitFor();
   assert.equal(await page.evaluate(()=>qa.calls.length),1,'queue waits at native picker');
   if(action==='leave'){
    await page.evaluate(()=>show('providers'));
    await page.waitForFunction(()=>!window.agentConnectionBusy('claude'));
    assert.equal(await page.evaluate(()=>qa.calls.length),1,'leaving stops queued writes');
    await page.locator('.am-pop').waitFor({state:'detached'});
   }else{
    if(action==='pick')await page.locator('.am-pop [role=menuitemcheckbox]').click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!window.agentConnectionBusy('claude'));
    const result=await page.locator('.agent-bulk-result').innerText();
    assert.match(result,action==='pick'?/已接入 8 · 失败 0 · 跳过 0/:/已接入 7 · 失败 0 · 跳过 1/);
    assert.equal(await page.evaluate(()=>qa.modelWrites),action==='pick'?1:0);
    assert.equal(await page.evaluate(()=>state.agents.find(a=>a.id==='claude').wired),action==='pick');
    assert.equal(await page.evaluate(()=>qa.calls.filter(x=>x.endsWith('/claude')).length),action==='pick'?2:1);
    await page.locator('.am-pop').waitFor({state:'detached'});
   }
   assert.deepEqual(page.errors,[]);
  }finally{await page.close()}
  console.log(`${engine}: bulk native model picker ${action} passed`);
 }}finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
