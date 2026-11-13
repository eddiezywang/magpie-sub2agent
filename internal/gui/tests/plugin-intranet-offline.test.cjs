const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {test} = require('node:test');
const {chromium, webkit} = require('playwright');

const assets = path.resolve(process.env.INTRANET_ASSETS || path.join(__dirname, '../assets'));
for (const engine of ['chromium', 'webkit']) test(engine + ': intranet market reports failures and recovers', async t => {
  const browser = await (engine === 'webkit' ? webkit.launch() : chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'}));
  t.after(() => browser.close());
  for (const [width, theme] of [[1280,'light'],[420,'dark']]) await t.test(width + ' ' + theme, async () => {
    const page = await browser.newPage({viewport:{width,height:850}});
    page.setDefaultTimeout(8000);
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    let replies=0, release;
    const listing={package:'internal-plugin',name:'Internal Plugin',community:true,summary:{zh:'内网插件'},npm:{version:'1.0.0'}};
    await page.route('**/*', async route=>{
      const u=new URL(route.request().url()), json=data=>route.fulfill({json:data});
      if(u.pathname==='/boot.js') return route.fulfill({contentType:'text/javascript',body:`window.bootPrefs={lang:'zh',theme:'${theme}',web:true,intranet:true,featuresOff:['library','middleware','otel','search','tools','warmups']};`});
      if(u.pathname==='/wails/runtime.js') return route.fulfill({contentType:'text/javascript',body:'export const Window={};'});
      if(u.pathname==='/api/state') return json({agents:[],profiles:[],builtins:[],settings:{lang:'zh',theme}});
      if(u.pathname==='/api/providers') return json({providers:[],presets:[],excluded:[],gateway:{}});
      if(u.pathname==='/api/plugins') return json({bun:true,plugins:[],registry:{url:'http://172.21.0.177/npm'}});
      if(u.pathname==='/api/plugins/listings') {
        replies++;
        if(replies===1) return json({listings:[],market:{state:'unavailable',reason:'timeout'}});
        assert.equal(u.searchParams.get('again'),'1');
        if(replies===2) {await new Promise(r=>release=r);return json({listings:[],market:{state:'unavailable',reason:'http',httpStatus:503}});}
        if(replies===3) return json({listings:[],market:{state:'online'}});
        return json({listings:[listing],market:{state:'cached',reason:'refused',updatedAt:'2026-11-13T01:00:00Z'}});
      }
      if(u.pathname==='/api/plugins/github') return json({repos:[]});
      if(u.pathname.startsWith('/api/')) return json({});
      if(u.host!=='magpie.test') return route.abort();
      const file=path.join(assets,u.pathname==='/'?'index.html':u.pathname);
      const contentType={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)];
      try {return await route.fulfill({body:await fs.readFile(file),contentType});}catch{return route.fulfill({status:404,body:''});}
    });
    await page.goto('http://magpie.test/?view=plugins');
    const panel=page.locator('.pm-connection');
    await panel.getByText(/连接超时，服务器在 6 秒内未响应/).waitFor();
    assert.equal(await page.locator('.pm-bar').count(),0,'unavailable must not appear as All 0');
    await page.getByText('离线导入',{exact:true}).waitFor();
    const layout=await page.evaluate(()=>{
      const panel=document.querySelector('.pm-connection').getBoundingClientRect(), form=document.querySelector('.pm-manual').getBoundingClientRect(), body=document.querySelector('.pm-body');
      return {separate:form.top>=panel.bottom,display:getComputedStyle(body).display,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.deepEqual(layout,{separate:true,display:'flex',overflow:false});
    if(process.env.ARTIFACT_DIR && engine==='chromium' && width===1280) await page.screenshot({path:path.join(process.env.ARTIFACT_DIR,'06-market-timeout.png')});
    await panel.getByRole('button',{name:'重新连接'}).click();
    await panel.getByRole('button',{name:'正在连接…',exact:true}).waitFor();
    assert.equal(await panel.getByRole('button').isDisabled(),true);
    release();
    await panel.getByText(/HTTP 503/).waitFor();
    await panel.getByRole('button',{name:'重新连接'}).click();
    await panel.getByText('连接正常，管理员尚未发布插件。',{exact:true}).waitFor();
    assert.equal(await panel.getByText(/无法连接/).count(),0);
    await panel.getByRole('button',{name:'重新连接'}).click();
    await panel.getByText(/服务器拒绝连接/).waitFor();
    await page.locator('.pm-card').filter({hasText:'Internal Plugin'}).waitFor();
    await panel.getByText(/目录缓存时间/).waitFor();
    if(process.env.ARTIFACT_DIR && engine==='chromium') await page.screenshot({path:path.join(process.env.ARTIFACT_DIR,`06-market-cache-${theme}.png`)});
    assert.deepEqual(errors,[]);
    await page.close();
  });
});
