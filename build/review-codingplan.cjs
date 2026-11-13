const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
(async()=>{
 const output=process.argv[2];await fs.mkdir(output,{recursive:true});
 const assets=path.resolve(process.env.INTRANET_ASSETS||'internal/gui/assets');
 const preset={id:'aiep-coding-plan',name:'行内 Coding Plan',icon:'generic',kind:'relay',anthropic:'http://172.21.11.82/public',endpoint:'http://172.21.11.82/public',website:'http://docs.weoa.com/docs/47kgJOEB8WTo77qV',keysUrl:'https://aiep.weoa.com'};
 const report=[];
 for(const engine of ['chromium','webkit']) {
  const browser=await(engine==='webkit'?webkit.launch():chromium.launch({channel:'chrome'}));
  try {for(const [width,theme] of [[1440,'light'],[1440,'dark'],[420,'light']]) {
   const page=await browser.newPage({viewport:{width,height:1100},reducedMotion:'reduce'});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{window.reviewOpened=[];window.open=url=>{window.reviewOpened.push(url);return null;};});
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url()),json=data=>route.fulfill({json:data});
    if(u.pathname==='/boot.js') return route.fulfill({contentType:'text/javascript',body:`window.bootPrefs=${JSON.stringify({lang:'zh',theme,web:true,intranet:true,featuresOff:['library','middleware','otel','redact','search','tools','warmups']})};`});
    if(u.pathname==='/wails/runtime.js') return route.fulfill({contentType:'text/javascript',body:'export const Window={};'});
    if(u.pathname==='/api/state') return json({agents:[],profiles:[],settings:{lang:'zh',theme,builtins:[]}});
    if(u.pathname==='/api/provider/save') return json({providers:[],excluded:[],unmoved:[],presets:[preset],gateway:{lanes:[]}});
    if(u.pathname==='/api/providers') return json({providers:[],excluded:[],unmoved:[],presets:[preset],gateway:{lanes:[]}});
    if(u.pathname==='/api/open') return json({});
    if(u.pathname.startsWith('/api/')) return json({});
    if(u.host!=='magpie.test') return route.abort();
    const file=path.join(assets,u.pathname==='/'?'index.html':u.pathname);
    try{return route.fulfill({body:await fs.readFile(file),contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]});}catch{return route.fulfill({status:404,body:''});}
   });
   await page.goto('http://magpie.test/?view=providers');
   await page.locator('#addSheet button').filter({hasText:'行内 Coding Plan'}).click();
   const editor=page.locator('.editor.new');await editor.locator('.coding-plan-notice').waitFor();
   assert.equal(await editor.locator('input.endpoint').inputValue(),preset.anthropic);
   assert.equal(await editor.locator('input[type=password]:visible').count(),1);
   assert.equal(await editor.locator('.auth-header:visible').count(),0);
   const text=await editor.innerText();
   for(const needle of ['公有云大模型密钥','仅限非敏感代码','国家安全','违规需自行担责','Authorization: Bearer','codeplan / codingplan']) assert.ok(text.includes(needle),needle);
   assert.doesNotMatch(text,/eddiewang|真实key|172\.21\.0\.177/);
   await editor.getByRole('button',{name:'AIEP · 申请密钥 / 剩余额度',exact:true}).click();
   await editor.getByRole('button',{name:'查看使用说明 ↗',exact:true}).click();
   assert.deepEqual(await page.evaluate(()=>window.reviewOpened),[preset.keysUrl,preset.website]);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflows');
   await page.screenshot({path:path.join(output,`09-codingplan-${engine}-${width}-${theme}.png`),fullPage:true});
   await editor.locator('input.endpoint').fill('http://plan.test/public');
   await editor.locator('input[type=password]:visible').fill('fixture-key');
   const saved=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/provider/save');
   await editor.getByRole('button',{name:'添加',exact:true}).click();
   const body=(await saved).postDataJSON();
   assert.equal(body.preset,preset.id);
   assert.equal(body.anthropic,'http://plan.test/public');
   assert.equal(body.key,'fixture-key');
   assert.ok(!body.chat&&!body.responses);
   assert.deepEqual(errors,[]);report.push({engine,width,theme,notice:true,base:true,keyMasked:true,bearerOnly:true});await page.close();
  }}finally{await browser.close();}
 }
 await fs.writeFile(path.join(output,'09-codingplan-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});

