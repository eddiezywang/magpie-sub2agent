const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
(async()=>{
 const output=process.argv[2];await fs.mkdir(output,{recursive:true});
 const assets=path.resolve(process.env.INTRANET_ASSETS||'internal/gui/assets');
 const preset={id:'cib-zht-apikey',name:'CIB-智汇通-APIKEY',icon:'cib-zht',kind:'relay',anthropic:'http://10.32.33.46:11288/efllmas-agw/anthropicproxy',chat:'http://10.32.33.46:11288/efllmas-agw/v1'};
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
    if(u.pathname==='/api/provider-zht/key') return json({keys:[{apiKeyId:'fixture_8899',apiKeyValue:'fixture-key'}]});
    if(u.pathname.startsWith('/api/')) return json({});
    if(u.host!=='magpie.test') return route.abort();
    const file=path.join(assets,u.pathname==='/'?'index.html':u.pathname);
    try{return route.fulfill({body:await fs.readFile(file),contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]});}catch{return route.fulfill({status:404,body:''});}
   });
   await page.goto('http://magpie.test/?view=providers');
   await page.locator('#addSheet button').filter({hasText:'CIB-智汇通-APIKEY'}).click();
   const editor=page.locator('.editor.new');await editor.locator('.coding-plan-notice').waitFor();
   assert.equal(await editor.locator('input[type=password]:visible').count(),1);
   assert.ok((await editor.innerText()).includes('8899'));
   await page.screenshot({path:path.join(output,`13-zht-${engine}-${width}-${theme}.png`),fullPage:true});
   await editor.getByRole('button',{name:'通过 CLI 登录并获取 Key',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.editor input[type=password]')?.value==='fixture-key');
   assert.equal(await editor.locator('input[type=password]:visible').inputValue(),'fixture-key');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflows');
   await page.screenshot({path:path.join(output,`13-zht-${engine}-${width}-${theme}.png`),fullPage:true});
   await editor.locator('input[type=password]:visible').fill('fixture-key');
   const saved=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/provider/save');
   await editor.getByRole('button',{name:'添加',exact:true}).click();
   const body=(await saved).postDataJSON();
   assert.equal(body.preset,preset.id);
   assert.ok(!body.anthropic && !body.chat, 'preset endpoints are resolved by the server');
   assert.equal(body.key,'fixture-key');
   assert.ok(!body.responses);
   assert.deepEqual(errors,[]);report.push({engine,width,theme,notice:true,dualProtocolDefaults:true,keyMasked:true,cliSelection:true});await page.close();
  }}finally{await browser.close();}
 }
 await fs.writeFile(path.join(output,'13-zht-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});

