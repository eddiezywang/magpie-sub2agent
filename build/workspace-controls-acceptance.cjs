// Packed intranet workspace with synthetic APIs; no live accounts.
const {chromium,webkit}=require('playwright');
const {setup}=require('./workspace-guided-acceptance.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const out=process.env.ARTIFACT_DIR||path.resolve('../.build-tools/workspace-controls-review');
async function run(type,name){
 const browser=await type.launch(name==='chromium'?{channel:'chrome'}:{}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await setup(page);
 try{
  await page.goto('http://workspace.test/?view=workspace');
  const policy=page.locator('[data-ws-focus=strategy]'),agent=page.locator('[data-ws-focus=agent]'),summary=page.locator('#ws-agents summary');
  await policy.waitFor();await page.waitForTimeout(300);
  const dimensions=await Promise.all([agent,policy,page.locator('.ws-fold')].map(x=>x.evaluate(e=>{const s=getComputedStyle(e);return {height:e.getBoundingClientRect().height,border:s.borderTopWidth,radius:s.borderTopLeftRadius}})));
  assert.deepEqual(dimensions[0],dimensions[1],'agent and policy controls share the same visual frame');
  assert.deepEqual(dimensions[1],dimensions[2],'agent disclosure shares the same visual frame');
  assert.equal(dimensions[0].border,'0px','workspace triggers have no outline');
  await policy.click();assert.equal(await policy.getAttribute('aria-expanded'),'true');assert.equal(await page.locator('.row-menu[role=menu]').count(),1);
  await policy.click();assert.equal(await policy.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('.row-menu[role=menu]').count(),0,'same control closes the menu');
  await policy.click();await agent.click();assert.equal(await page.locator('.row-menu[role=menu]').count(),1,'switching menus leaves only one');
  assert.equal(await policy.getAttribute('aria-expanded'),'false');assert.equal(await agent.getAttribute('aria-expanded'),'true');
  await page.keyboard.press('Escape');assert.equal(await page.locator('.row-menu').count(),0);assert.equal(await agent.getAttribute('aria-expanded'),'false');
  await policy.click();await page.locator('#ws-route-members').click();assert.equal(await page.locator('.row-menu').count(),0,'outside click closes menu');
  await policy.click();await page.evaluate(()=>{const root=document.querySelector('.ws-primary');root.scrollTop+=25});await page.waitForTimeout(100);assert.equal(await page.locator('.row-menu').count(),1,'workspace scrolling keeps the menu available');
await page.evaluate(()=>magpie.call('workspace','render'));await page.waitForTimeout(200);assert.equal(await page.locator('.row-menu').count(),1,'refresh does not orphan the menu');
  await policy.click();assert.equal(await page.locator('.row-menu').count(),0);
  assert.equal(await page.locator('#ws-agents').getAttribute('open'),null);await summary.click();assert.notEqual(await page.locator('#ws-agents').getAttribute('open'),null);await page.locator('.ws-fold').getByText(/收起|Collapse/).waitFor();
  await summary.click();assert.equal(await page.locator('#ws-agents').getAttribute('open'),null);await page.locator('.ws-fold').getByText(/查看全部|Show all/).waitFor();
  const throughput=page.locator('#ws-throughput'),throughputLabel=throughput.locator('.ws-expand-label');
  await throughputLabel.scrollIntoViewIfNeeded();
  assert.equal(await throughputLabel.evaluate(e=>getComputedStyle(e).borderTopWidth),'0px','throughput trigger has no outline');
  await throughputLabel.click();assert.notEqual(await throughput.getAttribute('open'),null);await throughputLabel.getByText(/收起|Collapse/).waitFor();
  await page.waitForTimeout(1100);assert.notEqual(await throughput.getAttribute('open'),null,'telemetry refresh keeps dimensions open');
  await throughputLabel.click();assert.equal(await throughput.getAttribute('open'),null);await throughputLabel.getByText(/按维度查看|View throughput/).waitFor();
  await throughput.locator('summary').focus();await page.keyboard.press('Enter');assert.notEqual(await throughput.getAttribute('open'),null,'keyboard opens dimensions');
  await page.keyboard.press('Enter');assert.equal(await throughput.getAttribute('open'),null,'keyboard closes dimensions');
  await policy.click();await page.screenshot({path:path.join(out,`${name}-open.png`),animations:'disabled'});await policy.click();await page.screenshot({path:path.join(out,`${name}-closed.png`),animations:'disabled'});
  assert.deepEqual(errors,[]);console.log(name+': matching controls, toggle, switch, outside, Escape and refresh passed');
 }finally{await browser.close();}
}
(async()=>{await fs.mkdir(out,{recursive:true});for(const [name,type] of [['chromium',chromium],['webkit',webkit]])await run(type,name)})().catch(e=>{console.error(e);process.exitCode=1});
