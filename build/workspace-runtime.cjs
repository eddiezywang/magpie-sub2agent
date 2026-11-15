// Run only against the explicitly isolated local build passed as QA_RUNTIME.
const {chromium}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=process.env.QA_RUNTIME;if(!root)throw Error('QA_RUNTIME is required');
 const key=(await fs.readFile(path.join(root,'qa-web-key.txt'),'utf8')).trim();
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
  for(let i=0;i<7;i++){
   const result=await page.request.post('http://127.0.0.1:19893/v1/chat/completions',{headers:{Authorization:'Bearer magpie-codex','X-Magpie-Session':'workspace-qa-session'},data:{model:'workspace-qa/qa-model',stream:true,messages:[{role:'user',content:'synthetic verification'}]}});
   assert.equal(result.status(),200,(await result.text()).slice(0,160));
  }
  assert.equal(replies,7);
  await page.waitForFunction(async()=>{const d=await (await fetch('/api/gateway/throughput')).json();return d.total.points.some(v=>typeof v==='number'&&v>0)},null,{timeout:15000});
  const measured=await (await page.request.get('http://127.0.0.1:19894/api/gateway/throughput')).json();
  assert(measured.providers.some(p=>p.id==='workspace-qa'));assert(measured.models.length>0);assert(measured.sessions.length>0);
  const retained=['workspace','agents','providers','routing','groups','gateway','sessions','usage','plugins','settings'];
  for(const target of retained){
   await page.evaluate(target=>show(target),target);await page.locator('#view-'+target).waitFor({state:'visible'});
   await page.evaluate(()=>{document.querySelectorAll('*').forEach(e=>{if(e.scrollTop)e.scrollTop=0});document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).forEach(a=>{try{a.finish()}catch{}})});
   await page.screenshot({path:path.join(output,'runtime-'+target+'.png'),fullPage:true,animations:'disabled'});
  }
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'runtime-result.json'),JSON.stringify({retained,errors,throughput:{status:measured.status,points:measured.total.points.length,deliveredReplies:replies,positiveOutput:measured.total.points.some(v=>v>0),providers:measured.providers.length,models:measured.models.length,sessions:measured.sessions.length},tig:{name:tig.name,icon:tig.icon}},null,2));
  console.log('Isolated Windows runtime: 10 pages, no script errors, 7 real loopback streamed replies, positive attributed throughput and TIG preset passed');
 }finally{await browser.close();await new Promise(r=>upstream.close(r));}
})().catch(err=>{console.error(err);process.exitCode=1;});
