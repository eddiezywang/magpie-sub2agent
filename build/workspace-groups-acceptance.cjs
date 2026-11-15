// Exercise the retained native group editor and its API contract, isolated only.
const {chromium,webkit}=require('playwright'),{open}=require('./workspace-acceptance.cjs');
const {reach}=require('../internal/gui/tests/reader.cjs');
const assert=require('node:assert/strict');
(async()=>{for(const [engine,type]of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch(engine==='chromium'?{channel:'chrome'}:{});
 try{
  const page=await open(browser);
  await page.evaluate(()=>{
   const original=window.fetch;qa.groupWrites=[];
   window.fetch=async(input,init={})=>{
    const url=new URL(String(input),location.href);
    if(init.method==='POST'&&/^\/api\/groups\/(save|switch|delete)$/.test(url.pathname)){
     const body=JSON.parse(init.body);qa.groupWrites.push({path:url.pathname,body});
     if(qa.refuseGroupSave&&url.pathname.endsWith('/save'))return Response.json({error:'Synthetic group save refused'},{status:409});
     const rows=workspaceSamples.groups,index=rows.findIndex(g=>g.id===(body.from||body.id));
     if(url.pathname.endsWith('/save')){const g={...body,ref:'group/'+body.id,ready:true,memberInfo:body.members.map(id=>({id,ready:true}))};if(index<0)rows.push(g);else rows[index]=g;}
     if(url.pathname.endsWith('/switch'))rows[index].disabled=!body.on;
     if(url.pathname.endsWith('/delete'))rows.splice(index,1);
     return original('/api/groups');
    }
    return original(input,init);
   };
  });
  await page.evaluate(()=>show('groups'));
  await page.evaluate(()=>window.newGroupWith('workbuddy/model-a','Review group'));
  const editor=page.locator('#view-groups .rt-gedit'),save=editor.getByRole('button',{name:'保存',exact:true});
  await editor.waitFor();const add=editor.getByRole('button',{name:'添加',exact:true});await reach(page,add);await add.click();
  const row=page.locator('#view-groups .rt-group[data-id=review-group]');await row.waitFor();
  assert.deepEqual(await page.evaluate(()=>qa.groupWrites[0].body.members),['workbuddy/model-a']);
  await row.getByRole('button',{name:'编辑',exact:true}).click();
  await editor.locator('input').first().fill('Renamed review group');
  await page.evaluate(()=>qa.refuseGroupSave=true);await reach(page,save);await save.click();
  await page.getByText('Synthetic group save refused',{exact:true}).waitFor();
  assert.equal(await editor.locator('input').first().inputValue(),'Renamed review group');
  await page.evaluate(()=>qa.refuseGroupSave=false);await save.click();
  await editor.waitFor({state:'detached'});await row.getByText('Renamed review group',{exact:true}).waitFor();
  await row.getByRole('switch').click();await page.waitForFunction(()=>document.querySelector('.rt-group[data-id="review-group"] [role=switch]')?.getAttribute('aria-checked')==='false');
  await row.getByRole('switch').click();await page.waitForFunction(()=>!workspaceSamples.groups.find(g=>g.id==='review-group').disabled);
  await row.getByRole('button',{name:'编辑',exact:true}).click();
  const remove=editor.locator('.bar .danger');await reach(page,remove);await remove.click();
  const confirm=page.locator('.action-confirm').getByRole('button',{name:'移除',exact:true});await confirm.waitFor();await confirm.click();
  await row.waitFor({state:'detached'});
  assert.deepEqual(page.errors,[]);await page.close();
  console.log(`${engine}: native group create, failed edit/retry, switch and confirmed delete passed`);
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
