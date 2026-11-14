import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createSub2AgentPlugin,readBundle} from '../../build/sub2agent-runtime/factory-test.mjs';

const client={auth:{set:async()=>{throw new Error('Unexpected credential write');}}};
const models={models:['Enterprise Model'],defaultModel:'Enterprise Model',modelMap:{'Enterprise Model':'vendor-model'}};
const sse=()=>new Response('data: {"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});

test('WorkBuddy MaaS emits estimated usage before DONE and preserves real upstream usage',async()=>{
 for(const reported of [null,{prompt_tokens:1234,completion_tokens:17,total_tokens:1251}]) {
  const model='glm-5.3-maas-fixture';
  const auth={type:'oauth',access:JSON.stringify({models:[model],defaultModel:model,accessToken:'fixture',expiresAt:Date.now()+3600000,userId:'u',enterpriseId:'e'})};
  const plugin=await createSub2AgentPlugin('workbuddy',{client},{workbuddyAdapter:{},fetchImpl:async(_url,opts)=>{
   assert.equal(JSON.parse(opts.body).stream_options.include_usage,true);
   const text='data: '+JSON.stringify({id:'fixture',model,choices:[{index:0,delta:{content:'你好，已完成分析。'},finish_reason:null}]})+'\n\n'
    +'data: '+JSON.stringify({id:'fixture',model,choices:[{index:0,delta:{},finish_reason:'stop'}],...(reported?{usage:reported}:{})})+'\n\n'
    +'data: [DONE]\n\n';
   return new Response(text,{headers:{'Content-Type':'text/event-stream'}});
  }});
  const loader=await plugin.auth.loader(async()=>auth);
  const response=await loader.fetch('https://sub2agent.invalid/v1/chat/completions',{body:JSON.stringify({model,stream:true,stream_options:{include_usage:true},messages:[{role:'user',content:'请分析项目代码与工具调用结果。'}],tools:[{type:'function',function:{name:'read_file',parameters:{type:'object',properties:{path:{type:'string'}}}}}]})});
  const text=await response.text();
  const frames=text.split('\n\n').filter(s=>s.startsWith('data: {')).map(s=>JSON.parse(s.slice(6)));
  const usage=frames.findLast(s=>s.usage)?.usage;
  assert.ok(usage?.prompt_tokens>0,'Agent needs a nonzero input estimate');
  assert.ok(usage.completion_tokens>0);
  assert.equal(usage.total_tokens,usage.prompt_tokens+usage.completion_tokens);
  assert.ok(text.indexOf('"usage"')<text.indexOf('[DONE]'));
  if(reported)assert.deepEqual(usage,reported,'real counts must not be overwritten');
  else assert.equal(frames.findLast(s=>s.usage).usage_source,'estimated');
 }
});

test('WorkBuddy keeps smaller deployment limits, caps MaaS Agent windows and coalesces accounts',async()=>{
 let calls=0,now=0,offline=false;
 const auth={access:JSON.stringify({accessToken:'fixture',userId:'u',enterpriseId:'e',models:['old'],modelMap:{old:'old'}})};
 const plugin=await createSub2AgentPlugin('workbuddy',{client},{now:()=>now,fetchImpl:async(url)=>{
  calls++;
  if(offline)throw new Error('fixture outage');
  const data=url.endsWith('/v3/config')?{agents:[{name:'craft',models:['glm-turbo']}],models:[{id:'glm-turbo',name:'GLM-5.0-Turbo',maxAllowedSize:200000,maxInputTokens:180000,maxOutputTokens:64000}]}:
   [{id:'tenant-model',name:'glm-5.3-flash-maas-fixture',maxAllowedSize:1000000,maxInputTokens:300000,maxOutputTokens:32000}, {id:'auto',name:'auto-maas-fixture'}];
  return Response.json({code:0,data});
 }});
 const [a,b]=await Promise.all([plugin.provider.models({models:{}},{auth}),plugin.provider.models({models:{}},{auth})]);
 assert.equal(calls,2,'one pair of discovery requests per account');
 assert.deepEqual(a,b);
 assert.deepEqual(a['glm-5.3-flash-maas-fixture'].limit,{context:132000,input:100000,output:32000});
 assert.equal(a['GLM-5.0-Turbo'].limit.input,180000);
 assert.equal(a.hy4free.limit.input,960000);
 assert.equal(a.hy4free.limit.output,64000);
 assert.equal(a['auto-maas-fixture'].limit.input,100000,'Auto also needs a transport budget');
 assert.equal(a.hy4free.cost,undefined,'vendor discovery must not replace server pricing');
 const other={access:JSON.stringify({...readBundle(auth),enterpriseId:'other'})};
 await plugin.provider.models({models:{}},{auth:other});assert.equal(calls,4,'accounts must not share tenant limits');
 offline=true;now=6*60_000;
 const retained=await plugin.provider.models({models:{}},{auth});
 assert.equal(retained['glm-5.3-flash-maas-fixture'].limit.input,100000,'outage must retain the safe budget');
});

test('WorkBuddy MaaS budget follows wire model aliases without reducing ordinary models',async()=>{
 const auth={access:JSON.stringify({userId:'u',enterpriseId:'e',models:['tenant-alias','ordinary'],modelMap:{'tenant-alias':'glm-5.3-maas-tenant'},modelMetadata:{ordinary:{limit:{context:1000000,input:900000,output:64000}}}})};
 const plugin=await createSub2AgentPlugin('workbuddy',{client},{fetchImpl:async()=>{throw new Error('offline fixture');}});
 const listed=await plugin.provider.models({models:{}},{auth});
 assert.deepEqual(listed['tenant-alias'].limit,{context:132000,input:100000,output:32000});
 assert.equal(listed.ordinary.limit.input,900000);
 assert.equal(listed['tenant-alias'].cost,undefined,'a safe context budget is not a pricing change');
});

test('WorkBuddy unavailable discovery retains known metadata without writing credentials',async()=>{
 const auth={access:JSON.stringify({userId:'u',enterpriseId:'e',models:['custom-maas-fixture','auto-maas-fixture'],modelMetadata:{'custom-maas-fixture':{limit:{context:64000,input:60000,output:4000}}}})};
 const plugin=await createSub2AgentPlugin('workbuddy',{client},{fetchImpl:async()=>{throw new Error('fixture outage');}});
 const a=await plugin.provider.models({models:{}},{auth});
 assert.equal(a['custom-maas-fixture'].limit.input,60000);
 assert.equal(a.hy4free.limit.input,960000);
 assert.equal(a['auto-maas-fixture'].limit.input,100000);
});

test('WorkBuddy manual callback validates vendor and session while automatic login continues',async()=>{
 let ready=false,polls=0;
 const adapter={requestLoginLink:async()=>({url:'https://login.example.invalid',state:'fixture-state'}),
  pollToken:async()=>{polls++;return ready?{accessToken:'fixture-access'}:null;},
  resolveAccount:async(state,token)=>({...token,userId:'fixture-user',enterpriseId:'fixture-tenant'}),listModels:async()=>models};
 const plugin=await createSub2AgentPlugin('workbuddy',{client},{workbuddyAdapter:adapter});
 const auth=await plugin.auth.methods[0].authorize();
 assert.equal(typeof auth.submitCallback,'function');
 const callback='https://www.workbuddy.cn/login/?platform=workbuddy&state=fixture-state&version=2.0.0&force_login_type=sso&loginSessionId=fixture';
 for(const invalid of [callback.replace('fixture-state','other-session'),callback.replace('www.workbuddy.cn','evil.invalid'),callback+'&state=other',callback.replace('/login/','/other/'),'not a URL']) {
  await assert.rejects(auth.submitCallback(invalid));
 }
 assert.equal(polls,0,'invalid callbacks must not reach the vendor');
 const finished=auth.callback();
 await new Promise(resolve=>setTimeout(resolve,20));
 ready=true;
 await auth.submitCallback(callback);
 const result=readBundle(await finished);
 assert.equal(result.enterpriseId,'fixture-tenant');
 assert.ok(polls>=2);
});

test('WorkBuddy enterprise login keeps tenant identity and discovered models',async()=>{
 const adapter={requestLoginLink:async()=>({url:'https://login.example.invalid',state:'test-state'}),
  pollToken:async state=>(assert.equal(state,'test-state'),{accessToken:'test-access'}),
  resolveAccount:async(state,token)=>({...token,userId:'test-user',enterpriseId:'test-tenant'}),listModels:async()=>models};
 const plugin=await createSub2AgentPlugin('workbuddy',{client},{workbuddyAdapter:adapter});
 const auth=await plugin.auth.methods[0].authorize();
 assert.equal(auth.method,'auto');
 const result=await auth.callback();
 const bundle=readBundle(result);
 assert.equal(bundle.enterpriseId,'test-tenant');
 assert.deepEqual(bundle.modelMap,models.modelMap);
 const listed=await plugin.provider.models({models:{}},{auth:result});
 assert.deepEqual(Object.keys(listed),[...models.models,"hy4free"]);
});

test('WorkBuddy concurrent requests share refresh and retain private request headers',async()=>{
 let auth={type:'oauth',access:JSON.stringify({...models,accessToken:'old',refreshToken:'refresh',expiresAt:1,userId:'u1',enterpriseId:'e1'})};
 let renewals=0,writes=0;const sent=[];
 const adapter={async refresh(bundle){renewals++;await new Promise(r=>setTimeout(r,10));return {...bundle,accessToken:'fresh',expiresAt:Date.now()+3600000};}};
 const plugin=await createSub2AgentPlugin('workbuddy',{client:{auth:{set:async({path,body})=>{assert.equal(path.id,'sub2agent-workbuddy');auth=body;writes++;}}}},
  {workbuddyAdapter:adapter,fetchImpl:async(url,opts)=>{sent.push({url,headers:opts.headers,body:JSON.parse(opts.body)});return sse();}});
 const loader=await plugin.auth.loader(async()=>auth);
 const req={body:JSON.stringify({model:'Enterprise Model',messages:[{role:'user',content:'hello'}],stream:true})};
 const responses=await Promise.all([loader.fetch('https://sub2agent.invalid/v1/chat/completions',req),loader.fetch('https://sub2agent.invalid/v1/chat/completions',req)]);
 for(const response of responses)assert.match(await response.text(),/ok/);
 assert.equal(renewals,1);assert.equal(writes,1);
 for(const request of sent){assert.equal(request.body.model,'vendor-model');assert.equal(request.body.stream,true);
  assert.equal(request.headers['X-User-Id'],'u1');assert.equal(request.headers['X-Enterprise-Id'],'e1');assert.equal(request.headers.Authorization,'Bearer fresh');}
});

test('WorkBuddy sends exactly one authorization value over real HTTP, including after 401 refresh',async()=>{
 let auth={type:'oauth',access:JSON.stringify({...models,accessToken:'old',refreshToken:'refresh',expiresAt:Date.now()+3600000,userId:'test-user',enterpriseId:'test-enterprise'})};
 const seen=[];
 const server=http.createServer(async(req,res)=>{
  let data='';for await(const chunk of req)data+=chunk;
  seen.push({headers:req.headers,body:JSON.parse(data)});
  if(req.headers.authorization!=='Bearer fresh') {
   res.writeHead(401,{'Content-Type':'text/html'});res.end('<h1>401 Authorization Required</h1>');return;
  }
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(await sse().text());
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let refreshed=0;
 try {
  const plugin=await createSub2AgentPlugin('workbuddy',{client:{auth:{set:async({body})=>{auth=body;}}}}, {
   workbuddyAdapter:{async refresh(bundle){refreshed++;return {...bundle,accessToken:'fresh',expiresAt:Date.now()+3600000};}},
   fetchImpl:async(url,options)=>{
    assert.equal(url,'https://copilot.tencent.com/v2/chat/completions');
    return fetch('http://127.0.0.1:'+server.address().port,options);
   },
  });
  const loader=await plugin.auth.loader(async()=>auth);
  const response=await loader.fetch('https://sub2agent.invalid/v1/chat/completions',{body:JSON.stringify({model:'Enterprise Model',messages:[{role:'user',content:'hello'}],stream:true})});
  assert.equal(response.status,200);
  assert.match(await response.text(),/ok/);
  assert.equal(refreshed,1);assert.equal(seen.length,2);
  assert.deepEqual(seen.map(request=>request.headers.authorization),['Bearer old','Bearer fresh']);
  for(const request of seen) {
   assert.equal(request.headers['x-user-id'],'test-user');
   assert.equal(request.headers['x-enterprise-id'],'test-enterprise');
   assert.equal(request.headers['x-tenant-id'],'test-enterprise');
   assert.equal(request.body.model,'vendor-model');
  }
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('cancelled browser login does not save an account',async()=>{
 const adapter={requestLoginLink:async()=>({url:'https://login.example.invalid',state:'s'}),pollToken:async()=>null};
 const plugin=await createSub2AgentPlugin('workbuddy',{client},{workbuddyAdapter:adapter});
 const flow=await plugin.auth.methods[0].authorize();
 const controller=new AbortController();const done=flow.callback(undefined,{signal:controller.signal});controller.abort();
 await assert.rejects(done,{name:'AbortError'});
});

test('CodeBuddy reuses adapter state and keeps credentials in the host account',async()=>{
 const adapter={inspectLocalState:async()=>models,requestLoginLink:async()=>({state:'cb-state',url:'https://login.example.invalid'}),
  completeLogin:async({state})=>(assert.equal(state,'cb-state'),models),
  confirmLoginComplete:async()=>({accessToken:'cb-token',userId:'cb-user',enterpriseId:'cb-enterprise'})};
 const plugin=await createSub2AgentPlugin('codebuddy',{client},{codebuddyAdapter:adapter});
 const flow=await plugin.auth.methods[0].authorize();const result=await flow.callback();
 assert.equal(readBundle(result).accessToken,'cb-token');assert.equal(readBundle(result).enterpriseId,'cb-enterprise');
});

test('Trae callback is nonce-scoped, validates login, and closes its listener',async()=>{
 let callbackUrl,checked=false;
 const adapter={requestLoginLink:async input=>(callbackUrl=input.callbackUrl,{loginUrl:'https://login.example.invalid'}),
  parseAuthorizationCallback:url=>{assert.equal(new URL(url).searchParams.get('test'),'yes');return {token:'trae-token',refreshToken:'trae-refresh'};},
  getUserInfo:async()=>({UserID:'trae-user'}),checkLogin:async()=>{checked=true;return {IsLogin:true,UserID:'trae-user'};},listModels:async()=>models};
 const plugin=await createSub2AgentPlugin('trae',{client},{traeAdapter:adapter});
 const flow=await plugin.auth.methods[0].authorize();
 assert.equal(flow.callbackUrl,callbackUrl,'manual callback target must survive an opaque login URL');
 const wrong=new URL(callbackUrl);wrong.pathname='/wrong';assert.equal((await fetch(wrong)).status,404);
 const done=flow.callback();
 const response=await fetch(callbackUrl+'?test=yes');assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/trae-token/);
 const result=await done;assert.equal(checked,true);assert.equal(readBundle(result).userId,'trae-user');
 await assert.rejects(fetch(callbackUrl));
});

test('Trae refuses a callback whose enterprise login is not confirmed',async()=>{
 let callbackUrl;
 const adapter={requestLoginLink:async input=>(callbackUrl=input.callbackUrl,{loginUrl:'https://login.example.invalid'}),
  parseAuthorizationCallback:()=>({token:'t',refreshToken:'r'}),getUserInfo:async()=>({UserID:'u'}),checkLogin:async()=>({IsLogin:false})};
 const plugin=await createSub2AgentPlugin('trae',{client},{traeAdapter:adapter});
 const flow=await plugin.auth.methods[0].authorize();const rejected=assert.rejects(flow.callback(),/校验未通过/);
 await fetch(callbackUrl);await rejected;
});

test('Trae allows retrying invalid callbacks and consumes the valid callback only once',async()=>{
 let release;const verifying=new Promise(r=>release=r);let parsed=0;
 const adapter={requestLoginLink:async()=>({loginUrl:'https://login.example.invalid'}),
  parseAuthorizationCallback:url=>{if(new URL(url).searchParams.get('code')!=='valid')throw new Error('invalid');parsed++;return {token:'fixture-token'};},
  getUserInfo:async()=>{await verifying;return {UserID:'u'};},checkLogin:async()=>({IsLogin:true}),listModels:async()=>models};
 const plugin=await createSub2AgentPlugin('trae',{client},{traeAdapter:adapter});
 const flow=await plugin.auth.methods[0].authorize();
 const done=flow.callback();
 try {
  assert.equal((await fetch(flow.callbackUrl+'?code=bad')).status,400);
  assert.equal((await fetch(flow.callbackUrl+'?code=valid')).status,200);
  assert.equal((await fetch(flow.callbackUrl+'?code=valid')).status,409);
  assert.equal(parsed,1);
 }finally{release();await done;}
 await assert.rejects(fetch(flow.callbackUrl));
});

test('Trae cancellation closes its local callback listener without saving an account',async()=>{
 const adapter={requestLoginLink:async()=>({loginUrl:'https://login.example.invalid'})};
 const plugin=await createSub2AgentPlugin('trae',{client},{traeAdapter:adapter});
 const flow=await plugin.auth.methods[0].authorize();
 const controller=new AbortController();const done=flow.callback(undefined,{signal:controller.signal});
 const rejected=assert.rejects(done,/abort|cancel/i);controller.abort();await rejected;
 await assert.rejects(fetch(flow.callbackUrl));
});

test('WorkBuddy fallback is listed once and hy4free is sent as the actual upstream model',async()=>{
 const sent=[];
 const auth={type:'oauth',access:JSON.stringify({...models,accessToken:'fixture',expiresAt:Date.now()+3600000,userId:'u',enterpriseId:'e'})};
 const plugin=await createSub2AgentPlugin('workbuddy',{client},{workbuddyAdapter:{},fetchImpl:async(url,options)=>{sent.push(JSON.parse(options.body));return sse();}});
 const listed=await plugin.provider.models({models:{}},{auth});
 assert.equal(Object.keys(listed).filter(id=>id==='hy4free').length,1);
 assert.equal(listed.hy4free.cost,undefined,'discovery must not hardcode a permanent free price');
 const loader=await plugin.auth.loader(async()=>auth);
 const response=await loader.fetch('',{body:JSON.stringify({model:'hy4free',messages:[{role:'user',content:'hello'}],stream:true})});
 assert.equal(response.status,200);await response.text();
 assert.equal(sent[0].model,'hy4free');
 const duplicate={...auth,access:JSON.stringify({...readBundle(auth),models:['hy4free','hy4free','Enterprise Model']})};
 assert.equal(Object.keys(await plugin.provider.models({models:{}},{auth:duplicate})).filter(id=>id==='hy4free').length,1);
});
