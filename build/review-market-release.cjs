// Playwright release previews: mocked registry and isolated notify options only.
// No plugin installs or notification requests are performed.
const {chromium,webkit}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
  const [data,release,output]=process.argv.slice(2);
  const {key}=JSON.parse(await fs.readFile(path.join(data,'web-page.json'),'utf8'));
  const catalog=JSON.parse(await fs.readFile(path.join(release,'www/magpie/plugins/registry.json'),'utf8'));
  assert.equal(catalog.plugins.length,5);
  const listings=catalog.plugins.map(p=>({...p,npm:{version:p.bundle.version}}));
  const results=[];
  for(const engine of ['chromium','webkit']) {
    const browser=await(engine==='webkit'?webkit.launch():chromium.launch({channel:'chrome',headless:true}));
    try {for(const [width,theme] of [[1440,'light'],[1440,'dark'],[420,'light']]) {
      const page=await browser.newPage({viewport:{width,height:1100}});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(()=>localStorage.setItem('magpie.pluginTab','discover'));
      await page.route('**/api/plugins/listings*',r=>r.fulfill({json:{listings,market:{state:'online'}}}));
      await page.route('**/api/plugins/npm*',r=>r.fulfill({json:Object.fromEntries(listings.map(p=>[p.package,p.npm]))}));
      await page.goto('http://127.0.0.1:8990/?k='+encodeURIComponent(key)+'&view=plugins');
      if(await page.getByRole('tab',{name:'发现',exact:true}).isVisible()) await page.getByRole('tab',{name:'发现',exact:true}).click();
      await page.locator('.pm-card').last().waitFor();
      assert.equal(await page.locator('.pm-card').count(),5);
      assert.equal(await page.locator('.pm-card[data-pkg="@sub2agent/aiep"]').count(),1);
      await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      assert.doesNotMatch(await page.locator('body').innerText(),/172\.21\.0\.177/);
      await page.screenshot({path:path.join(output,`10-market-preview-${engine}-${width}-${theme}.png`),fullPage:true});
      await page.close();
      const notify=await browser.newPage({viewport:{width,height:1100}});
      notify.on('pageerror',e=>errors.push(e.message));
      await notify.route('**/*',async r=>{
        const u=new URL(r.request().url());
        if(u.host!=='notify.test') return r.abort();
        if(u.pathname==='/_magpie/bridge.js') return r.fulfill({contentType:'text/javascript',body:`window.magpie={theme:{lang:'zh'},ready:Promise.resolve({lang:'zh'}),options:{get:async()=>({channels:[],includeText:false,lang:'zh'}),set:async o=>{window.reviewSaved=o;}}};`});
        const filename=path.join(release,'staging/notify/page',u.pathname==='/'?'index.html':u.pathname.slice(1));
        return r.fulfill({body:await fs.readFile(filename),contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(filename)]});
      });
      await notify.goto('http://notify.test/');
      await notify.locator('.head .menu > button').filter({hasText:'添加渠道'}).waitFor();
      if(theme==='dark') await notify.addStyleTag({content:':root{--magpie-bg:#19191c;--magpie-card:#232327;--magpie-fg:#eeeeef;--magpie-muted:#a2a2ab;--magpie-line:#3b3b43;--magpie-accent:#a8bcf8;--magpie-accent-soft:#303b54;color-scheme:dark}'});
      await notify.screenshot({path:path.join(output,`10-notify-preview-${engine}-${width}-${theme}.png`),fullPage:true});
      await notify.locator('.head .menu > button').filter({hasText:'添加渠道'}).click();
      await notify.getByRole('option',{name:'企业微信',exact:true}).click();
      assert.equal(await notify.locator('input[type=password]').inputValue(),'');
      assert.deepEqual(errors,[]);
      results.push({engine,width,theme,plugins:5,aiep:true,notifyWeCom:true,networkNotifications:0});
      await notify.close();
    }}finally{await browser.close();}
  }
  await fs.writeFile(path.join(output,'10-market-preview-results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results));
})().catch(e=>{console.error(e.message.replace(/https?:\/\/\S+/g,'[address]'));process.exitCode=1;});
