const {chromium,webkit}=require('playwright');
const {fixture}=require('./workspace-acceptance.cjs');
const assert=require('node:assert/strict');
(async()=>{for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch(engine==='chromium'?{channel:'chrome'}:{});
 try {
  const page=await browser.newPage({viewport:{width:390,height:900}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let dismissed=false, complete=false, writes=0;
  const sources=[{id:'one',name:'WorkBuddy 企业',kind:'subscription',icon:'workbuddy-color',imported:false},{id:'two',name:'TIG-Coding-Plan',kind:'endpoint',icon:'tig-color',imported:false}];
  await page.exposeFunction('legacyTestBackend',method=>{
   if(method==='dismiss') dismissed=true;
   if(method==='import'){writes++;sources[0].imported=true;if(writes>1){sources[1].imported=true;complete=true;}}
   const preview={found:true,complete,dismissed,sources};
   return method==='import'?{imported:1,preview,...(!complete?{error:'部分旧认证无法转换'}:{})}:{...preview};
  });
  await fixture(page);
  await page.addInitScript(()=>{const old=window.fetch;window.fetch=async(input,init={})=>{const p=new URL(String(input),location.href).pathname;if(p.startsWith('/api/legacy-suppliers')){const method=p.endsWith('/dismiss')?'dismiss':p.endsWith('/import')?'import':'preview';return Response.json(await window.legacyTestBackend(method));}return old(input,init)}});
  await page.goto('http://workspace.test/?view=workspace');
  const dialog=page.locator('.legacy-supplier-dialog');await dialog.waitFor();
  assert.equal(await dialog.locator('.legacy-supplier-row').count(),2);
  assert.equal(await dialog.locator('.ic img').count(),2);
  await dialog.getByRole('button',{name:'暂不导入'}).click();await dialog.waitFor({state:'detached'});assert.equal(writes,0);
  await page.reload();await page.waitForFunction(()=>typeof window.legacySuppliers==='object');
  assert.equal(await dialog.count(),0,'dismissal suppresses automatic re-prompt');
  await page.evaluate(()=>show('settings'));await page.locator('[data-setting=legacy-import]').waitFor();
  await page.locator('[data-setting=legacy-import] button').click();await dialog.waitFor();
  await dialog.getByRole('button',{name:'导入供应商'}).click();await dialog.getByText('供应商导入结果').waitFor();
  assert.equal(writes,1);assert.equal(await dialog.getByText('已处理').count(),1);
  await dialog.getByText('待处理：请检查凭据和供应商插件状态').waitFor();
  await dialog.getByRole('button',{name:'完成'}).click();await dialog.waitFor({state:'detached'});
  await page.locator('[data-setting=legacy-import] button').click();await dialog.waitFor();
  await dialog.getByRole('button',{name:'导入供应商'}).click();await dialog.getByText('供应商导入结果').waitFor();
  assert.equal(writes,2);assert.equal(await dialog.getByText('已处理').count(),2);
  await dialog.getByRole('button',{name:'完成'}).click();await dialog.waitFor({state:'detached'});
  await page.reload();await page.waitForFunction(()=>typeof window.legacySuppliers==='object');assert.equal(await dialog.count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  console.log(`${engine}: confirmation, dismissal, settings retry, completion and mobile passed`);await page.close();
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1});
