// Compare the same real UI operations with and without the intranet skin.
// The preview server supplies synthetic data and blocks every write.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),path=require('node:path');
const {chromium,webkit}=require('playwright');

test('provider and routing group interactions preserve behavior under the retro skin',async t=>{
 const child=spawn(process.execPath,[path.join(__dirname,'retro-preview-server.cjs')],{env:{...process.env,RETRO_PREVIEW_PORT:'0'},stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());
 const url=await new Promise((resolve,reject)=>{let s='';child.stdout.on('data',b=>{s+=b;const m=s.match(/Preview (http:\/\/127\.0\.0\.1:\d+)/);if(m)resolve(m[1])});child.on('error',reject);child.on('exit',code=>reject(new Error('preview exited: '+code)))});
 for(const engine of [chromium,webkit]){
  const browser=await (engine===chromium?engine.launch({channel:'chrome'}):engine.launch());
  try{for(const width of [1440,420])for(const theme of ['light','dark']){
   const states=[];
   for(const retro of [false,true]){
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    if(!retro)await page.route('**/intranet-retro.css**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
    await page.goto(url+'/?view=providers&desktop=1&theme='+theme);
    const row=page.locator('#providers > .row.provider').first();await row.waitFor();
    const add=page.locator('#addProvider');await add.focus();assert.equal(await add.evaluate(e=>document.activeElement===e),true);
    await page.keyboard.press('Enter');await page.locator('#addSheet').waitFor({state:'visible'});
    const addText=await page.locator('#addSheet').innerText();
    await page.keyboard.press('Escape');await page.locator('#addSheet').waitFor({state:'hidden'});
    await row.locator('.who').click();await page.locator('.modal .dialog').waitFor();
    const editorText=await page.locator('.modal .dialog').innerText();
    const toggle=page.locator('.modal .dialog [role="switch"]').first();
    const state={addText,editorText,toggleCount:await page.locator('.modal .dialog [role="switch"]').count(),toggle:await toggle.count()?await toggle.getAttribute('aria-checked'):null,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)};
    await page.goto(url+'/?view=groups&desktop=1&theme='+theme);
    const group=page.locator('.rt-group',{hasText:'示例路由组'});await group.locator('.main').click();
    const head=page.locator('.rt-gedit .ehead');await head.waitFor();
    state.groupExpanded=await head.getAttribute('aria-expanded');
    assert.equal(state.groupExpanded,'true');
    await head.focus();await page.keyboard.press('Enter');await page.locator('.rt-gedit').waitFor({state:'detached'});
    state.groupFolded=await group.isVisible();
    assert.equal(state.groupFolded,true);
    assert.equal(state.overflow,false,`${engine.name()} ${theme} ${width}: overflow`);assert.deepEqual(errors,[]);
    states.push(state);await page.close();
   }
   assert.deepEqual(states[1],states[0],`${engine.name()} ${theme} ${width}: interaction content differs`);
   console.log(engine.name(),theme,width,'provider parity passed');
  }}finally{await browser.close()}
 }
});
