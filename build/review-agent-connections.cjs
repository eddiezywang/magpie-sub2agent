const {chromium,webkit}=require('playwright');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
(async()=>{
 const source=await fs.readFile('internal/gui/assets/agentconnections.js','utf8');
 for(const engine of ['chromium','webkit']) {
  const browser=await(engine==='chromium'?chromium.launch({channel:'chrome'}):webkit.launch());
  try {
   const page=await browser.newPage();
   await page.route('http://local.test/**',route=>route.fulfill({contentType:route.request().url().endsWith('.js')?'text/javascript':'text/html',body:route.request().url().endsWith('.js')?source:'<div id="view-agents"><div id="agents"><div class="agent" data-id="codex"><div class="who">Codex</div></div></div></div>'}));
   await page.goto('http://local.test/');
   await page.evaluate(async()=>{
    window.calls=[]; window.t=s=>s; window.state={}; window.renderAgents=()=>{};
    window.statusErr=e=>{throw e};
    window.api=async(name)=>{calls.push(name);return name==='agents/connections'?{codex:{status:'configured',managed:false,path:'fixture/config.toml'}}:{};};
    window.check=await import('/agentconnections.js');await check.enter();
   });
   assert.equal(await page.locator('.connection-check').innerText(),'Configured for sub2agent · Adapt existing connection');
   await page.evaluate(async()=>{for(let n=0;n<10;n++) await check.enter();});
   assert.deepEqual(await page.evaluate(()=>calls),['agents/connections']);
   await page.evaluate(async()=>{check.leave();document.getElementById('view-agents').hidden=true;await check.enter();});
   assert.equal(await page.evaluate(()=>calls.length),1);
   await page.evaluate(async()=>{document.getElementById('view-agents').hidden=false;await check.enter();});
   assert.equal(await page.evaluate(()=>calls.length),2);
   await page.getByRole('button',{name:'Adapt existing connection'}).click();
   assert.equal(await page.evaluate(()=>calls.at(-1)),'agents/connect/codex');
   console.log(engine+': once per visit, read-only snapshot, explicit adaptation passed');
  } finally {await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
