// Isolated preview: real frontend renderers, synthetic data, no API forwarding.
(() => {
  // Embedded synthetic pages have no external configuration to reread on focus.
  // Avoid a focus refresh replacing a row between pointerdown and click.
  if(window!==top)window.addEventListener('focus',e=>e.stopImmediatePropagation(),true);
  const settings = {lang:'zh',theme:'light',web:true,intranet:true,version:'preview',port:8989,guideHidden:true,featuresOff:['library','middleware','otel','redact','search','tools','warmups']};
  window.bootPrefs = settings;
  const models = [{value:'workbuddy/model-a',label:'示例模型 A',ref:'workbuddy/model-a'}, {value:'workbuddy/model-b',label:'示例模型 B',ref:'workbuddy/model-b'}];
  const names = [['claude','Claude Code','claude-color'],['claude-desktop','Claude Desktop','claude-color'],['codex','Codex','codex-color'],['opencode','OpenCode','opencode'],['pi','Pi','pi'],['vscode','VS Code','vscode'],['hermes','Hermes Agent','hermes'],['workbuddy','WorkBuddy','workbuddy-color'],['codebuddy','CodeBuddy','codebuddy-color'],['alma','Alma','alma']];
  const agents = names.map(([id,name,icon]) => ({id,name,icon,path:'/example/'+id, wired:['opencode','pi'].includes(id),models:{shown:16,listed:16},fields:[{key:'model',label:'model',value:['opencode','pi'].includes(id)?models[0].value:'default',options:[{value:'default',label:'默认'},...models]}]}));
  const state = {agents,profiles:[],settings};
  const providers = [{id:'workbuddy',name:'WorkBuddy 企业',icon:'workbuddy-color',on:true,kind:'subscription',agents:['opencode','pi'],models:[{id:'model-a',name:'示例模型 A',on:true},{id:'model-b',name:'示例模型 B',on:true}],key:{set:false},account:{user:'演示账户',agentName:'WorkBuddy 企业',plan:'演示套餐',logins:[{user:'演示账户',plan:'演示套餐',on:true,active:true}]}}];
  const kinds = ['plan','smart','thrifty','steady'];
  const labels = ['计划优先','均衡优先','便宜优先','稳定优先'];
  const groups = kinds.map((kind,i)=>({id:kind,name:labels[i],template:kind,members:models.map(m=>m.ref),routing:'order',ready:true,accounts:[],match:[],matched:[],fast:[],off:[],patterns:[],memberInfo:models.map(m=>({id:m.ref,ready:true}))}));
  const groupData = {models:models.map(m=>({id:m.ref,name:m.label,providerName:'WorkBuddy 企业',icon:'workbuddy-color'})),pools:[],deciders:[],found:true,groups,templates:kinds.map((kind,i)=>({kind,group:groups[i]}))};
  const gateway={running:true,window:true,mine:true,calls:[],groups:groups.map(g=>({id:g.id,name:g.name,providers:['workbuddy']})),url:'http://gateway.example.test:8989'};
  const seat={id:'workbuddy-demo',provider:'workbuddy',name:'WorkBuddy 企业',who:'演示账户',kind:'account',model:'示例模型 A'};
  const now=new Date().toISOString();
  const trace={mine:true,now,seq:1,totals:{requests:144,rerouted:0,errors:0},routes:[{id:1,seq:1,time:now,agent:'opencode',session:'demo-session',model:'示例模型 A',provider:'workbuddy',order:[seat],tries:[{id:seat.id,model:seat.model,start:now,done:true,status:200,ms:1200}],done:true,status:200,ms:1200,tokens:2048}]};
  const presets=[{id:'tig',name:'TIG Coding Plan',icon:'generic',kind:'relay',chat:'https://tig.example.test/v1'},{id:'cib',name:'CIB-智汇通-APIKEY',icon:'generic',kind:'relay',chat:'https://cib.example.test/v1'},{id:'remote',name:'Remote sub2agent',icon:'sub2agent',kind:'remote',chat:'https://remote.example.test/v1'}];
  providers[0].account.agent='workbuddy';
  const samples={'/api/settings':settings,'/api/state':state,'/api/providers':{providers,presets,plugins:[{id:'workbuddy',pid:'sub2agent-workbuddy',name:'WorkBuddy 企业',icon:'workbuddy-color',spec:'@sub2agent/workbuddy',methods:[{type:'oauth',label:'企业登录'}]}],excluded:[],gateway},'/api/plugins':{plugins:[]},'/api/plugins/builtin':[],'/api/groups':groupData,'/api/gateway/trace':trace,'/api/gateway/history':{cut:false,days:[],routes:[]},'/api/agents/connections':{agents,checks:{}},'/api/agents/cli':{agents:{},pending:false},'/api/usage/quotas':[]};
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  window.fetch=async(input,init={})=>{
    const url=new URL(input instanceof Request?input.url:String(input),location.href),method=(init.method||'GET').toUpperCase();
    if(!url.pathname.startsWith('/api/'))return reply({error:'预览不访问外部服务'},403);
    if(method!=='GET'){
      const body=JSON.parse(init.body||'{}');
      const connect=url.pathname.match(/^\/api\/agents\/(connect|disconnect|disconnect-offline)\/(.+)$/);
      if(connect){const a=agents.find(a=>a.id===connect[2]);if(a){a.wired=connect[1]==='connect';a.fields[0].value=a.wired?models[0].value:'default'}parent.postMessage({type:'agent-counts',connected:agents.filter(a=>a.wired).length,total:agents.length},location.origin);return reply(state)}
      if(url.pathname==='/api/set'){const a=agents.find(a=>a.id===body.agent);if(a){a.fields.find(f=>f.key===body.field).value=body.value}return reply(state)}
      if(url.pathname==='/api/agents/rescan')return reply(state);
      if(['/api/provider/on','/api/provider/off'].includes(url.pathname)){const p=providers.find(p=>p.id===body.id);if(p)p.on=url.pathname.endsWith('/on');return reply(samples['/api/providers'])}
      if(url.pathname==='/api/groups/template')return reply(groupData);
      return reply({error:'独立预览：此操作需在正式应用中完成'},403);
    }
    if(url.pathname.startsWith('/api/agents/preview/'))return reply({changes:[]});
    if(url.pathname==='/api/gateway/trace'&&url.searchParams.has('wait')){await new Promise(r=>setTimeout(r,5000));return reply({...trace,routes:[]})}
    return reply(samples[url.pathname]??{});
  };
  window.workspaceSamples={agents,groups,labels};
})();
