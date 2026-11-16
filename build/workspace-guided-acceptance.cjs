// Packed production frontend, synthetic APIs only; no real account or Agent writes.
const {chromium,webkit}=require('playwright');
const {fixture}=require('./workspace-acceptance.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const out=process.env.ARTIFACT_DIR||path.resolve('../.build-tools/workspace-guidance');
async function setup(page){
 await fixture(page);
 await page.addInitScript(()=>{
  const base=window.fetch;window.guidanceQA={writes:0,fail:false,delay:0};
  const templates=['flash-first','flagship-first'].map((kind,i)=>({kind,group:{id:kind,name:i?'旗舰模型优先':'Flash 优先',templateKind:kind,ref:'group/'+kind,members:['workbuddy/model-a','workbuddy/model-b'],routing:'rotate',affinity:'session',ready:true,accounts:[],match:[],matched:[],fast:[],off:[],patterns:[],memberInfo:[]}}));
  const saved=[];
  window.fetch=async(input,init={})=>{
   const url=new URL(String(input),location.href);
   if(url.pathname==='/api/workspace/strategy'){
    guidanceQA.writes++;if(guidanceQA.delay)await new Promise(r=>setTimeout(r,guidanceQA.delay));
    if(guidanceQA.fail)return Response.json({error:'Agent model changed; refresh and try again'},{status:400});
    const b=JSON.parse(init.body),a=workspaceSamples.agents.find(a=>a.id===b.agent),g=templates.find(t=>t.kind===b.kind).group;
    if(!saved.some(x=>x.id===g.id))saved.push(g);
    a.fields[0].options.push({value:g.ref,ref:g.ref,label:g.name});a.fields[0].value=g.ref;
    return base('/api/state');
   }
   const response=await base(input,init);
   if(url.pathname==='/api/groups'){const data=await response.json();return Response.json({...data,templates:[...templates,...data.templates],groups:[...saved,...data.groups]});}
   return response;
  };
 });
}
async function test(browser,engine){
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await setup(page);
 try{
  await page.goto('http://workspace.test/?view=workspace');
  await page.locator('#ws-route-controls [data-ws-focus=strategy]').waitFor();
  assert.equal(await page.evaluate(()=>guidanceQA.writes),0,'read never changes policy');
  assert.equal(await page.locator('#ws-agents').getAttribute('open'),null);
  assert.equal(await page.locator('#ws-guide .ws-step').count(),3);
  await page.locator('#ws-guide [data-step="1"]').click();
  assert.notEqual(await page.locator('#ws-agents').getAttribute('open'),null);
  await page.locator('#ws-agents summary').click();
  const policy=page.locator('#ws-route-controls [data-ws-focus=strategy]');
  await page.evaluate(()=>guidanceQA.delay=500);
  await page.locator('#ws-next').getByRole('button').click();
  await page.waitForFunction(()=>guidanceQA.writes===1);
  assert.equal(await policy.isDisabled(),true,'save remains pending until server confirms');
  await page.waitForFunction(()=>state.agents.find(a=>a.id==='opencode').fields[0].value==='group/flash-first');
  await policy.getByText('Flash 优先',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>state.agents.find(a=>a.id==='pi').fields[0].value),'workbuddy/model-a','only selected Agent changes');
  await page.evaluate(()=>{guidanceQA.fail=true;guidanceQA.delay=0});
  await policy.click();await page.getByRole('menuitem',{name:'旗舰模型优先',exact:true}).click();
  await page.locator('#ws-route-controls [role=alert]').waitFor();
  assert.equal(await page.evaluate(()=>state.agents.find(a=>a.id==='opencode').fields[0].value),'group/flash-first','failed save preserves previous choice');
  await page.evaluate(()=>guidanceQA.fail=false);
  await policy.click();await page.getByRole('menuitem',{name:'旗舰模型优先',exact:true}).click();
  await policy.getByText('旗舰模型优先',{exact:true}).waitFor();
  await page.locator('#addProvider').click();await page.locator('#addSheet').waitFor({state:'visible'});
  await page.locator('#addSheet').getByText('TIG-Coding-Plan',{exact:true}).waitFor();
  await page.evaluate(()=>closeAddSheet());
  for(const view of ['agents','groups','providers','routing','sessions','gateway','usage','settings','plugins','workspace']){
   await page.evaluate(view=>show(view),view);await page.locator('#view-'+view).waitFor({state:'visible'});
  }
  await policy.getByText('旗舰模型优先',{exact:true}).waitFor();
  await page.evaluate(()=>status(''));await page.locator('#ws-agents summary').focus();
  for(const theme of ['light','dark'])for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   await page.screenshot({path:path.join(out,`${engine}-${theme}-${width}.png`),fullPage:true,animations:'disabled'});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>{providers.providers.forEach(p=>p.off=true);magpie.call('workspace','render')});
  assert.equal(await page.locator('#ws-guide [aria-current=step]').getAttribute('data-step'),'0','disabled providers require configuration first');
  await page.evaluate(()=>{providers.providers.forEach(p=>p.off=false);state.agents.forEach(a=>a.wired=false);renderAgents()});
  await page.waitForFunction(()=>document.querySelector('#ws-guide [aria-current=step]')?.dataset.step==='1');
  assert.equal(await page.locator('#ws-route-controls [data-ws-focus=strategy]').count(),0,'no policy write target until connected');
  assert.deepEqual(errors,[]);console.log(engine+': guided steps, native providers, pending/failure/retry, target isolation, retained pages and responsive themes passed');
 }catch(err){console.error('Browser errors:',errors);await page.screenshot({path:path.join(out,engine+'-failure.png'),fullPage:true});throw err;}finally{await page.close();}
}
(async()=>{await fs.mkdir(out,{recursive:true});for(const [name,type]of [['chromium',chromium],['webkit',webkit]]){const browser=await type.launch(name==='chromium'?{channel:'chrome'}:{});try{await test(browser,name)}finally{await browser.close();}}})().catch(e=>{console.error(e);process.exitCode=1;});

