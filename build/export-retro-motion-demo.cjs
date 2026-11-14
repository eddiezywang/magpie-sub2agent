// Export the packed interface for a static review host. Every API response is
// synthetic; no request is forwarded to an application or a gateway.
const fs=require('node:fs/promises'),path=require('node:path');
const source=path.resolve(process.argv[2]||''),out=path.resolve(process.argv[3]||'');
if(!process.argv[2]||!process.argv[3]||source===out)throw Error('Usage: node export-retro-motion-demo.cjs <extracted assets> <new output directory>');
const now=new Date().toISOString();
const settings={lang:'zh',theme:'light',web:true,intranet:true,version:'preview',port:8989,featuresOff:['library','middleware','otel','redact','search','tools','warmups']};
const agent={id:'codex',name:'Codex（示例）',icon:'codex-color',wired:true,fields:[]};
const seat={id:'demo-workbuddy',provider:'demo-workbuddy',name:'WorkBuddy（示例）',who:'演示账户',kind:'account',model:'示例模型'};
const route={id:1,seq:1,time:now,agent:'codex',session:'demo-session-1',model:'示例模型',provider:'demo-workbuddy',order:[seat],tries:[{id:seat.id,model:seat.model,start:now,done:true,status:200,ms:1200}],done:true,status:200,ms:1200,tokens:2048};
const trace={mine:true,now,seq:1,totals:{requests:1,rerouted:0,errors:0},routes:[route]};
const fixtures={
 '/api/settings':settings,
 '/api/state':{agents:[agent],profiles:[],settings},
 '/api/providers':{providers:[{id:'demo-workbuddy',name:'WorkBuddy 企业（示例）',icon:'workbuddy-color',on:true,kind:'subscription',agents:[],models:[{id:'glm-demo',name:'GLM 演示',on:true}],key:{set:false},account:{user:'demo@example.test',agentName:'WorkBuddy 企业',plan:'演示',logins:[{user:'demo@example.test',plan:'演示',on:true,active:true}]}}],plugins:[],presets:[],excluded:[],gateway:{running:true,window:true,mine:true,calls:[],groups:[],url:'http://gateway.example.test:8989'}},
 '/api/plugins':{plugins:[]},'/api/plugins/builtin':[],
 '/api/groups':{models:[],groups:[],templates:[]},
 '/api/gateway/trace':trace,'/api/gateway/history':{cut:false,days:[],routes:[]},
 '/api/agents/connections':{agents:[agent],checks:{}},
 '/api/sessions/reads':{asked:true,all:true,found:[],gateway:false},
 '/api/sessions/manage':{agents:[],sessions:[],trash:[],reads:{asked:true,all:true,found:[],gateway:false}}
};
(async()=>{
 await fs.cp(source,out,{recursive:true,force:false,errorOnExist:true});
 let html=await fs.readFile(path.join(out,'index.html'),'utf8');
 if(!html.includes('<script src="boot.js"></script>')||!html.includes('intranet-retro.css'))throw Error('Expected packed intranet index');
 html=html.replace('<head>','<head><base href="/retro-motion-demo/"><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'">');
 html=html.replace('<script src="boot.js"></script>','<script src="preview-fixtures.js"></script><script src="boot.js"></script>');
 html=html.replace('<body>','<body><div role="status" style="position:fixed;right:12px;bottom:10px;z-index:9999;background:#222;color:#fff;padding:5px 9px;border-radius:3px;font:12px sans-serif;pointer-events:none">视觉预览 · 模拟数据</div>');
 await fs.writeFile(path.join(out,'index.html'),html);
 await fs.writeFile(path.join(out,'boot.js'),'window.bootPrefs='+JSON.stringify(settings)+';');
 const shim=`(()=>{const samples=${JSON.stringify(fixtures)};const fetchOriginal=window.fetch.bind(window);window.fetch=(input,init={})=>{const url=new URL(input instanceof Request?input.url:String(input),location.href),method=(init.method||(input instanceof Request&&input.method)||'GET').toUpperCase();if(!url.pathname.startsWith('/api/'))return fetchOriginal(input,init);const data=method==='GET'?(samples[url.pathname]??{}):{error:'视觉预览：操作不会保存'};if(method==='GET'&&url.pathname==='/api/gateway/trace'&&url.searchParams.has('wait'))return new Promise(resolve=>setTimeout(()=>resolve(new Response(JSON.stringify({...samples[url.pathname],routes:[]}),{headers:{'Content-Type':'application/json'}})),5000));return Promise.resolve(new Response(JSON.stringify(data),{status:method==='GET'?200:403,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}));};})();`;
 await fs.writeFile(path.join(out,'preview-fixtures.js'),shim);
 console.log(`Exported isolated synthetic demo to ${out}`);
})().catch(e=>{console.error(e);process.exitCode=1});
