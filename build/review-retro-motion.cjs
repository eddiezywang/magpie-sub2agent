// Exercise the intranet motion layer on synthetic data, including both
// ways a reader can ask for reduced motion. No host state or writes are used.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const {chromium,webkit}=require('playwright');

(async()=>{
 const child=spawn(process.execPath,[path.join(__dirname,'retro-preview-server.cjs')],{env:{...process.env,RETRO_PREVIEW_PORT:'0'},stdio:['ignore','pipe','pipe']});
 try {
  const url=await new Promise((resolve,reject)=>{let s='';child.stdout.on('data',b=>{s+=b;const m=s.match(/Preview (http:\/\/127\.0\.0\.1:\d+)/);if(m)resolve(m[1])});child.on('error',reject);child.on('exit',code=>reject(Error('preview exited: '+code)))});
  for(const engine of [chromium,webkit]){
   const browser=await (engine===chromium?engine.launch({channel:'chrome'}):engine.launch());
   try {for(const mode of ['normal','system-reduce','app-reduce']){
    const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:mode==='system-reduce'?'reduce':'no-preference'}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    try {
     await page.goto(url+'/?view=providers');
     const logo=page.locator('.brand .logo img');await logo.waitFor({state:'visible'});
     if(mode==='app-reduce')await page.evaluate(()=>document.documentElement.dataset.motion='reduce');
     await page.locator('.brand').hover();
     assert.equal(await logo.evaluate(e=>getComputedStyle(e).animationName),mode==='normal'?'retro-logo-lift':'none',`${engine.name()} ${mode} logo`);
     await page.goto(url+'/?view=routing&desktop=1');
     const hub=page.locator('.rt-hub'),mark=hub.locator('.rt-bird');await mark.waitFor({state:'visible'});
     if(mode==='app-reduce')await page.evaluate(()=>document.documentElement.dataset.motion='reduce');
     await hub.evaluate(e=>e.classList.add('tick'));
     assert.equal(await mark.evaluate(e=>getComputedStyle(e).animationName),mode==='normal'?'retro-route-mark':'none',`${engine.name()} ${mode} routing`);
     assert.deepEqual(errors,[]);
     console.log(`${engine.name()} ${mode}: motion verified`);
    }finally{await page.close()}
   }}finally{await browser.close()}
  }
 } finally{child.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
