// Run only against the explicitly isolated local build passed as QA_RUNTIME.
const {chromium}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=process.env.QA_RUNTIME;if(!root)throw Error('QA_RUNTIME is required');
 const key=(await fs.readFile(path.join(root,'qa-web-key.txt'),'utf8')).trim();
 for(const [dir,file,content]of [['.codex','config.toml','model = "qa-model"\n'],['.claude','settings.json','{"model":"qa-model"}']]){
  await fs.mkdir(path.join(root,'qa-home',dir),{recursive:true});
  const target=path.join(root,'qa-home',dir,file);try{await fs.access(target)}catch{await fs.writeFile(target,content)}
 }
 const output=path.resolve('../.build-tools/workspace-acceptance');await fs.mkdir(output,{recursive:true});
 const http=require('node:http');let replies=0;
 const upstream=http.createServer((req,res)=>{req.resume();req.on('end',()=>{if(req.url==='/v1/chat/completions')replies++;res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({id:'qa',object:'chat.completion.chunk',model:'qa-model',choices:[{index:0,delta:{content:'Synthetic output for isolated workspace throughput verification. '.repeat(80)},finish_reason:null}]})+'\n\n');res.end('data: '+JSON.stringify({id:'qa',object:'chat.completion.chunk',model:'qa-model',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:800,total_tokens:812}})+'\n\ndata: [DONE]\n\n');});});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:19894/?k='+encodeURIComponent(key));
  await page.waitForFunction(()=>typeof state!=='undefined'&&state?.agents);
  await page.evaluate(()=>history.replaceState(null,'','/?view=workspace'));
  const response=await page.request.get('http://127.0.0.1:19894/api/gateway/throughput');assert.equal(response.status(),200);
  const data=await response.json();assert.equal(data.version,1);assert.equal(data.total.points.length,180);
  const providerData=await (await page.request.get('http://127.0.0.1:19894/api/providers')).json();
  const tig=providerData.presets.find(p=>p.id==='aiep-coding-plan');assert.equal(tig.name,'TIG-Coding-Plan');assert.equal(tig.icon,'tig-color');
  const save=await page.evaluate(async port=>{const data=await api('providers');const exists=data.providers.some(p=>p.id==='workspace-qa');const r=await api('provider/save',{id:'workspace-qa',name:'隔离测试供应商',chat:`http://127.0.0.1:${port}/v1`,key:'synthetic-only',models:['qa-model'],...(exists?{from:'workspace-qa'}:{new:true})});return !r.error},upstream.address().port);assert.equal(save,true);
  await page.evaluate(async()=>{state=await api('agents/rescan',{});renderAgents();await import('/agentconnections.js').then(m=>m.refresh());});
  await page.evaluate(()=>show('workspace'));await page.locator('#ws-agents').evaluate(e=>e.open=true);
  const connect=page.locator('.agent-bulk button').first();await connect.waitFor();
  if(await connect.isEnabled()){await connect.click();await page.waitForFunction(()=>!window.agentConnectionBusy('codex'))}
  const connected=await page.evaluate(()=>state.agents.filter(a=>['claude','codex'].includes(a.id)).map(a=>({id:a.id,wired:a.wired,model:a.fields.find(f=>f.key==='model')?.value})));
  assert.equal(connected.length,2);assert(connected.every(a=>a.wired&&(a.model==='workspace-qa/qa-model'||a.model.startsWith('group/'))),JSON.stringify(connected));
  await page.screenshot({path:path.join(output,'runtime-workspace-agents.png'),fullPage:true,animations:'disabled'});
  for(let i=0;i<7;i++){
   // Warm-up samples stay in an earlier second, so unknown conversion cannot
   // mask the calibrated deliveries sharing a bucket in a fast local run.
   if(i===3)await new Promise(r=>setTimeout(r,1100));
   const result=await page.request.post('http://127.0.0.1:19893/v1/chat/completions',{headers:{Authorization:'Bearer magpie-codex','X-Magpie-Session':'workspace-qa-session'},data:{model:'workspace-qa/qa-model',stream:true,messages:[{role:'user',content:'synthetic verification'}]}});
   assert.equal(result.status(),200,(await result.text()).slice(0,160));
  }
  assert.equal(replies,7);
  // The web process reads the gateway owner; while it starts or reloads it
  // can correctly return unavailable without a total. Wait for the actual
  // calibrated snapshot instead of throwing on that supported state.
  let measured;
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
   const response=await page.request.get('http://127.0.0.1:19894/api/gateway/throughput');
   if(response.ok()){
    const data=await response.json();
    if(data.total?.points?.some(v=>typeof v==='number'&&v>0)){measured=data;break;}
   }
   await page.waitForTimeout(250);
  }
  assert(measured,'gateway must return a calibrated snapshot within 15 seconds');
  assert(measured.total.points.some(v=>typeof v==='number'&&v>0),'measured snapshot must retain calibrated output');
  assert(measured.providers.some(p=>p.id==='workspace-qa'));assert(measured.models.length>0);assert(measured.sessions.length>0);
  // The workspace has an inner scroller; top screenshots omit these rows.
  const throughput=page.locator('#ws-throughput');await throughput.evaluate(e=>e.open=true);
  for(const dimension of ['providers','models','sessions']){
   await page.locator(`[data-dimension="${dimension}"]`).click();
   await throughput.scrollIntoViewIfNeeded();
   await page.locator('#ws-throughput-rows .ws-throughput-row').first().waitFor();
   await page.screenshot({path:path.join(output,'runtime-throughput-'+dimension+'.png'),animations:'disabled'});
  }
  const routing=await page.evaluate(async port=>{
   for(const id of ['workspace-qa','workspace-qa-second']){const data=await api('providers');const exists=data.providers.some(p=>p.id===id);await api('provider/save',{id,name:id==='workspace-qa'?'隔离测试供应商':'隔离备用供应商',chat:`http://127.0.0.1:${port}/v1`,key:id==='workspace-qa'?'synthetic-only':'synthetic-second',models:['qa-model','gpt-6.1-sol'],...(exists?{from:id}:{new:true})})}
   let data=await api('groups');if(!data.groups.some(g=>g.templateKind==='steady'))data=await api('groups/template',{kind:'steady',name:'稳定优先'});
   await loadProviders();return data.groups.find(g=>g.templateKind==='steady');
  },upstream.address().port);
  assert(routing?.ready,'native group template must be available');
  await page.locator('#ws-route-controls').getByRole('button',{name:routing.name,exact:true}).click();
  await page.waitForFunction(ref=>state.agents.find(a=>a.id==='claude').fields.find(f=>f.key==='model').value===ref,routing.ref);
  await page.waitForFunction(()=>!window.agentConnectionBusy('claude'));
  assert.equal(await page.evaluate(()=>state.agents.find(a=>a.id==='codex').fields.find(f=>f.key==='model').value),'workspace-qa/qa-model');
  await page.reload();await page.waitForFunction(ref=>state?.agents?.find(a=>a.id==='claude')?.fields.find(f=>f.key==='model')?.value===ref,routing.ref);
  const grouped=await page.request.post('http://127.0.0.1:19893/v1/chat/completions',{headers:{Authorization:'Bearer magpie-claude','X-Magpie-Session':'workspace-group-session'},data:{model:routing.ref,stream:true,messages:[{role:'user',content:'synthetic group verification'}]}});
  assert.equal(grouped.status(),200);assert((await grouped.text()).includes('Synthetic output'));
  try{
   await page.evaluate(async id=>{const r=await api('groups/switch',{id,on:false});if(r.error)throw Error(r.error);magpie.call('workspace','render')},routing.id);
   await page.getByText('路由组已停用',{exact:true}).waitFor();
   assert(await page.locator('#ws-route-controls').getByRole('button',{name:routing.name,exact:true}).isDisabled());
   await page.locator('#ws-route-controls').scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(output,'runtime-group-disabled.png'),animations:'disabled'});
  }finally{
   await page.evaluate(async id=>{const r=await api('groups/switch',{id,on:true});if(r.error)throw Error(r.error);magpie.call('workspace','render')},routing.id);
   await page.waitForFunction(ref=>{const choice=document.querySelector(`[data-ws-focus="${ref}"]`);return choice&&!choice.disabled},routing.ref);
  }
  const retained=['workspace','agents','providers','routing','groups','gateway','sessions','usage','plugins','settings'];
  for(const target of retained){
   await page.evaluate(target=>show(target),target);await page.locator('#view-'+target).waitFor({state:'visible'});
   await page.evaluate(()=>{document.querySelectorAll('*').forEach(e=>{if(e.scrollTop)e.scrollTop=0});document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).forEach(a=>{try{a.finish()}catch{}})});
   await page.screenshot({path:path.join(output,'runtime-'+target+'.png'),fullPage:true,animations:'disabled'});
  }
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'runtime-result.json'),JSON.stringify({retained,errors,connected,routing:{ref:routing.ref,persisted:true,requestSucceeded:true,otherAgentUnchanged:true},throughput:{status:measured.status,points:measured.total.points.length,deliveredReplies:replies,positiveOutput:measured.total.points.some(v=>v>0),providers:measured.providers.length,models:measured.models.length,sessions:measured.sessions.length},tig:{name:tig.name,icon:tig.icon}},null,2));
  console.log('Isolated Windows runtime: 10 pages, no script errors, 7 real loopback streamed replies, positive attributed throughput and TIG preset passed');
 }finally{await browser.close();await new Promise(r=>upstream.close(r));}
})().catch(err=>{console.error(err);process.exitCode=1;});
