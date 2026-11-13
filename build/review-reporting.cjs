// Read-only Playwright verification of the retained, running internal app.
// node build/review-reporting.cjs <portable-data> <screenshots>
const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
  const [data,output]=process.argv.slice(2);
  assert.ok(data&&output);
  await fs.mkdir(output,{recursive:true});
  const {key}=JSON.parse(await fs.readFile(path.join(data,'web-page.json'),'utf8'));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const report={views:[]};
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.setDefaultTimeout(15000);
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/open',r=>r.fulfill({json:{}}));
    await page.goto('http://127.0.0.1:8990/?k='+encodeURIComponent(key));
    report.version=await page.evaluate(()=>window.bootPrefs.version);
    assert.equal(report.version,'0.1.3913-sub2agent.9');
    for(const view of ['agents','sessions','providers','routing','groups','gateway','usage','plugins','settings']) {
      await page.goto('http://127.0.0.1:8990/?view='+view);
      await page.locator('#side button[data-view="sessions"]').waitFor();
      await page.waitForTimeout(1000);
      assert.doesNotMatch(await page.locator('body').innerText(),/172\.21\.0\.177/,view+' exposes infrastructure');
      assert.equal(await page.title(),'Sub2Agent');
      if(view==='plugins') {
        await page.locator('.pm-connection').waitFor();
        assert.equal(await page.locator('.pm-server,.pm-registry').count(),0);
        await page.screenshot({path:path.join(output,'08-live-market.png'),fullPage:true});
        await page.getByRole('tab',{name:'内置',exact:true}).click();
        const row=page.locator('.feat-row[data-id="accounting"]');
        await row.getByRole('switch',{name:'埋点上报',exact:true}).waitFor();
        assert.equal(await row.getByRole('switch').count(),1);
        assert.equal(await page.locator('.feat-set[data-of="accounting"]').count(),0);
        assert.doesNotMatch(await row.innerText(),/v3|分钟|旧版|172\./);
        for(const theme of ['light','dark']) {
          await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
          await row.scrollIntoViewIfNeeded();
          await page.screenshot({path:path.join(output,'08-live-reporting-'+theme+'.png'),fullPage:true});
        }
        const metadata=await page.evaluate(async()=>{
          const list=await fetch('/api/plugins/builtin').then(r=>r.json());
          const reporting=list.find(p=>p.id==='accounting');
          const plugins=await fetch('/api/plugins').then(r=>r.json());
          return {fields:Object.keys(reporting.schema?.properties||{}),config:reporting.config||{},registry:plugins.registry};
        });
        assert.deepEqual(metadata.fields,[]);
        assert.deepEqual(metadata.config,{});
        assert.ok(!metadata.registry?.url);
        report.reporting={switches:1,configurationFields:0,addressesVisible:false};
      } else {
        await page.screenshot({path:path.join(output,'08-live-'+view+'.png'),fullPage:true,mask:view==='sessions'?[page.locator('#view-sessions')]:[],maskColor:'#dfe3eb'});
      }
      assert.deepEqual(errors,[],view);
      report.views.push(view);
    }
    report.pageErrors=errors;
    await fs.writeFile(path.join(output,'08-live-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  }finally{await browser.close()}
})().catch(e=>{console.error(e.message.replace(/https?:\/\/\S+/g,'[address]'));process.exitCode=1});
