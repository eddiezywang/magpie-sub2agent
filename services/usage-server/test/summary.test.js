 'use strict';
const {test:nodeTest}=require('node:test');
// Node 18's early test runner has no TestContext.after. Keep explicit cleanup.
const test=(name,run)=>nodeTest(name,async()=>{const cleanup=[];try{await run({after:f=>cleanup.push(f)});}finally{for(const f of cleanup.reverse())await f();}});
const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const http=require('node:http');
const fetch=(url,options={})=>new Promise((resolve,reject)=>{const req=http.request(url,{method:options.method||'GET',headers:options.headers},res=>{let body='';res.setEncoding('utf8');res.on('data',s=>body+=s);res.on('end',()=>resolve({status:res.statusCode,text:async()=>body,json:async()=>JSON.parse(body)}));});req.on('error',reject);req.end(options.body);});
const {createSummaryStore,SCHEMA,counters}=require('../src/summary-store');
const {renderReportCardSvg}=require('../src/card');
const {hitRate}=require('../src/magpie-day');
const {agentIcon}=require('../src/icon-names');
const {createPricingStore,computeCost}=require('../src/pricing');

test('OpenAI SDK usage has the OpenAI mark without being relabeled as Codex',()=>{
 assert.equal(agentIcon('OpenAI'),'openai');
 assert.equal(agentIcon('openai-client'),'openai');
 assert.equal(agentIcon('codex'),'codex-color');
 assert.equal(agentIcon('unknown-sdk'),'');
 const svg=renderReportCardSvg({period:{type:'daily'},totals:{requests:1},by_agent_model:[{agent:'openai',models:[]}]});
 assert.ok(svg.includes('OPENAI'));
});

test('cache hit rate accepts the report view with an omitted zero unknown counter',()=>{
 const view={input:100,cacheRead:300,cacheWrite:0};
 assert.equal(hitRate(view),0.75);
 assert.equal(hitRate({...view,cacheUnknown:400}),null);
 assert.equal(hitRate({...view,cacheUnknown:100}),1);
});

