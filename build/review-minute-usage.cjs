// Isolated Playwright preview of the actual accounting settings labels/schema.
// No running app, credentials, desktop input, reporting or external requests.
// NODE_PATH=<playwright modules> node build/review-minute-usage.cjs <screenshots>
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

(async () => {
  const output = process.argv[2];
  assert.ok(output, 'provide a screenshot directory');
  await fs.mkdir(output, {recursive:true});
  const assets = path.resolve(process.env.INTRANET_ASSETS || 'internal/gui/assets');
  const source = await fs.readFile('internal/accounting/runtime.go', 'utf8');
  const properties = {}, order = [];
  for (const [, type, tags] of source.slice(source.indexOf('type Options struct'),source.indexOf('func Defaults')).matchAll(/\w+\s+(bool|string)\s+`([^`]+)`/g)) {
    const tag = key => tags.match(new RegExp(key + ':"([^"]*)"'))?.[1];
    const key = tag('json');
    properties[key] = {type:type==='bool'?'boolean':'string',title:tag('title'),description:tag('description')};
    order.push(key);
  }
  assert.equal(order.length, 4);
  const report = [];
  for (const engine of ['chromium','webkit']) {
    const browser = await (engine==='webkit'?webkit.launch():chromium.launch({channel:'chrome'}));
    try {
      for (const [lang,width,theme] of [['zh',1440,'light'],['en',1440,'dark'],['zh',420,'dark']]) {
        const page = await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
        page.setDefaultTimeout(10000);
        const errors=[];
        page.on('pageerror', e=>errors.push(e.message));
        await page.addInitScript(()=>localStorage.setItem('magpie.pluginTab','builtin'));
        const builtin = {id:'accounting',name:'Usage reporting',sub:'Keep legacy telemetry and send numeric usage to the intranet billing service without conversation content',on:true,chosen:true,state:'active',schema:{type:'object',properties,'x-order':order},config:{legacyEnabled:true,usageEnabled:false,legacyURL:'http://172.21.0.177:17890/events',usageURL:'http://172.21.0.177:17890/usage/events'}};
        await page.route('**/*',async route=>{
          const u=new URL(route.request().url()), json=data=>route.fulfill({json:data});
          if(u.pathname==='/boot.js') return route.fulfill({contentType:'text/javascript',body:`window.bootPrefs=${JSON.stringify({lang,theme,web:true,intranet:true,featuresOff:['library','middleware','otel','redact','search','tools','warmups']})};`});
          if(u.pathname==='/wails/runtime.js') return route.fulfill({contentType:'text/javascript',body:'export const Window={};'});
          if(u.pathname==='/api/state') return json({agents:[],profiles:[],settings:{lang,theme,builtins:[builtin]}});
          if(u.pathname==='/api/plugins/builtin') { assert.equal(route.request().method(),'GET'); return json([builtin]); }
          if(u.pathname==='/api/providers') return json({providers:[],presets:[],gateway:{}});
          if(u.pathname==='/api/plugins') return json({bun:true,plugins:[],registry:{url:'http://172.21.0.177/npm'}});
          if(u.pathname==='/api/plugins/listings') return json({listings:[],market:{state:'online'}});
          if(u.pathname.startsWith('/api/')) return json({});
          if(u.host!=='magpie.test') return route.abort();
          const file=path.join(assets,u.pathname==='/'?'index.html':u.pathname);
          const contentType={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)];
          try { return route.fulfill({body:await fs.readFile(file),contentType}); } catch { return route.fulfill({status:404,body:''}); }
        });
        await page.goto('http://magpie.test/?view=plugins');
        const form=page.locator('.feat-set[data-of="accounting"]');
        await form.getByRole('switch',{name:lang==='zh'?'按分钟汇总用量':'Minute usage summaries',exact:true}).waitFor();
        assert.equal(await form.count(),4);
        assert.match(await form.allInnerTexts().then(a=>a.join(' ')),lang==='zh'?/按用户名、模型和上下文档位每分钟汇总/:/Aggregate by username/);
        if(width>=1024) assert.equal(await page.locator('#side button[data-view="sessions"]').count(),1);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
        assert.deepEqual(errors,[]);
        const name=`07-minute-${engine}-${lang}-${width}.png`;
        await page.screenshot({path:path.join(output,name),fullPage:true});
        report.push({engine,lang,width,theme,screenshot:name,pageErrors:errors});
        await page.close();
      }
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
