const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
(async()=>{
 const output=process.argv[2];await fs.mkdir(output,{recursive:true});
 const assets=path.resolve(process.env.INTRANET_ASSETS||'internal/gui/assets');
 const preset={id:'cib-zht-apikey',name:'CIB-智汇通-APIKEY',icon:'cib-zht',kind:'relay',anthropic:'http://10.32.33.46:11288/efllmas-agw/anthropicproxy',chat:'http://10.32.33.46:11288/efllmas-agw/v1'};
 const tig={id:'aiep-coding-plan',name:'TIG Coding Plan',icon:'tig-color',kind:'relay',anthropic:'http://172.21.11.82/public',endpoint:'http://172.21.11.82/public'};
 const vendor={id:'sub2agent-workbuddy',pid:'sub2agent-workbuddy',name:'WorkBuddy 企业',icon:'workbuddy-color',spec:'@sub2agent/workbuddy',methods:[{type:'oauth',label:'企业 SSO 扫码登录'}]};
 const report=[];
 for(const engine of ['chromium','webkit']) {
  const browser=await(engine==='webkit'?webkit.launch():chromium.launch({channel:'chrome'}));
  try {for(const [width,theme] of [[1440,'light'],[1440,'dark'],[420,'light']]) {
   const page=await browser.newPage({viewport:{width,height:1100},reducedMotion:'reduce'});
   let detectCount=0,saveCount=0;
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{window.reviewOpened=[];window.open=url=>{window.reviewOpened.push(url);return null;};});
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url()),json=data=>route.fulfill({json:data});
    if(u.pathname==='/boot.js') return route.fulfill({contentType:'text/javascript',body:`window.bootPrefs=${JSON.stringify({lang:'zh',theme,web:true,intranet:true,featuresOff:['library','middleware','otel','redact','search','tools','warmups']})};`});
    if(u.pathname==='/wails/runtime.js') return route.fulfill({contentType:'text/javascript',body:'export const Window={};'});
    if(u.pathname==='/api/state') return json({agents:[],profiles:[],settings:{lang:'zh',theme,builtins:[]}});
    if(u.pathname==='/api/provider/save') { saveCount++; return json({providers:[],excluded:[],unmoved:[],presets:[tig,preset],plugins:[vendor],gateway:{lanes:[]}}); }
    if(u.pathname==='/api/provider/detect') {
     const body=route.request().postDataJSON(); detectCount++;
     assert.equal(body.base,'http://custom-gateway.test/v1');
     assert.equal(body.key,'fixture-custom-key');
     return json({results:body.picked?.includes('retry-model')?[]:[{protocol:'anthropic',base:'http://custom-gateway.test',ok:true},{protocol:'responses',base:'http://custom-gateway.test/v1',ok:true},{protocol:'chat',base:'http://custom-gateway.test/v1',ok:false,status:404}]});
    }
    if(u.pathname==='/api/providers') return json({providers:[],excluded:[],unmoved:[],presets:[tig,preset],plugins:[vendor],gateway:{lanes:[]}});
    if(u.pathname==='/api/open') return json({});
    if(u.pathname==='/api/provider-zht/key') return json({keys:[{apiKeyId:'fixture_8899',apiKeyValue:'fixture-key'}]});
    if(u.pathname.startsWith('/api/')) return json({});
    if(u.host!=='magpie.test') return route.abort();
    const file=path.join(assets,u.pathname==='/'?'index.html':u.pathname);
    try{let body=await fs.readFile(file); if(u.pathname==='/') body=body.toString().split('\n').map(line=>line.includes('<span class="logo"')?'<span class="logo" aria-hidden="true"><img src="icons/sub2agent.svg" width="22" height="22" alt=""></span>':line).join('\n').replaceAll('<title>magpie</title>','<title>sub2agent</title>').replaceAll('<span>magpie</span>','<span>sub2agent</span>'); return route.fulfill({body,contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]});}catch{return route.fulfill({status:404,body:''});}
   });
   await page.goto('http://magpie.test/?view=providers');
   assert.ok((await page.locator('#addSheet').innerText()).includes('API 接入'));
   assert.ok(!(await page.locator('#addSheet').innerText()).includes('中转'));
   assert.equal(await page.locator('#addSheet [data-pick=custom]').innerText(),'自定义 API Key');
   assert.ok(await page.locator('#addSheet [data-pick=custom]').evaluate(e=>e.previousElementSibling.textContent.includes('CIB-智汇通-APIKEY')));
   await page.locator('img[src="icons/tig-color.svg"]').waitFor();
   await page.mouse.move(width-12,12); await page.waitForTimeout(350);
   await page.screenshot({path:path.join(output,`15-api-access-${engine}-${width}-${theme}.png`),fullPage:true});
   await page.locator('#addSheet button').filter({hasText:'CIB-智汇通-APIKEY'}).click();
   const editor=page.locator('.editor.new');await editor.locator('.coding-plan-notice').waitFor();
   assert.equal(await editor.locator('input[type=password]:visible').count(),1);
   assert.ok((await editor.innerText()).includes('8899'));
   await page.mouse.move(width-12,12); await page.waitForTimeout(350);
   await page.screenshot({path:path.join(output,`15-zht-${engine}-${width}-${theme}.png`),fullPage:true});
   await editor.getByRole('button',{name:'通过 CLI 登录并获取 Key',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.editor input[type=password]')?.value==='fixture-key');
   assert.equal(await editor.locator('input[type=password]:visible').inputValue(),'fixture-key');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflows');
   await page.mouse.move(width-12,12); await page.waitForTimeout(350);
   await page.screenshot({path:path.join(output,`15-zht-${engine}-${width}-${theme}.png`),fullPage:true});
   await editor.locator('input[type=password]:visible').fill('fixture-key');
   await editor.locator('.zht-gateway[data-protocol=anthropic]').fill('http://custom-gateway.test/anthropic');
   await editor.locator('.zht-gateway[data-protocol=chat]').fill('http://custom-gateway.test/v1');
   const saved=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/provider/save');
   await editor.getByRole('button',{name:'添加',exact:true}).click();
   const body=(await saved).postDataJSON();
   assert.equal(body.preset,preset.id);
   assert.equal(body.anthropic,'http://custom-gateway.test/anthropic');
   assert.equal(body.chat,'http://custom-gateway.test/v1');
   assert.equal(body.key,'fixture-key');
   assert.ok(!body.responses);
   await page.waitForTimeout(500);
   await page.goto("http://magpie.test/?view=providers");
   await page.locator('#addSheet button[data-pick="custom"]').click();
   const custom=page.locator('.editor.new');
   const gateway=custom.locator('input.base-url');
   await gateway.waitFor();
   assert.equal(await custom.locator('[data-api]:visible').count(),0);
   await custom.locator('.auto-gateway-status').waitFor();
   await custom.locator('input').first().fill('自定义 API');
   await gateway.fill('http://custom-gateway.test/v1');
   await custom.locator('input[type=password]:visible').fill('fixture-custom-key');
   await page.mouse.move(width-12,12); await page.waitForTimeout(350);
   await page.screenshot({path:path.join(output,`15-custom-${engine}-${width}-${theme}.png`),fullPage:true});
   const saveCustom=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/provider/save');
   await custom.getByRole('button',{name:'添加',exact:true}).click();
   const customBody=(await saveCustom).postDataJSON();
   assert.equal(customBody.chat,'');
   assert.equal(customBody.anthropic,'http://custom-gateway.test');
   assert.equal(customBody.responses,'http://custom-gateway.test/v1');
   assert.equal(detectCount,1);
   assert.equal(customBody.key,'fixture-custom-key');
   await page.waitForTimeout(500);
   await page.goto('http://magpie.test/?view=providers');
   await page.locator('#addSheet [data-pick=custom]').click();
   const failed=page.locator('.editor.new');
   await failed.locator('.auto-gateway-status').waitFor();
   await failed.locator('.base-url').fill('http://custom-gateway.test/v1');
   await failed.locator('input[type=password]:visible').fill('fixture-custom-key');
   await failed.locator('.add-models input').first().fill('retry-model');
   await failed.getByRole('button',{name:'添加',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.auto-gateway-status')?.textContent.includes('无法识别'));
   assert.equal(saveCount,2);
   assert.deepEqual(errors,[]);report.push({engine,width,theme,notice:true,dualProtocolDefaults:true,keyMasked:true,cliSelection:true,autoProtocols:true,failedDetectionBlocksSave:true});await page.close();
  }}finally{await browser.close();}
 }
 await fs.writeFile(path.join(output,'15-zht-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});