test('receipt distinguishes unpriced usage, plan tokens and points from zero USD',()=>{
 const base={user:{name:'fixture-user'},period:{type:'daily',start:'2026-11-13',end:'2026-11-13',generated_at:'2026-11-13T12:00:00Z'},totals:{requests:2,input_tokens:100,output_tokens:10,cost_usd:0,unpriced_requests:2},stats:{},by_agent_model:[]};
 const render=(amounts,pending)=>renderReportCardSvg({...base,billing:{amounts_by_currency:amounts,unpriced_attempts:pending}}).replace(/<[^>]*>/g,'');
 const missing=render({},2);assert.match(missing,/fixture-user/);assert.match(missing,/待定价/);assert.match(missing,/未定价不代表免费/);assert.doesNotMatch(missing,/\$0/);
 const plan=render({PLAN_TOKENS:110},0);assert.match(plan,/计划折算 token/);assert.doesNotMatch(plan,/\$0/);
 const points=render({POINTS:220},0);assert.match(points,/积分/);assert.doesNotMatch(points,/\$0/);
 const mixed=render({POINTS:220,PLAN_TOKENS:110},1);assert.match(mixed,/分项统计/);assert.match(mixed,/含待定价用量/);assert.doesNotMatch(mixed,/\$0/);
 const free=render({USD:0},0);assert.match(free,/\$0/);assert.doesNotMatch(free,/待定价/);
});
const {createBillingPolicy}=require('../src/billing-policy');
const {createUsageServer}=require('../src/server');
const fixed=()=>new Date('2026-11-13T08:20:00Z');
const identity={install_id:'fixture-device',username:'fixture-user'};
const group=()=>({...Object.fromEntries(counters.map(k=>[k,0])),agent:'codex',provider:'sub2agent-workbuddy',model:'glm-5.3-flash-maas-fixture',model_source:'served',service_tier:'',rules_revision:'internal-2026-11-13-1',context_tier:'base',attempts:100,requests:98,success:90,failed:8,canceled:2,handed_on:2,input_tokens:1000,output_tokens:500,cache_read_tokens:250,cache_write_5m_tokens:50,cache_write_1h_tokens:20,reasoning_tokens:100,duration_ms_sum:300000,duration_samples:100,ttft_ms_sum:25000,ttft_samples:100});
const summary=(id='fixture-summary',g=group())=>({id,minute:'2026-11-13T08:15:00Z',groups:[g]});
const temp=t=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'usage-v3-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;};
test('durable minute summaries deduplicate by install/id, reject conflicts and survive restart',t=>{
 const dataDir=temp(t);let s=createSummaryStore({dataDir,now:fixed});
 assert.equal(s.append(identity,summary()),'accepted');assert.equal(s.append(identity,summary()),'duplicate');
 const changed=summary();changed.groups[0].input_tokens++;assert.equal(s.append(identity,changed),'rejected');
 assert.equal(s.append({...identity,install_id:'other-device'},summary()),'accepted');
 s=createSummaryStore({dataDir,now:fixed});assert.equal(s.append(identity,summary()),'duplicate');
 assert.equal(s.projected('20261113','20261113').reduce((n,r)=>n+r.requests,0),196);
 const bad=summary('bad');bad.groups[0].reasoning_tokens=9999;assert.equal(s.append(identity,bad),'rejected');
 assert.equal(s.append(identity,{...summary('bad-date'),minute:8}),'rejected');
 assert.equal(s.append(identity,{...summary('old'),minute:'2020-01-01T00:00:00Z'}),'rejected');
});
test('torn append preserves tail; complete corrupt records refuse startup',t=>{
 const dataDir=temp(t);const s=createSummaryStore({dataDir,now:fixed});s.append(identity,summary());
 const dir=path.join(dataDir,'minute-summaries');const file=path.join(dir,fs.readdirSync(dir)[0]);fs.appendFileSync(file,'{"torn":');
 assert.doesNotThrow(()=>createSummaryStore({dataDir,now:fixed}));assert.ok(fs.readdirSync(dir).some(n=>n.includes('.partial-')));
 fs.appendFileSync(file,'bad complete row\n');assert.throws(()=>createSummaryStore({dataDir,now:fixed}));
});
test('server pricing keeps points separate, applies China weekday time and promotion expiry',t=>{
 const billing=createBillingPolicy({dataDir:temp(t)});const g=group();
 assert.equal(billing.charge(g,summary().minute).amount,1820);
 const plan={...g,provider:'sub2agent-tigcodingplan',model:'glm-5.3-flash-zp'};
 assert.equal(billing.charge(plan,'2026-11-13T06:00:00Z').amount,910);
 assert.equal(billing.charge(plan,'2026-11-13T10:00:00Z').amount,1820);
 assert.equal(billing.charge(plan,'2026-11-14T06:00:00Z').amount,1820);
 assert.equal(billing.charge({...g,context_tier:'unclassified',rules_revision:''},summary().minute).amount,1820);
 let next=billing.snapshot();next.models[0].valid_until='2026-11-14T00:00:00Z';assert.throws(()=>billing.set(next));next.revision='policy-2';billing.set(next);
 assert.equal(billing.charge({...g,model:'hy4free'},'2026-11-13T08:00:00Z').amount,0);
 assert.equal(billing.charge({...g,model:'hy4free'},'2026-11-14T00:00:00Z').priced,false);
 next=billing.snapshot();next.revision='policy-3';next.models.find(r=>r.model==='glm-5.3-flash-maas').above=[200000];billing.set(next);
 assert.equal(billing.charge(g,summary().minute).reason,'context_rules_changed');
});
test('real HTTP accepts explicit IDs, preserves old telemetry and generates weighted reports across devices',async t=>{
 const app=createUsageServer({host:'127.0.0.1',port:0,dataDir:temp(t),now:fixed,adminToken:'fixture-admin'});
 const port=await app.start();t.after(()=>app.stop());const base='http://127.0.0.1:'+port;
 const post=async(body,url='/usage/events')=>{const r=await fetch(base+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 assert.deepEqual((await fetch(base+'/healthz').then(r=>r.json())).usage_schemas,[SCHEMA]);
 const rules=await fetch(base+'/usage/aggregation-rules').then(r=>r.json());assert.ok(rules.models.length);
 const routing=await fetch(base+'/usage/routing-catalog').then(r=>r.json());
 assert.ok(Date.parse(routing.expires_at)>Date.now());
 assert.equal(routing.models.find(r=>r.model==='hy4free').score,0);
 assert.equal(routing.models.find(r=>r.model==='deepseek-v4-pro-maas').score,8.5);
 assert.ok(routing.models.every(r=>!('currency' in r)&&!('weekday_afternoon_factor' in r)));
 const payload={schema:SCHEMA,...identity,summaries:[summary()]};
 assert.deepEqual((await post(payload)).body.accepted_ids,['fixture-summary']);
 assert.deepEqual((await post(payload)).body.duplicate_ids,['fixture-summary']);
 assert.equal((await post({...payload,install_id:'other-device'})).status,200);
 assert.equal((await post({event:'desktop_app_start',...identity,timestamp:fixed().toISOString()},'/events')).status,200);
 const report=await fetch(base+'/reports/fixture-user/daily.json?date=2026-11-13').then(r=>r.json());
 assert.equal(report.totals.requests,196);assert.equal(report.totals.input_tokens,2000);assert.equal(report.day.calls,196);
 assert.equal(report.billing.amounts_by_currency.POINTS,3640);assert.ok(report.totals.cost_usd>0);
 assert.equal(report.valuation.currency,'CNY');assert.equal(report.valuation.unpriced_attempts,0);
 assert.equal(report.by_model[0].requests,196);assert.equal(report.day.ttftMs,50000);assert.equal(report.day.timed,200);
 const svg=await fetch(base+'/reports/fixture-user/daily.svg?date=2026-11-13');assert.equal(svg.status,200);const svgText=await svg.text();assert.match(svgText,/<svg/);assert.ok(!svgText.includes('NaN%'),'cache rate must be numeric or unavailable');
 const weekly=await fetch(base+'/reports/fixture-user/weekly.json?date=2026-11-13').then(r=>r.json());assert.equal(weekly.totals.requests,196);
 const bad=summary('bad');bad.groups[0].input_tokens=-1;assert.deepEqual((await post({...payload,summaries:[bad]})).body.rejected_ids,['bad']);
 assert.equal((await post({...payload,summaries:[summary(),summary()]})).status,400);
 assert.equal((await fetch(base+'/admin/billing-policy')).status,401);
});

test('legacy minute totals use maker prices by exact model and managed deployment suffix, without a context revision',t=>{
 const dataDir=temp(t);const prices=createPricingStore({dataDir,now:fixed});
 const g={...group(),provider:'legacy-fixture',model:'glm-5.3-flash-zp',context_tier:'unclassified',rules_revision:''};
 const tokens={...g,_summary:g,cache_write_tokens:70,ts:summary().minute};
 const expected=(1000*0.11952+500*0.41831+250*0.03436)/1e6;
 for(const model of ['glm-5.3-flash-zp','glm-5.3-flash-zp-openai','sub2agent-tigcodingplan/glm-5.3-flash-zp','glm-5.3-flash-maas-fixture-user']){
  const cost=prices.costFor(model,tokens);assert.equal(cost.priced,true,model);assert.equal(cost.cost,expected,model);
 }
 assert.equal(prices.costFor('glm-5.3-flash-lite-zp',tokens).priced,false);
 const billing=createBillingPolicy({dataDir,listPrice:(g,minute)=>prices.costFor(g.model,{...g,_summary:g,ts:minute,cache_write_tokens:70})});
 assert.equal(billing.charge(g,summary().minute).amount,expected);
 prices.setModels({'glm-5.3-flash-zp':{input:2,output:3,cache_read:1,cache_write:0}});
 assert.equal(prices.costFor(g.model,tokens).cost,(1000*2+500*3+250)/1e6);
 assert.equal(createPricingStore({dataDir,now:fixed}).costFor(g.model,tokens).cost,(1000*2+500*3+250)/1e6);
});

test('maker pricing preserves cache accounting and never applies request-size tiers to a minute sum',()=>{
 const table={models:{'fixture-model':{input:1,output:2,cache_read:.1,cache_write:1.25,tiers:[{above:200,input:2,output:4,cache_read:.2,cache_write:2.5}]}}};
 const tokens={input_tokens:100,output_tokens:50,cache_read_tokens:150,cache_write_tokens:0,reasoning_tokens:40};
 assert.ok(Math.abs(computeCost(table,'fixture-model',tokens).cost-(100*2+50*4+150*.2)/1e6)<1e-12);
 assert.equal(computeCost(table,'fixture-model',{...tokens,_summary:{}}).priced,false);
 const claude={models:{'claude-fixture':{input:3,output:15,cache_read:.3,cache_write:3.75}}};
 assert.ok(Math.abs(computeCost(claude,'claude-fixture',{input_tokens:0,output_tokens:0,cache_read_tokens:0,cache_write_tokens:100,cache_write_1h_tokens:40}).cost-(60*3.75+40*6)/1e6)<1e-12);
});

test('HTTP legacy receipt shows CNY model valuation and keeps the exchange rate server-maintained',async t=>{
 const dataDir=temp(t);const app=createUsageServer({host:'127.0.0.1',port:0,dataDir,now:fixed,adminToken:'fixture-admin'});
 const port=await app.start();t.after(()=>app.stop());const base='http://127.0.0.1:'+port;
 const g={...group(),provider:'legacy-fixture',model:'glm-5.3-flash-zp',context_tier:'unclassified',rules_revision:''};
 const post=await fetch(base+'/usage/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({schema:SCHEMA,...identity,summaries:[summary('legacy',g)]})});assert.equal(post.status,200);
 const report=await fetch(base+'/reports/fixture-user/daily.json?date=2026-11-13').then(r=>r.json());
 assert.ok(report.billing.amounts_by_currency.USD>0);assert.equal(report.billing.unpriced_attempts,0);
 assert.equal(report.valuation.currency,'CNY');assert.ok(report.valuation.amount>0);assert.equal(report.totals.unpriced_requests,0);
 const svg=(await fetch(base+'/reports/fixture-user/daily.svg?date=2026-11-13').then(r=>r.text())).replace(/<[^>]*>/g,'');
 assert.ok(svg.includes('¥'));assert.ok(svg.includes('人民币'));assert.ok(!svg.includes('待定价'));assert.ok(!svg.includes('$'));
 const url=base+'/admin/report-currency';assert.equal((await fetch(url)).status,401);
 const update=body=>fetch(url,{method:'PUT',headers:{authorization:'Bearer fixture-admin','content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await update({currency:'CNY',usd_to_cny:0,as_of:'2026-11-13',source:'fixture'})).status,400);
 assert.equal((await update({currency:'CNY',usd_to_cny:7,as_of:'2026-11-13',source:'fixture'})).status,200);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir,'report-currency.json'),'utf8')).usd_to_cny,7);
 assert.equal((await fetch(base+'/reports/fixture-user/daily.json?date=2026-11-13').then(r=>r.json())).valuation.usd_to_cny,7);
});

test('additional listener shares summary deduplication and closes with the service',async t=>{
 const net=require('node:net');const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const aliasPort=probe.address().port;await new Promise(r=>probe.close(r));
 const app=createUsageServer({host:'127.0.0.1',port:0,dataDir:temp(t),now:fixed});await app.start();t.after(()=>app.stop());
 await app.listenAlias(aliasPort);assert.equal((await fetch('http://127.0.0.1:'+aliasPort+'/healthz')).status,200);
});
