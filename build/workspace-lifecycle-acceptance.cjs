// Observe the actual Agent host observer across repeated native navigation.
const {chromium,webkit}=require('playwright'),{open}=require('./workspace-acceptance.cjs');
const assert=require('node:assert/strict');
(async()=>{for(const [engine,type]of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch(engine==='chromium'?{channel:'chrome'}:{});
 try{
  const instrumented={newPage:async options=>{
   const page=await browser.newPage(options);
   await page.addInitScript(()=>{
    const Native=window.MutationObserver,live=new Set();
    window.observerAudit={live,callbacks:0};
    window.MutationObserver=class extends Native{
     constructor(callback){super((...args)=>{if(live.has(this))observerAudit.callbacks++;callback(...args)})}
     observe(target,options){if(target.id==='agents')live.add(this);return super.observe(target,options)}
     disconnect(){live.delete(this);return super.disconnect()}
    };
   });return page;
  }};
  const page=await open(instrumented);
  for(let i=0;i<6;i++){
   assert.equal(await page.evaluate(()=>observerAudit.live.size),1,'one observer in workspace');
   await page.evaluate(()=>show('agents'));
   assert.equal(await page.evaluate(()=>observerAudit.live.size),0,'Agent observer released on leave');
   await page.evaluate(()=>{qa.beforeCallbacks=observerAudit.callbacks;document.querySelector('#agents').append(document.createElement('span'))});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(await page.evaluate(()=>observerAudit.callbacks),await page.evaluate(()=>qa.beforeCallbacks));
   await page.evaluate(()=>show('workspace'));
   await page.locator('#ws-current').getByText('42.0 token/s',{exact:true}).waitFor();
   for(const name of ['agents','routing','providers'])assert.equal(await page.locator('#view-'+name).count(),1);
  }
  await page.evaluate(()=>show('sessions'));
  assert.equal(await page.evaluate(()=>observerAudit.live.size),0);
  assert.deepEqual(page.errors,[]);await page.close();
  console.log(`${engine}: six reentries keep one native host and release the Agent observer on every leave`);
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
