const {chromium,webkit}=require('playwright'),{open}=require('./workspace-acceptance.cjs');
const assert=require('node:assert/strict');
(async()=>{for(const [engine,type]of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch(engine==='chromium'?{channel:'chrome'}:{});
 try{for(const [lang,empty,disabled]of [
  ['en','Routing group has no available members','Routing group is disabled'],
  ['zh','路由组暂无可用成员','路由组已停用'],
  ['zh-TW','路由群組暫無可用成員','路由群組已停用'],
  ['ja','利用可能なルーティングメンバーがありません','ルーティンググループは無効です'],
  ['de','Routinggruppe hat keine verfügbaren Mitglieder','Routinggruppe ist deaktiviert'],
 ]){
  const page=await open(browser,390,'/?view=workspace&locale='+lang);
  const button=page.locator('#ws-route-controls [data-ws-focus="group/steady"]');
  await page.evaluate(()=>{Object.assign(workspaceSamples.groups.find(g=>g.id==='steady'),{ready:false,disabled:false});magpie.call('workspace','render')});
  await page.getByText(empty,{exact:true}).waitFor();assert(await button.isDisabled());
  await page.evaluate(()=>{Object.assign(workspaceSamples.groups.find(g=>g.id==='steady'),{ready:true,disabled:true});magpie.call('workspace','render')});
  await page.getByText(disabled,{exact:true}).waitFor();assert(await button.isDisabled());
  assert.equal(await button.getAttribute('title'),disabled);
  assert.equal(await page.evaluate(()=>qa.sets),0,'availability refresh never saves an Agent');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(page.errors,[]);await page.close();
 }console.log(`${engine}: both group availability reasons, disabled with ready members, five languages and 390px passed`);
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
