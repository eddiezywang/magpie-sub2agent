// Exercises the packaged executable against a local protocol fixture.
const {chromium}=require('playwright');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const [data,output]=process.argv.slice(2);
 const {key}=JSON.parse(await fs.readFile(path.join(data,'web-page.json'),'utf8'));
 const requests=[];
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req) raw+=chunk;
  requests.push(req.method+' '+req.url);
  res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/models') return res.end(JSON.stringify({data:[{id:'gpt-test'}]}));
  if(req.url==='/v1/responses'&&req.method==='POST') {
   assert.equal(req.headers.authorization,'Bearer fixture-live-key');
   assert.ok(Array.isArray(JSON.parse(raw).input));
   return res.end(JSON.stringify({object:'response',status:'completed',output:[]}));
  }
  res.statusCode=404;res.end(JSON.stringify({error:{message:'Unsupported protocol'}}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port+'/v1';
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto('http://127.0.0.1:18990/?view=providers&k='+encodeURIComponent(key));
  if(!await page.locator('#addSheet [data-pick=custom]').isVisible()) await page.locator('#addProvider').click();
  await page.locator('#addSheet [data-pick=custom]').click();
  const editor=page.locator('.editor.new');
  await editor.locator('.auto-gateway-status').waitFor();
  await editor.locator('input').first().fill('协议自动识别验证');
  await editor.locator('.base-url').fill(base);
  await editor.locator('input[type=password]:visible').fill('fixture-live-key');
  assert.equal(await editor.locator('[data-api]:visible').count(),0);
  await page.mouse.move(1400,20);await page.waitForTimeout(350);
  await page.screenshot({path:path.join(output,'15-live-custom-auto.png'),fullPage:true});
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/provider/save'));
  await editor.getByRole('button',{name:'添加',exact:true}).click();
  const response=await saved;assert.ok(response.ok());
  const body=response.request().postDataJSON();
  assert.equal(body.responses,base);
  for(const protocol of ['chat','anthropic','gemini']) assert.ok(!body[protocol]);
  assert.equal(body.baseAPI,'responses');
  assert.ok(requests.includes('POST /v1/responses'));
  const report={packagedUI:true,realDetectionAPI:true,successfulProtocol:'responses',unsupportedProtocolsSaved:false,requests};
  await fs.writeFile(path.join(output,'15-live-custom-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
