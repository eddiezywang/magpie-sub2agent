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
     if(data.providers)for(const p of data.providers)for(const m of p.models)m.routingBilling=m.id==='model-a'?billing:{state:'expired',currency:'POINTS',revision:'synthetic-v0'};
     if(data.models)for(const m of data.models)m.routingBilling=billing;
     if(data.groups)for(const g of data.groups)for(const m of g.memberInfo)m.routingBilling=billing;
     return Response.json(data);
    };
   });
   await page.goto('http://workspace.test/?view=providers');
   await page.evaluate(()=>openProvider('workbuddy'));
   const chip=page.locator('.mchip').filter({hasText:'示例模型 A'});
   await chip.getByText('MaaS · 积分系数 7',{exact:true}).waitFor();
   assert.match(await chip.getAttribute('title'),/共享额度范围未确认/);
   assert.match(await chip.getAttribute('title'),/synthetic-v1/);
   await page.locator('.mchip').filter({hasText:'示例模型 B'}).getByText('计费规则已过期',{exact:true}).waitFor();
   await page.screenshot({animations:"disabled",path:path.join(output,engine+'-points-provider.png')});
   for(const width of [420,1440]){
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   }
   await page.reload();await page.evaluate(()=>show('groups'));
   await page.getByText('成本偏好：确认免费 → 套餐额度 → 积分 → 按量付费 → 未知',{exact:true}).waitFor();
   const note=page.getByText('成本偏好：确认免费 → 套餐额度 → 积分 → 按量付费 → 未知',{exact:true});
   assert.match(await note.getAttribute('title'),/MaaS · 积分系数 7/);
   await page.screenshot({animations:"disabled",path:path.join(output,engine+'-points-groups.png')});
   assert.deepEqual(errors,[]);await page.close();
   console.log(engine+': native billing chips, expired rules, pool uncertainty, restart, group explanations and narrow layout passed');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
