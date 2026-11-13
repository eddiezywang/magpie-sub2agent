import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createSub2AgentPlugin,readBundle} from '../../build/sub2agent-runtime/factory-test.mjs';

const client={auth:{set:async()=>{throw new Error('Unexpected credential write');}}};
const models={models:['Enterprise Model'],defaultModel:'Enterprise Model',modelMap:{'Enterprise Model':'vendor-model'}};
const sse=()=>new Response('data: {"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});

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
