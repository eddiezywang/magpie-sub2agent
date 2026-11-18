// Isolated opt-in preview: this does not start or modify a native window.
const {spawn}=require('node:child_process'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
(async()=>{const child=spawn(process.execPath,[path.join(__dirname,'retro-preview-server.cjs')],{env:{...process.env,RETRO_PREVIEW_PORT:'0'},stdio:['ignore','pipe','pipe']});try{
 const base=await new Promise((resolve,reject)=>{let s='';child.stdout.on('data',b=>{s+=b;const m=s.match(/Preview (http:\/\/127\.0\.0\.1:\d+)/);if(m)resolve(m[1])});child.on('error',reject);child.on('exit',code=>reject(Error('preview exited '+code)))});
 for(const engine of [chromium,webkit]){const browser=await(engine===chromium?engine.launch({channel:'chrome'}):engine.launch());try{for(const width of [1440,700]){const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/wails/runtime.js',r=>r.fulfill({contentType:'text/javascript',body:'window.calls=[];let max=false;export const Window={Minimise(){window.calls.push("min")},ToggleMaximise(){window.calls.push("max");max=!max},IsMaximised(){return max},Close(){window.calls.push("close")}};'}));
 await page.route('**/plugins/library/library.css*',r=>r.abort());
 await page.goto(base+'/?view=providers&retroframe=1');await page.locator('body.retro-frame').waitFor();
 const toggle=page.locator('#sideToggle'),word=page.locator('.retro-wordmark');await toggle.waitFor({state:'visible'});
 if(!await page.locator('body').evaluate(e=>e.classList.contains('side-nav')))await toggle.click();
 await word.waitFor({state:'visible'});
 await page.waitForFunction(() => [...document.fonts].some(f => f.family === 'BitrimusBrand' && f.status === 'loaded'));
 const font = await word.evaluate(e => { const s=getComputedStyle(e), c=document.createElement('canvas').getContext('2d'); c.font='24px BitrimusBrand'; const brand=c.measureText('Sub2Agent').width; c.font='24px sans-serif'; return {family:s.fontFamily, size:s.fontSize, mask:s.maskImage, brand, fallback:c.measureText('Sub2Agent').width}; });
 assert.match(font.family, /BitrimusBrand/); assert.equal(font.size,'24px'); assert.equal(font.mask,'none'); assert.notEqual(font.brand,font.fallback,'wordmark must use the loaded font'); assert.ok(await word.evaluate(e => e.scrollWidth <= e.clientWidth), 'wordmark must fit');
 if (process.env.RETRO_TITLE_SHOTS && width===1440) await page.screenshot({path:path.join(process.env.RETRO_TITLE_SHOTS,`${engine.name()}-expanded.png`)});
 await toggle.click();await word.waitFor({state:'hidden'});
 if (process.env.RETRO_TITLE_SHOTS && width===1440) await page.screenshot({path:path.join(process.env.RETRO_TITLE_SHOTS,`${engine.name()}-collapsed.png`)});assert.equal(await toggle.isVisible(),true);assert.ok(await page.locator('#nav button[data-view="providers"]').isVisible());
 const positions=await page.locator('.top .actions').evaluate(e=>({controls:e.querySelector('.retro-window-controls').getBoundingClientRect().right,prefs:e.querySelector('#prefs').getBoundingClientRect().right}));assert.ok(positions.controls>positions.prefs,'window buttons stay at the far right');
 await toggle.click();await word.waitFor({state:'visible'});
 for(const name of ['最小化','最大化','关闭'])await page.getByRole('button',{name,exact:true}).click();await page.getByRole('button',{name:'还原',exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>window.calls),['min','max','close']);
 await page.addScriptTag({path:path.join(__dirname,'../internal/gui/assets/workspace-i18n.js')});
 const sent=[];await page.route('**/api/window/**',r=>{sent.push(new URL(r.request().url()).pathname+new URL(r.request().url()).search);return r.fulfill({status:204})});
 await page.evaluate(()=>window.askCloseChoice());await page.getByText('选择关闭方式',{exact:true}).waitFor();
 const widths=await page.locator('.close-choice').evaluate(e=>({message:e.querySelector('p').offsetWidth,header:e.querySelector('.ehead').offsetWidth}));assert.ok(widths.message > widths.header * 0.8,'the close message spans the full dialog content width');
 await page.keyboard.press('Escape');await page.getByText('选择关闭方式',{exact:true}).waitFor({state:'hidden'});assert.deepEqual(sent,[]);
 await page.evaluate(()=>window.askCloseChoice());await page.getByRole('button',{name:'隐藏到后台',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.close-choice'));assert.deepEqual(sent,['/api/window/main-hide']);
 await page.evaluate(()=>window.askCloseChoice());await page.getByRole('button',{name:'退出并停止网关',exact:true}).click();await page.waitForTimeout(50);assert.deepEqual(sent,['/api/window/main-hide','/api/window/quit?now=1']);
 await page.keyboard.press('Escape');await page.evaluate(()=>setLocale('de'));await page.getByRole('button',{name:'Minimieren',exact:true}).waitFor();await page.getByRole('button',{name:'Wiederherstellen',exact:true}).waitFor();assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.goto(base+'/?view=providers');assert.equal(await page.locator('.retro-window-controls').count(),0,'not enabled without host flag');await page.close();console.log(engine.name(),width,'titlebar preview passed');
 }}finally{await browser.close()}}
}finally{child.kill()}})().catch(e=>{console.error(e);process.exitCode=1});
