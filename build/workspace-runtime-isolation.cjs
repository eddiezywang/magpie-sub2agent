// Actual packaged web process only; refuses paths without the isolated QA layout.
const {chromium}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(process.env.QA_RUNTIME||'');
 const qa=path.join(root,'qa-home'),config=path.join(qa,'XDG_CONFIG_HOME/sub2agent');
 const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
 assert.equal(manifest.profile,'intranet');
 const before=new Map();
 for(const name of ['settings.json','plugin-auth.json']){
  const file=path.join(qa,'XDG_CONFIG_HOME/magpie',name);before.set(file,await fs.readFile(file));
 }
 const key=(await fs.readFile(path.join(root,'qa-web-key.txt'),'utf8')).trim();
 const browser=await chromium.launch({channel:'chrome'});
 try{
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:19894/?k='+encodeURIComponent(key));
  await page.waitForFunction(()=>typeof state!=='undefined'&&state.settings);
  await page.evaluate(()=>show('settings'));
  await page.waitForFunction(()=>prefs!==null&&document.querySelector('#internalSettings'));
  const settings=await page.evaluate(()=>api('settings'));
  const dir=settings.dir.replace(/^~(?=[\\/])/,qa);
  assert.equal(path.resolve(dir).toLowerCase(),path.resolve(config).toLowerCase(),'uses isolated XDG sub2agent directory');
  const original=await fs.readFile(path.join(config,'settings.json'));
  const saved=JSON.parse(original.toString().replace(/^\uFEFF/,''));
  const was=saved.lightweight===true;
  try{
   const next=await page.evaluate(async on=>api('settings',{...prefsKeep(prefs),lightweight:on}),!was);
   assert.equal(next.lightweight,!was);
   const disk=JSON.parse((await fs.readFile(path.join(config,'settings.json'),'utf8')).replace(/^\uFEFF/,''));
   assert.equal(disk.lightweight,!was,'actual native API persists inside isolated data');
   assert.equal(disk.port,19893,'unrelated gateway port preserved');
   await page.reload();await page.waitForFunction(()=>typeof state!=='undefined'&&state.settings);
   await page.waitForFunction(()=>prefs!==null&&document.querySelector('#internalSettings'));
   assert.equal((await page.evaluate(()=>api('settings'))).lightweight,!was,'reload rereads persisted settings');
  }finally{
   await page.evaluate(async on=>api('settings',{...prefsKeep(prefs),lightweight:on}),was);
  }
  for(const [file,contents]of before)assert.deepEqual(await fs.readFile(file),contents,'original Magpie sentinel unchanged');
  const providers=await page.evaluate(()=>api('providers'));
  assert(!JSON.stringify(providers).includes('synthetic-original-credentials-do-not-import'));
  await fs.access(path.join(config,'settings.json'));
  console.log('Actual package: isolated XDG directory, settings write/reload/restore, original Magpie settings and auth sentinels unchanged');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
