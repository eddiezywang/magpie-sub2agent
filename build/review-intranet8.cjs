// Playwright-only runtime review; session titles and login links are masked.
const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
const [data,output]=process.argv.slice(2);
assert.ok(data && output,'provide data and screenshot directories');
const {key}=JSON.parse(await fs.readFile(path.join(data,'web-page.json'),'utf8'));
const browser=await chromium.launch({channel:'chrome'});
const report={views:[],auth:[]};
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/open',r=>r.fulfill({json:{}}));
 await page.goto('http://127.0.0.1:8990/?k='+encodeURIComponent(key));
 report.version=await page.evaluate(()=>window.bootPrefs.version);
 assert.equal(report.version,'0.1.3913-sub2agent.8');
 for(const view of ['agents','sessions','providers','routing','groups','gateway','usage','plugins','settings']) {
  errors.length=0;await page.goto('http://127.0.0.1:8990/?view='+view);await page.waitForTimeout(1400);
  await page.locator('#side button[data-view="sessions"]').waitFor();
  assert.equal(await page.locator('#nav button[data-view="masking"]').count(),0);
  assert.equal(await page.title(),'Sub2Agent');
  if(view==='plugins') {
   await page.locator('.pm-connection').waitFor();
   await page.getByRole('button',{name:'重新连接',exact:true}).waitFor();
   await page.locator('.pm-manual').waitFor();
   for(const theme of ['light','dark']) {
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.screenshot({path:path.join(output,'06-live-market-'+theme+'.png'),fullPage:true});
   }
  } else if(view==='settings') {
   await page.goto('http://127.0.0.1:8990/?view=settings&tab=privacy');await page.locator('#shareList .row').first().waitFor();
   assert.equal(await page.locator('#redactList').count(),0);
   assert.equal(await page.locator('#privacyModelRow').count(),0);
   await page.screenshot({path:path.join(output,'06-live-privacy.png'),fullPage:true});
  } else await page.screenshot({path:path.join(output,'06-live-'+view+'.png'),fullPage:true,mask:view==='sessions' ? [page.locator('.sm-folders .who'),page.locator('.sm-fwords')] : [],maskColor:'#dfe3eb'});
  assert.deepEqual(errors,[],view);report.views.push(view);
 }
 await page.goto('http://127.0.0.1:8990/?view=providers');
 for(const [name,file] of [['Trae 企业','trae'],['CodeBuddy','codebuddy']]) {
  await page.getByRole('button',{name,exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.signlink,.callback-form')||document.body.textContent.includes('登录未完成'),{timeout:20000});
  if(file==='trae') {
   await page.locator('.callback-form input').waitFor();
   const listening=await page.evaluate(()=>document.body.textContent.includes('正在监听本地回调'));
   assert.ok(listening,'local listener instructions missing');report.auth.push({provider:file,localListener:true,manualCallback:true});
  } else report.auth.push({provider:file,link:await page.locator('.signlink').count(),error:await page.getByText('登录未完成',{exact:true}).count()});
  await page.waitForTimeout(600);
  await page.screenshot({path:path.join(output,'06-live-'+file+'-login.png'),fullPage:true,mask:[page.locator('.signlink'),page.locator('.devcode')],maskColor:'#dfe3eb'});
  await page.getByRole('button',{name:'取消',exact:true}).click();
 }
 report.pageErrors=errors;
 await fs.writeFile(path.join(output,'06-live-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
} finally {await browser.close();}
})().catch(e=>{console.error(e.message.replace(/https?:\/\/\S+/g,'[address]'));process.exitCode=1;});

