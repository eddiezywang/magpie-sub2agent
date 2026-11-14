// Synthetic-data page review for the intranet retro skin.
// All API writes are intercepted; no host configuration or real data touched.
// Fails (exit 1) on any page error, horizontal overflow or assertion breach.
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
// Prefer extracted production assets when supplied, so the review also covers
// the intranet index transformation and packaged pixel icons.
const assets=path.resolve(process.env.INTRANET_ASSETS||'internal/gui/assets');
const lang=process.env.LANG_CASE||'zh';
(async()=>{
 const output=process.argv[2];await fs.mkdir(output,{recursive:true});
 const views=['providers','sessions','usage','plugins','agents','routing','groups','gateway','settings'];
 let shots=0;
 for(const engine of ['chromium','webkit']) {
  const browser=await (engine==='chromium'?chromium.launch({channel:'chrome'}):webkit.launch());
  try {
   for(const theme of ['light','dark']) for(const width of [1440,420]) for(const view of views) {
    const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce',colorScheme:theme==='dark'?'dark':'light'});
    const errors=[];
    page.on('pageerror',e=>{if(!e.message.startsWith('ResizeObserver loop'))errors.push(e.message);});
    await page.route('**/*',async route=>{
     const u=new URL(route.request().url()),json=data=>route.fulfill({json:data}),method=route.request().method();
     if(u.pathname==='/boot.js')return route.fulfill({contentType:'text/javascript',body:`window.bootPrefs=${JSON.stringify({lang,theme,web:false,intranet:true,version:'0.1.3913-sub2agent.17',port:8989,gateway:'http://127.0.0.1:8989',featuresOff:['library','middleware','otel','redact','search','tools','warmups']})};`});
     if(u.pathname==='/wails/runtime.js')return route.fulfill({contentType:'text/javascript',body:'export const Window={};'});
     if(u.pathname.startsWith('/api/')){
      if(method==='POST')return json({});
      if(u.pathname==='/api/settings')return json({lang,theme,version:'0.1.3913-sub2agent.17',port:8989,gateway:'http://127.0.0.1:8989',dir:'D:/sub2agent/data',log:'D:/sub2agent/data/logs/app.log',login:false,lightweight:false,proxy:'',builtins:[]});
      if(u.pathname==='/api/state')return json({agents:[{id:'demo-agent',name:'Demo Agent',cliMissing:true,import:false,fields:[],path:'D:/demo/agent',icon:'generic'}],profiles:[],settings:{theme,lang}});
      if(u.pathname==='/api/providers')return json({providers:[
        {id:'demo-glm',name:'Demo GLM',on:true,kind:'subscription',agents:[],models:[{id:'glm-4-demo',name:'GLM 4 Demo',on:true}],key:{set:false},account:{user:'demo@example.test',agentName:'Demo GLM',plan:'Pro',logins:[{user:'demo@example.test',plan:'Pro',on:true,active:true}],usage:{requests:12,tokens:4500}}},
        {id:'demo-api',name:'Demo API Key',on:false,off:true,agents:[],models:[{id:'demo-mini',name:'Demo Mini',on:true}],key:{set:false}}
       ],presets:[],excluded:[],gateway:{running:true,url:'http://127.0.0.1:8989'}});
      if(u.pathname==='/api/gateway/trace')return json({seq:2,totals:{requests:3,rerouted:1,errors:0},routes:[
        {id:'r1',model:'glm-4-demo',provider:'Demo GLM',account:'demo@example.test',requests:3,ok:3,errors:0}
      ]});
      if(u.pathname==='/api/usage'||u.pathname==='/api/usage/summary')return json({totals:{requests:3,tokens:4500,cost:0.12},days:[],requests:[]});
      if(u.pathname==='/api/sessions'||u.pathname.startsWith('/api/sessions/'))return json({sessions:[],history:{consent:false}});
      if(u.pathname==='/api/plugins')return json({plugins:[]});
      if(u.pathname==='/api/plugins/builtin')return json([{id:'sessions',name:'Sessions',sub:'Conversation history',on:true,inUse:0,use:'',schema:null,config:{}}]);
      if(u.pathname==='/api/groups')return json({models:[],groups:[],templates:[]});
      if(u.pathname==='/api/agents/connections')return json({agents:[],checks:{}});
      if(u.pathname==='/api/cli')return json({exe:'D:/sub2agent/sub2agent.exe',dir:'D:/sub2agent',command:'D:/sub2agent/sub2agent.com',ours:true,windows:true,shells:[]});
      return json({});
     }
     if(u.host!=='sub2agent.test')return route.abort();
     try{
      let body=await fs.readFile(path.join(assets,u.pathname==='/'?'index.html':u.pathname));
      if(u.pathname==='/'){
       body=body.toString();
       if(!body.includes('href="intranet-retro.css"'))body=body.replace('</head>','<link rel="stylesheet" href="intranet-retro.css"></head>');
       body=body.replaceAll('<title>magpie</title>','<title>sub2agent</title>').replaceAll('<span>magpie</span>','<span>sub2agent</span>');
      }
      return route.fulfill({body,contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[path.extname(u.pathname)]||'text/html'});
     }catch{return route.fulfill({status:404,body:''});}
    });
    await page.goto('http://sub2agent.test/?view='+view);
    await page.locator('#view-'+view).waitFor({state:'visible'});
    await page.waitForTimeout(600);
    // the theme arrives through boot.js/applyPrefs; only correct it if the
    // page didn't apply the fixture's saved choice on its own
    await page.evaluate(t=>{if(document.documentElement.dataset.theme!==t)document.documentElement.dataset.theme=t;},theme);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme||'(none)'),theme,`${view} ${engine} ${theme} ${width}: theme not applied`);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    assert.ok(!overflow,`${view} ${engine} ${theme} ${width}: horizontal overflow`);
    assert.deepEqual(errors,[],`${view} ${engine} ${theme} ${width}: page errors`);
    await page.screenshot({path:path.join(output,`${view}-${engine}-${lang}-${theme}-${width}.png`),fullPage:true});
    shots++;
    await page.close();
   }
  }finally{await browser.close();}
 }
 console.log(`done: ${shots} screenshots, all assertions passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
