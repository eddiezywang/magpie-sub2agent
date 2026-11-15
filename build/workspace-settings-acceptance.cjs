// Retained intranet settings writes, using isolated synthetic API responses.
const {chromium,webkit}=require('playwright'),{open}=require('./workspace-acceptance.cjs');
const assert=require('node:assert/strict');
(async()=>{for(const [engine,type]of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch(engine==='chromium'?{channel:'chrome'}:{});
 try{
  const page=await open(browser);
  await page.evaluate(()=>{
   const original=window.fetch;qa.settingsWrites=[];
   const settings=state.settings;settings.lightweight=false;settings.plainNames=true;
   window.fetch=async(input,init={})=>{
    const url=new URL(String(input),location.href);
    if(url.pathname==='/api/settings'&&init.method!=='POST')return Response.json(settings);
    if(init.method==='POST'&&['/api/settings','/api/settings/port'].includes(url.pathname)){
     const body=JSON.parse(init.body);qa.settingsWrites.push({path:url.pathname,body});
     if(qa.refuseSettings)return Response.json({error:'Synthetic settings save refused'},{status:409});
     Object.assign(settings,body);
     if(url.pathname.endsWith('/port')){settings.gateway='http://127.0.0.1:'+body.port;return Response.json({settings,port:{}});}
     return Response.json(settings);
    }
    return original(input,init);
   };
  });
  await page.evaluate(()=>show('settings'));
  const root=page.locator('#internalSettings');await root.waitFor();
  const port=root.locator('.gateway-port'),apply=root.locator('[data-setting=gateway]').getByRole('button',{name:'应用',exact:true});
  await port.fill('80');await apply.click();
  assert.equal(await page.evaluate(()=>qa.settingsWrites.length),0,'invalid port never posts');
  await port.fill('19993');await page.evaluate(()=>qa.refuseSettings=true);await apply.click();
  await page.getByText('Synthetic settings save refused',{exact:true}).waitFor();
  assert.equal(await port.inputValue(),'19993','failed save retains draft');assert.equal(await apply.isEnabled(),true);
  await page.evaluate(()=>qa.refuseSettings=false);await apply.click();
  await page.waitForFunction(()=>prefs.port===19993);
  assert.equal(await port.inputValue(),'19993');
  const lightweight=root.locator('[data-setting=lightweight]');
  await lightweight.getByRole('button',{name:'开启',exact:true}).click();
  await page.waitForFunction(()=>prefs.lightweight===true);
  assert.equal(await page.evaluate(()=>state.settings.plainNames),true,'unrelated setting preserved');
  await page.evaluate(()=>show('sessions'));await page.locator('#view-sessions').waitFor({state:'visible'});
  await page.evaluate(()=>show('settings'));await root.waitFor();
  assert.equal(await port.inputValue(),'19993','return rereads saved port');
  assert.deepEqual(page.errors,[]);await page.close();
  console.log(`${engine}: internal settings validation, refused-save retry, port persistence and lightweight write passed`);
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
