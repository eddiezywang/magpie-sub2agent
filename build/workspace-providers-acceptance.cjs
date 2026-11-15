// Native workspace provider controls with isolated API responses only.
const {chromium,webkit}=require('playwright');
const {open}=require('./workspace-acceptance.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
async function check(browser,engine){
 const page=await open(browser);
 try{
  await page.evaluate(()=>{
   const original=window.fetch;
   qa.providerRequests=[];
   window.fetch=async(input,init={})=>{
    const url=new URL(String(input),location.href);
    if(url.pathname==='/api/provider/detect')return Response.json({results:[{protocol:'chat',ok:true,base:'https://relay.example.test/v1'}]});
    if(url.pathname==='/api/providers'){
     if(qa.providerData)return Response.json(qa.providerData);
     const response=await original(input,init);qa.providerData=await response.json();return Response.json(qa.providerData);
    }
    if(['/api/provider/save','/api/provider/on','/api/provider/off'].includes(url.pathname)){
     const body=JSON.parse(init.body||'{}');qa.providerRequests.push({path:url.pathname,body});
     if(url.pathname.endsWith('/save')){
      if(qa.providerReject)return Response.json({error:'synthetic provider save refused'},{status:409});
      qa.providerData.providers=qa.providerData.providers.filter(p=>p.id!==(body.from||body.id));
      qa.providerData.providers.push({...body,id:body.id||'workspace-provider',off:false,ready:true,icon:'generic',models:[],agents:[],key:{set:true,masked:'synthetic…only'}});
     }else{const p=qa.providerData.providers.find(p=>p.id===body.id);p.off=url.pathname.endsWith('/off');}
     return Response.json(qa.providerData);
    }
    if(url.pathname==='/api/plugin-signin/prompt')return Response.json({prompt:null,inputs:{}});
    if(url.pathname==='/api/plugin-signin'){
     qa.authBody=JSON.parse(init.body);return Response.json({id:'workspace-auth',agent:'workspace-auth',state:'waiting',url:'https://auth.example.test/isolated',linkOnly:true,pasteCode:true,instructions:'Synthetic authentication only'});
    }
    if(url.pathname==='/api/signin/workspace-auth/callback'){
     qa.authCallback=JSON.parse(init.body);qa.authDone=true;
     qa.providerData.providers.push({id:'workspace-auth',name:'隔离认证供应商',icon:'generic',models:[],agents:[],key:{set:false},account:{agent:'workspace-auth',agentName:'隔离认证供应商',user:'synthetic-user',logins:[{user:'synthetic-user',active:true,on:true}]}});
     return new Response(null,{status:204});
    }
    if(url.pathname==='/api/signin/workspace-auth')return Response.json({id:'workspace-auth',agent:'workspace-auth',state:qa.authDone?'done':'waiting',user:'synthetic-user',linkOnly:true,pasteCode:true,url:'https://auth.example.test/isolated',instructions:'Synthetic authentication only'});
    return original(input,init);
   };
   return loadProviders();
  });
  await page.locator('#addProvider').click();
  const sheet=page.locator('#addSheet');
  for(const [name,icon] of [['TIG-Coding-Plan','tig-color'],['CIB-智汇通-APIKEY','cib-zht']]){
   const tile=sheet.locator('.tile').filter({hasText:name});await tile.waitFor();
   assert.equal(await tile.count(),1);
   assert(await tile.locator(`img[src*="${icon}"]`).count(),`${name} native logo`);
  }
  for(const width of [1440,1024,390]){
   await page.setViewportSize({width,height:1000});
   const header=await sheet.locator(':scope > .row-head').evaluate(e=>{const r=e.getBoundingClientRect(),label=e.querySelector('.label'),l=label.getBoundingClientRect();return {oneLine:l.height<parseFloat(getComputedStyle(label).fontSize)*1.8,contained:[...e.children].filter(x=>getComputedStyle(x).display!=='none').every(x=>{const b=x.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.right+1})}});
   assert(header.oneLine,`${engine} ${width}: add title stays on one line`);
   assert(header.contained,`${engine} ${width}: search and actions fit sidebar`);
   if(process.env.ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.ARTIFACT_DIR,`${engine}-workspace-provider-add-${width}.png`),animations:'disabled'});
  }
  await page.setViewportSize({width:1440,height:1000});
  await sheet.locator('[data-pick=custom]').click();
  const editor=page.locator('#modal .editor.new');
  await editor.locator('input[placeholder="例如 My Relay"]').fill('工作台隔离供应商');
  await editor.locator('input[type=password]').first().fill('synthetic-key-only');
  await editor.locator('.base-url').fill('https://relay.example.test/v1');
  await editor.locator(':scope > .bar').getByRole('button',{name:'添加',exact:true}).click();
  await page.waitForFunction(()=>qa.providerRequests.some(x=>x.path==='/api/provider/save'),null,{timeout:5000});
  await page.waitForFunction(()=>editing===null);
  assert(await page.evaluate(()=>qa.providerRequests[0].body.new&&qa.providerRequests[0].body.chat==='https://relay.example.test/v1'&&qa.providerRequests[0].body.name==='工作台隔离供应商'));
  const row=page.locator('.row.provider[data-id="workspace-provider"]');
  await row.locator('.pswitch').click();await page.waitForFunction(()=>qa.providerData.providers.find(p=>p.id==='workspace-provider').off);
  await page.locator('#foldOff').click();
  await page.locator('#offProviders .row.provider[data-id="workspace-provider"] .pswitch').click();
  await page.waitForFunction(()=>!qa.providerData.providers.find(p=>p.id==='workspace-provider').off);
  await row.click();
  const edit=page.locator('#modal .editor');
  await edit.locator('input[placeholder="例如 My Relay"]').fill('工作台已编辑供应商');
  await page.evaluate(()=>qa.providerReject=true);
  await edit.locator(':scope > .bar').getByRole('button',{name:'保存',exact:true}).click();
  await edit.getByText('synthetic provider save refused',{exact:true}).waitFor();
  assert.equal(await edit.locator('input[placeholder="例如 My Relay"]').inputValue(),'工作台已编辑供应商');
  await page.evaluate(()=>qa.providerReject=false);
  await edit.locator(':scope > .bar').getByRole('button',{name:'保存',exact:true}).click();
  await row.getByText('工作台已编辑供应商',{exact:true}).waitFor();
  await page.waitForFunction(()=>editing===null);
  await page.locator('#modal').waitFor({state:'hidden'});
  await page.evaluate(()=>show('providers'));
  await page.locator('#providers .row.provider[data-id="workspace-provider"]').getByText('工作台已编辑供应商',{exact:true}).waitFor();
  await page.evaluate(()=>show('workspace'));
  await page.evaluate(async()=>{qa.providerData.plugins.push({id:'workspace-auth',pid:'sub2agent-workspace-auth',name:'隔离认证供应商',icon:'generic',spec:'synthetic-only',methods:[{type:'oauth',label:'合成认证'}]});await loadProviders()});
  await page.locator('#addProvider').click();
  await sheet.locator('.tile[data-pick="隔离认证供应商"]').click();
  const signing=sheet.locator('.signing');
  await signing.getByRole('textbox',{name:'验证码',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>view),'workspace');
  assert.equal(await page.evaluate(()=>qa.authBody.provider),'sub2agent-workspace-auth');
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert(await signing.getByRole('textbox',{name:'验证码',exact:true}).isVisible());
   assert(await signing.getByRole('textbox',{name:'验证码',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect(),p=e.closest('.signing').getBoundingClientRect();return r.width>30&&r.left>=p.left&&r.right<=p.right+1}),'authentication input fits native right column');
   if(process.env.ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.ARTIFACT_DIR,'private-auth',`${engine}-workspace-provider-auth-${width}.png`),animations:'disabled'});
  }
  await signing.getByRole('textbox',{name:'验证码',exact:true}).fill('synthetic-code');
  await signing.getByRole('button',{name:'完成登录',exact:true}).click();
  await page.waitForFunction(()=>editing==='workspace-auth');
  assert.equal(await page.evaluate(()=>qa.authCallback.url),'synthetic-code');
  await page.locator('#modal .editor .accts').getByText('synthetic-user',{exact:true}).waitFor();
  console.log(`${engine}: workspace provider logos, add/detect, on/off, refused-save retry, native-page sync and synthetic authentication passed`);
  assert.deepEqual(page.errors,[]);
 }finally{await page.close();}
}
(async()=>{if(process.env.ARTIFACT_DIR)await fs.mkdir(path.join(process.env.ARTIFACT_DIR,'private-auth'),{recursive:true});for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){const browser=await type.launch(engine==='chromium'?{channel:'chrome'}:{});try{await check(browser,engine)}finally{await browser.close()}}})().catch(e=>{console.error(e);process.exitCode=1});
