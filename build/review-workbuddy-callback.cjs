const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
(async()=>{
 const output=process.argv[2];await fs.mkdir(output,{recursive:true});
 const assets=path.resolve(process.env.INTRANET_ASSETS||'internal/gui/assets');
 const preset={id:'cib-zht-apikey',name:'CIB-智汇通-APIKEY',icon:'cib-zht',kind:'relay',anthropic:'http://10.32.33.46:11288/efllmas-agw/anthropicproxy',chat:'http://10.32.33.46:11288/efllmas-agw/v1'};
 const vendor={id:'sub2agent-workbuddy',pid:'sub2agent-workbuddy',name:'WorkBuddy 企业',icon:'workbuddy-color',spec:'@sub2agent/workbuddy',methods:[{type:'oauth',label:'企业 SSO 扫码登录'}]};
 const flow={id:'fixture-signin',agent:vendor.id,state:'waiting',url:'https://www.workbuddy.cn/login/?platform=workbuddy&state=fixture-state',pasteCallback:true,instructions:'自动识别登录结果；也可以粘贴完整回调地址。'};
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
    if(u.pathname==='/api/provider/save') return json({providers:[],excluded:[],unmoved:[],presets:[preset],plugins:[vendor],gateway:{lanes:[]}});
    if(u.pathname==='/api/providers') return json({providers:[],excluded:[],unmoved:[],presets:[preset],plugins:[vendor],gateway:{lanes:[]}});
    if(u.pathname==='/api/plugin-signin/prompt') return json({prompt:null,inputs:{}});
    if(u.pathname==='/api/plugin-signin' || u.pathname==='/api/signin/fixture-signin') return json(flow);
    if(u.pathname==='/api/signin/fixture-signin/callback') return route.fulfill({status:400,json:{error:'此地址不属于本次 WorkBuddy 企业登录，请粘贴当前登录页面最后跳转的完整地址。'}});
    if(u.pathname==='/api/open') return json({});
    if(u.pathname==='/api/provider-zht/key') return json({keys:[{apiKeyId:'fixture_8899',apiKeyValue:'fixture-key'}]});
    if(u.pathname.startsWith('/api/')) return json({});
    if(u.host!=='magpie.test') return route.abort();
    const file=path.join(assets,u.pathname==='/'?'index.html':u.pathname);
    try{return route.fulfill({body:await fs.readFile(file),contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]});}catch{return route.fulfill({status:404,body:''});}
   });
   await page.goto('http://magpie.test/?view=providers');
   await page.locator('#addSheet .tile[data-pick="WorkBuddy 企业"]').click();
   const form=page.locator('.callback-form');await form.waitFor();
   await page.screenshot({path:path.join(output,`14-workbuddy-${engine}-${width}-${theme}.png`),fullPage:true});
   const input=form.locator('input');
   await input.fill('https://www.workbuddy.cn/login/?platform=workbuddy&state=other-fixture');
   await form.locator('button').click();
   await page.getByText('此地址不属于本次 WorkBuddy 企业登录，请粘贴当前登录页面最后跳转的完整地址。',{exact:true}).waitFor();
   assert.equal(await input.isEnabled(),true);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflows');
   assert.deepEqual(errors,[]);report.push({engine,width,theme,manualCallback:true,automaticFlow:true,retry:true});await page.close();
  }}finally{await browser.close();}
 }
 await fs.writeFile(path.join(output,'14-workbuddy-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});

