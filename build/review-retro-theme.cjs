// Theme behaviour review for the intranet retro skin: explicit light,
// explicit dark, system-light and system-dark. Synthetic fixture only;
// all API writes intercepted, no host data touched.
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const assets=path.resolve('internal/gui/assets');
const cases=[
  {name:'explicit-light', theme:'light', colorScheme:'light'},
  {name:'explicit-dark',  theme:'dark',  colorScheme:'light'},   // pinned dark must win over OS light
  {name:'system-light',   theme:'system',colorScheme:'light'},
  {name:'system-dark',    theme:'system',colorScheme:'dark'},    // the blocking case
];
(async()=>{
 const output=process.argv[2];await fs.mkdir(output,{recursive:true});
 for(const engine of ['chromium','webkit']) {
 const browser=await (engine==='chromium'?chromium.launch({channel:'chrome'}):webkit.launch());
 try{
  for(const c of cases){
   const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce',colorScheme:c.colorScheme});
   const errors=[];
   page.on('pageerror',e=>{if(!e.message.startsWith('ResizeObserver loop'))errors.push(e.message);});
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url()),json=data=>route.fulfill({json:data});
    if(u.pathname==='/boot.js')return route.fulfill({contentType:'text/javascript',body:'window.bootPrefs='+JSON.stringify({lang:'zh',theme:c.theme,web:false,intranet:true,version:'0.1.3913-sub2agent.17',port:8989,gateway:'http://127.0.0.1:8989',featuresOff:['library','middleware','otel','redact','search','tools','warmups']})+';'});
   if(u.pathname==='/theme.js')return route.fulfill({contentType:'text/javascript',body:await fs.readFile(path.join(assets,'theme.js'),'utf8')});
    if(u.pathname==='/wails/runtime.js')return route.fulfill({contentType:'text/javascript',body:'export const Window={};'});
    if(u.pathname.startsWith('/api/')){
     if(u.pathname==='/api/settings')return json({lang:'zh',theme:c.theme,version:'0.1.3913-sub2agent.17',port:8989,gateway:'http://127.0.0.1:8989',dir:'D:/sub2agent/data',log:'D:/sub2agent/data/logs/app.log',builtins:[]});
     if(u.pathname==='/api/state')return json({agents:[{id:'demo-agent',name:'Demo Agent',cliMissing:true,import:false,fields:[],path:'D:/demo/agent',icon:'generic'}],profiles:[],settings:{theme:c.theme,lang:'zh'}});
     if(u.pathname==='/api/providers')return json({providers:[
       {id:'demo-glm',name:'Demo GLM',on:true,agents:[],models:[{id:'glm-4-demo',name:'GLM 4 Demo',on:true}],key:{set:false},account:{user:'demo@example.test',agentName:'Demo GLM',plan:'Pro',logins:[{user:'demo@example.test',plan:'Pro',on:true,active:true}]}},
       {id:'demo-api',name:'Demo API Key',on:false,off:true,agents:[],models:[{id:'demo-mini',name:'Demo Mini',on:true}],key:{set:false}}
      ],presets:[],excluded:[],gateway:{running:true,url:'http://127.0.0.1:8989'}});
     if(u.pathname==='/api/gateway/trace')return json({seq:1,totals:{requests:0,rerouted:0,errors:0},routes:[]});
     if(u.pathname==='/api/groups')return json({models:[],groups:[],templates:[]});
     return json({});
    }
    if(u.host!=='sub2agent.test')return route.abort();
    try{
     let body=await fs.readFile(path.join(assets,u.pathname==='/'?'index.html':u.pathname));
     if(u.pathname==='/'){body=body.toString()
      .replace('</head>','<link rel="stylesheet" href="intranet-retro.css"></head>')
      .replaceAll('<title>magpie</title>','<title>sub2agent</title>')
      .replaceAll('<span>magpie</span>','<span>sub2agent</span>');}
     return route.fulfill({body,contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[path.extname(u.pathname)]||'text/html'});
    }catch{return route.fulfill({status:404,body:''});}
   });
   await page.goto('http://sub2agent.test/?view=providers');
   await page.waitForTimeout(700);
   const info=await page.evaluate(()=>{
    const cs=getComputedStyle(document.documentElement);
    const row=document.querySelector('#providers > .row');
    return {
     dataTheme:document.documentElement.dataset.theme||'(none)',
     bg:cs.getPropertyValue('--bg').trim(),
     rowBorder:row?getComputedStyle(row).borderTopWidth+' '+getComputedStyle(row).borderTopColor:'(no row)',
     bodyImage:document.body.style.backgroundImage||getComputedStyle(document.body).backgroundImage,
     colorScheme:getComputedStyle(document.documentElement).colorScheme,
    };
   });
   const light=c.name==='explicit-light'||c.name==='system-light';
   assert.equal(info.bg,light?'#f6f1e6':'#242526',`${engine} ${c.name}: incorrect palette`);
   assert.ok(info.rowBorder.startsWith('2px'),`${engine} ${c.name}: missing retro card`);
   assert.deepEqual(errors,[],`${engine} ${c.name}: page errors`);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
   assert.ok(!overflow,'horizontal overflow');
   await page.screenshot({path:path.join(output,`providers-${engine}-${c.name}.png`),fullPage:false});
   console.log(engine,c.name,JSON.stringify(info));
   await page.close();
  }
 }finally{await browser.close();}
 }
 console.log('theme review passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
