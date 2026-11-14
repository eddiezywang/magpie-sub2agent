// WorkBuddy add/sign-in entry with entirely synthetic API responses.
const {chromium,webkit}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const assets=process.env.INTRANET_ASSETS;
assert.ok(assets,'INTRANET_ASSETS must point to an extracted intranet pack');
const vendor={id:'sub2agent-workbuddy',pid:'sub2agent-workbuddy',name:'WorkBuddy 企业',icon:'workbuddy-color',spec:'@sub2agent/workbuddy',methods:[{type:'oauth',label:'企业 SSO 扫码登录'}]};
(async()=>{
 for(const engine of ['chromium','webkit']){
  const browser=await (engine==='chromium'?chromium.launch({channel:'chrome'}):webkit.launch());
  try{for(const theme of ['light','dark']){
   const page=await browser.newPage({viewport:{width:1000,height:800},reducedMotion:'reduce'}),errors=[],calls=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url()),json=x=>route.fulfill({json:x});
    if(u.pathname==='/boot.js')return route.fulfill({contentType:'text/javascript',body:`window.bootPrefs=${JSON.stringify({lang:'zh',theme,web:false,intranet:true,featuresOff:['library','middleware','otel','redact','search','tools','warmups']})};`});
    if(u.pathname==='/wails/runtime.js')return route.fulfill({contentType:'text/javascript',body:'export const Window={};'});
    if(u.pathname==='/api/plugin-signin/prompt'){calls.push(route.request().postDataJSON());return json({prompt:{key:'test',type:'text',message:'模拟授权问题'}})}
    if(u.pathname==='/api/providers')return json({providers:[],excluded:[],unmoved:[],presets:[],plugins:[vendor],gateway:{lanes:[]}});
    if(u.pathname==='/api/state')return json({agents:[],profiles:[],settings:{lang:'zh',theme,builtins:[]}});
    if(u.pathname.startsWith('/api/'))return json({});
    if(u.hostname!=='fixture.test')return route.abort();
    try{const file=path.join(assets,u.pathname==='/'?'index.html':u.pathname);return route.fulfill({body:await fs.readFile(file),contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]})}catch{return route.fulfill({status:404,body:''})}
   });
   await page.goto('http://fixture.test/?view=providers');
   const tile=page.getByRole('button',{name:'WorkBuddy 企业',exact:true});await tile.waitFor();await tile.click();
   await page.waitForFunction(()=>document.body.textContent.includes('模拟授权问题'));
   assert.equal(calls.length,1);assert.equal(calls[0].provider,'sub2agent-workbuddy');assert.deepEqual(errors,[]);
   console.log(engine,theme,'synthetic WorkBuddy sign-in prompt reachable');await page.close();
  }}finally{await browser.close()}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
