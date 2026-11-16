// Native intranet pages, synthetic APIs; no real account or desktop process.
const {chromium,webkit}=require('playwright');
const {fixture}=require('./workspace-acceptance.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const output=process.env.ARTIFACT_DIR||path.resolve('../.build-tools/points-ui');
(async()=>{
 await fs.mkdir(output,{recursive:true});
 for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch(engine==='chromium'?{channel:'chrome'}:{});
  try{
   const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"reduce"}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));await fixture(page);
   await page.addInitScript(()=>{
    const original=window.fetch;
    window.fetch=async(input,init)=>{
     const response=await original(input,init),url=new URL(String(input),location.href);
     if(!['/api/providers','/api/groups'].includes(url.pathname))return response;
     const data=await response.json(),billing={state:'active',currency:'POINTS',source:'MaaS',coefficient:7,revision:'synthetic-v1'};
     if(data.providers)for(const p of data.providers)for(const m of p.models){m.routingBilling=m.id==='model-a'?billing:{state:'expired',currency:'POINTS',revision:'synthetic-v0'};m.rate=0.34;}
     if(data.models)for(const m of data.models)m.routingBilling=billing;
     if(data.groups)for(const g of data.groups)for(const m of g.memberInfo)m.routingBilling=billing;
     return Response.json(data);
    };
   });
   await page.goto('http://workspace.test/?view=providers');
   await page.evaluate(()=>openProvider('workbuddy'));
   const chip=page.locator('.mchip').filter({hasText:'示例模型 A'});
   await chip.getByText('MaaS 系数 7',{exact:true}).waitFor();
   await chip.getByText('官方积分 ×0.34',{exact:true}).waitFor();
   assert.notEqual(await chip.locator('.maas-points').evaluate(e=>getComputedStyle(e).boxShadow), 'none');
   assert.notEqual(await chip.locator('.rate').evaluate(e=>getComputedStyle(e).backgroundColor), await chip.locator('.maas-points').evaluate(e=>getComputedStyle(e).backgroundColor));
   await page.locator('.billing-legend').getByText(/两者属于独立额度池，系数不相乘/).waitFor();
   assert.match(await chip.getAttribute('title'),/共享额度范围未确认/);
   assert.match(await chip.getAttribute('title'),/synthetic-v1/);
   await page.locator('.mchip').filter({hasText:'示例模型 B'}).getByText('计费规则已过期',{exact:true}).waitFor();
   await page.screenshot({animations:"disabled",path:path.join(output,engine+'-points-provider.png')});
   for(const width of [420,1440]){
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   }
   await page.goto('http://workspace.test/?view=groups');await page.locator('#view-groups').waitFor({state:'visible'});
   await page.getByText('先用便宜模型；需要高推理或便宜模型都失败时，交给最强的模型',{exact:true}).waitFor();
   const note=page.getByText('先用便宜模型；需要高推理或便宜模型都失败时，交给最强的模型',{exact:true});
   assert.match(await note.getAttribute('title'),/MaaS 系数 7/);
   await page.screenshot({animations:"disabled",path:path.join(output,engine+'-points-groups.png')});
   for(const view of ['workspace','agents','providers','routing','groups','gateway','usage','sessions','plugins','settings']){
    await page.evaluate(view=>show(view),view);
    await page.locator('#view-'+view).waitFor({state:'visible'});
   }
   assert.deepEqual(errors,[]);await page.close();
   console.log(engine+': native billing chips, expired rules, pool uncertainty, restart, group explanations and narrow layout passed');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
