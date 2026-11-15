// Isolated opt-in preview: this does not start or modify a native window.
const {spawn}=require('node:child_process'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
(async()=>{const child=spawn(process.execPath,[path.join(__dirname,'retro-preview-server.cjs')],{env:{...process.env,RETRO_PREVIEW_PORT:'0'},stdio:['ignore','pipe','pipe']});try{
 const base=await new Promise((resolve,reject)=>{let s='';child.stdout.on('data',b=>{s+=b;const m=s.match(/Preview (http:\/\/127\.0\.0\.1:\d+)/);if(m)resolve(m[1])});child.on('error',reject);child.on('exit',code=>reject(Error('preview exited '+code)))});
 for(const engine of [chromium,webkit]){const browser=await(engine===chromium?engine.launch({channel:'chrome'}):engine.launch());try{for(const width of [1440,700]){const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/wails/runtime.js',r=>r.fulfill({contentType:'text/javascript',body:'window.calls=[];export const Window={Minimise(){window.calls.push("min")},ToggleMaximise(){window.calls.push("max")},Close(){window.calls.push("close")}};'}));
 await page.goto(base+'/?view=providers&retroframe=1');await page.locator('body.retro-frame').waitFor();
 const toggle=page.locator('#sideToggle'),word=page.locator('.retro-wordmark');await toggle.waitFor({state:'visible'});
 if(!await page.locator('body').evaluate(e=>e.classList.contains('side-nav')))await toggle.click();
 await word.waitFor({state:'visible'});await toggle.click();await word.waitFor({state:'hidden'});assert.equal(await toggle.isVisible(),true);assert.ok(await page.locator('#nav button[data-view="providers"]').isVisible());
 const positions=await page.locator('.top .actions').evaluate(e=>({controls:e.querySelector('.retro-window-controls').getBoundingClientRect().right,prefs:e.querySelector('#prefs').getBoundingClientRect().right}));assert.ok(positions.controls>positions.prefs,'window buttons stay at the far right');
 await toggle.click();await word.waitFor({state:'visible'});
 for(const name of ['最小化','最大化','关闭'])await page.getByRole('button',{name,exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.calls),['min','max','close']);await page.evaluate(()=>setLocale('de'));await page.getByRole('button',{name:'Minimieren',exact:true}).waitFor();assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.goto(base+'/?view=providers');assert.equal(await page.locator('.retro-window-controls').count(),0,'not enabled without host flag');await page.close();console.log(engine.name(),width,'titlebar preview passed');
 }}finally{await browser.close()}}
}finally{child.kill()}})().catch(e=>{console.error(e);process.exitCode=1});
