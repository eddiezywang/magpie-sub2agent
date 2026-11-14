const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {execFileSync}=require('node:child_process');const {chromium,webkit}=require('playwright');
test('static demo renders synthetic routing without sending API requests',async t=>{
 const source=process.env.INTRANET_ASSETS;assert.ok(source,'INTRANET_ASSETS must point at extracted packed assets');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retro-export-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const out=path.join(root,'demo');execFileSync(process.execPath,[path.join(__dirname,'export-retro-motion-demo.cjs'),source,out]);
 const leaked=[];const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
 const server=http.createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');if(!u.pathname.startsWith('/retro-motion-demo/')){leaked.push(u.pathname);res.writeHead(404).end();return}const rel=u.pathname.slice('/retro-motion-demo/'.length)||'index.html',file=path.resolve(out,rel);if(!file.startsWith(out+path.sep)){res.writeHead(403).end();return}try{const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'}).end(data)}catch{res.writeHead(404).end()}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());const url=`http://127.0.0.1:${server.address().port}/retro-motion-demo/?view=routing`;
 for(const engine of [chromium,webkit]){const browser=await(engine===chromium?engine.launch({channel:'chrome'}):engine.launch());try{const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('.rt-hub .rt-bird').waitFor({state:'visible'});await page.getByText('视觉预览 · 模拟数据').waitFor();assert.equal(await page.locator('#view-routing .slot-error:visible').count(),0);assert.match(await page.locator('#view-routing').innerText(),/示例模型/);const checks=await page.evaluate(async()=>Promise.all(['/api/settings','/api/gateway/trace?wait=1'].map(u=>fetch(u,{method:'POST'}).then(r=>r.status))));assert.deepEqual(checks,[403,403]);assert.deepEqual(errors,[]);await page.close()}finally{await browser.close()}}
 assert.deepEqual(leaked,[],'API or other request escaped the static demo');
});
