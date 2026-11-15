// Shared native diagnostic rows remain useful after removing duplicate badges.
const {chromium,webkit}=require('playwright'),{open}=require('./workspace-acceptance.cjs');
const assert=require('node:assert/strict');
(async()=>{for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch(engine==='chromium'?{channel:'chrome'}:{});
 try{
  const page=await open(browser);
  await page.evaluate(()=>{
   const a=state.agents.find(a=>a.id==='pi');
   a.drift={kind:'unreachable',field:'model',want:a.fields[0].value,detail:'Synthetic unreachable gateway diagnostic'};
   renderAgents();
  });
  for(const surface of ['workspace','agents']){
   await page.evaluate(surface=>show(surface),surface);
   if(surface==='workspace')await page.locator('#ws-agents summary').click();
   const row=page.locator('#agents .agent[data-id=pi]');
   await row.waitFor();
   assert.equal(await row.locator('.connection-check,.connection-adapt').count(),0);
   assert.equal(await row.locator('.ag-st.bad').count(),1);
   assert.equal(await row.locator('.ag-st-t').getAttribute('title'),'Synthetic unreachable gateway diagnostic');
   await row.locator('.ag-fix').click();
   await page.locator('#modal').getByText('Synthetic unreachable gateway diagnostic',{exact:true}).waitFor();
   await page.keyboard.press('Escape');
  }
  assert.deepEqual(page.errors,[]);await page.close();
  console.log(`${engine}: native drift status and diagnostic details survive on workspace and Agent page`);
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
