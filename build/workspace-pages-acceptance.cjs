// Every retained page at each required viewport/theme, using packed assets.
const {chromium,webkit}=require('playwright');
const {open}=require('./workspace-acceptance.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const pages=['workspace','agents','providers','routing','groups','gateway','sessions','usage','plugins','settings'];
(async()=>{
 const results=[];
 for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch(engine==='chromium'?{channel:'chrome'}:{});
  try{
   const page=await open(browser);
   for(const theme of ['light','dark'])for(const width of [1440,1024,390]){
    await page.setViewportSize({width,height:1000});
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    for(const target of pages){
     await page.evaluate(target=>show(target),target);
     const host=page.locator('#view-'+target);await host.waitFor({state:'visible'});
     await page.evaluate(()=>document.fonts.ready);
     assert(await host.evaluate(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}),`${target}: visible surface`);
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${engine} ${theme} ${width} ${target}: viewport overflow`);
     assert.equal(await page.locator('#view-'+target).count(),1,`${target}: unique native host`);
     assert((await page.locator('#pageTitle').innerText()).trim(),`${target}: named page`);
     if(target==='workspace'){
      const summary=page.locator('#ws-agents summary');await summary.focus();
      const before=await page.locator('#ws-agents').evaluate(e=>e.open);
      await page.keyboard.press('Enter');await page.waitForFunction(before=>document.querySelector('#ws-agents').open!==before,before);
      await page.keyboard.press('Enter');await page.waitForFunction(before=>document.querySelector('#ws-agents').open===before,before);
      await page.locator('#ws-throughput').evaluate(e=>e.open=true);
      for(const dimension of ['models','sessions','providers']){
       const tab=page.locator(`[data-dimension="${dimension}"]`);await tab.focus();await page.keyboard.press('Enter');
       assert.equal(await tab.getAttribute('aria-pressed'),'true');
      }
     }
     results.push({engine,theme,width,page:target});
    }
    assert.deepEqual(page.errors,[]);
    console.log(`${engine} ${theme} ${width}: ten retained pages, unique hosts, no viewport overflow or script errors; keyboard disclosures/dimensions passed`);
   }
   await page.close();
  }finally{await browser.close()}
 }
 if(process.env.ARTIFACT_DIR){await fs.mkdir(process.env.ARTIFACT_DIR,{recursive:true});await fs.writeFile(path.join(process.env.ARTIFACT_DIR,'retained-pages-matrix.json'),JSON.stringify({cases:results.length,results},null,2));}
})().catch(e=>{console.error(e);process.exitCode=1});
