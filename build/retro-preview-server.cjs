const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../internal/gui/assets');
const settings={lang:'zh',theme:'light',web:true,intranet:true,version:'preview',port:8989,featuresOff:['library','middleware','otel','redact','search','tools','warmups']};
const providers=[{id:'demo-workbuddy',name:'WorkBuddy 企业（示例）',on:true,kind:'subscription',agents:[],models:[{id:'glm-demo',name:'GLM 演示',on:true}],key:{set:false},account:{user:'demo@example.test',agentName:'WorkBuddy 企业',plan:'演示',logins:[{user:'demo@example.test',plan:'演示',on:true,active:true}]}},{id:'demo-codebuddy',name:'CodeBuddy（示例）',on:true,agents:[],models:[],key:{set:false}},{id:'demo-api',name:'自定义 API（示例）',on:true,agents:[],models:[],key:{set:false}}];
let version=Date.now(), pageVersion=version;
fs.watch(root,{recursive:true},(_event,name)=>{
 version=Date.now();
 if (!name || !String(name).toLowerCase().endsWith('.css')) pageVersion=version;
});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
const reload=`<script>(()=>{let v,p;setInterval(async()=>{try{const next=await(await fetch('/__preview_version',{cache:'no-store'})).json();if(v&&v!==next.version){if(p!==next.pageVersion){location.reload();return}document.querySelectorAll('link[rel=stylesheet]').forEach(l=>{const u=new URL(l.href);u.searchParams.set('preview',next.version);l.href=u})}v=next.version;p=next.pageVersion}catch{}},700)})()</script>`;
http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');const json=x=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(x))};
if(u.pathname==='/__preview_version')return json({version,pageVersion});
if(u.pathname==='/boot.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end('window.bootPrefs='+JSON.stringify(settings)+';')}
if(u.pathname==='/wails/runtime.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end('export const Window={};')}
if(u.pathname.startsWith('/api/')){if(req.method!=='GET')return json({error:'视觉预览：操作不会保存'});switch(u.pathname){case '/api/settings':return json(settings);case '/api/state':return json({agents:[],profiles:[],settings});case '/api/providers':return json({providers,presets:[],excluded:[],gateway:{running:true,url:'http://127.0.0.1:8989'}});case '/api/plugins':return json({plugins:[]});case '/api/plugins/builtin':return json([]);case '/api/groups':return json({models:[],groups:[],templates:[]});case '/api/gateway/trace':return json({seq:1,totals:{requests:0,rerouted:0,errors:0},routes:[]});case '/api/agents/connections':return json({agents:[],checks:{}});default:return json({})}}
const rel=u.pathname==='/'?'index.html':decodeURIComponent(u.pathname).replace(/^\/+/,''),file=path.resolve(root,rel);if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end()}
fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end()}let body=data;if(rel==='index.html')body=data.toString().replace('</head>','<link rel="stylesheet" href="intranet-retro.css">'+reload+'</head>').replaceAll('<title>magpie</title>','<title>Sub2Agent 视觉预览</title>').replaceAll('<span>magpie</span>','<span>sub2agent</span>');res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body)})
}).listen(4178,'127.0.0.1',()=>console.log('Preview http://127.0.0.1:4178/?view=providers'));
