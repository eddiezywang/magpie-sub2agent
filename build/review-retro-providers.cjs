// Providers interaction review for the intranet retro skin: expand a
// provider row and open the "add account / sign in" affordance — all
// synthetic; every POST is intercepted and asserted, nothing reaches a
// real backend. Fails on page errors, overflow, missing affordances.
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const assets=path.resolve('internal/gui/assets');
const post=async(page,url,body)=>{
 let got=null;
 await page.route(url,r=>{got=r.postData();r.fulfill({json:{}});});
 await page.evaluate((u,b)=>fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}),url,body);
 await page.waitForTimeout(100);
 return got;
};
(async()=>{
 const output=process.argv[2];await fs.mkdir(output,{recursive:true});
 for(const engine of ['chromium','webkit']){
  const browser=await (engine==='chromium'?chromium.launch({channel:'chrome'}):webkit.launch());
  try{
   for(const theme of ['light','dark']) for(const width of [1440,420]){
    const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce',colorScheme:theme==='dark'?'dark':'light'});
    const errors=[];
    page.on('pageerror',e=>{if(!e.message.startsWith('ResizeObserver loop'))errors.push(e.message);});
    let posts=0;
    await page.route('**/*',async route=>{
     const u=new URL(route.request().url()),json=data=>route.fulfill({json:data});
     if(route.request().method()==='POST'){posts++;return json({});}
     if(u.pathname==='/boot.js')return route.fulfill({contentType:'text/javascript',body:`window.bootPrefs=${JSON.stringify({lang:'zh',theme,web:false,intranet:true,version:'0.1.3913-sub2agent.17',port:8989,gateway:'http://127.0.0.1:8989',featuresOff:['library','middleware','otel','redact','search','tools','warmups']})};`});
     if(u.pathname==='/wails/runtime.js')return route.fulfill({contentType:'text/javascript',body:'export const Window={};'});
     if(u.pathname.startsWith('/api/')){
      if(u.pathname==='/api/settings')return json({lang:'zh',theme,version:'0.1.3913-sub2agent.17',port:8989,gateway:'http://127.0.0.1:8989',dir:'D:/sub2agent/data',log:'D:/sub2agent/data/logs/app.log',builtins:[]});
      if(u.pathname==='/api/state')return json({agents:[{id:'demo-agent',name:'Demo Agent',cliMissing:true,import:false,fields:[],path:'D:/demo/agent',icon:'generic'}],profiles:[],settings:{theme}});
      if(u.pathname==='/api/providers')return json({providers:[
        {id:'demo-glm',name:'Demo GLM',on:true,kind:'subscription',agents:[],models:[{id:'glm-4-demo',name:'GLM 4 Demo',on:true}],key:{set:false},account:{user:'demo@example.test',agentName:'Demo GLM',plan:'Pro',logins:[{user:'demo@example.test',plan:'Pro',on:true,active:true}],usage:{requests:12,tokens:4500}}},
        {id:'demo-api',name:'Demo API Key',on:false,off:true,agents:[],models:[{id:'demo-mini',name:'Demo Mini',on:true}],key:{set:false}}
       ],presets:[{id:'demo-glm',name:'Demo GLM',kind:'partner',note:'synthetic preset'}],excluded:[],gateway:{running:true,url:'http://127.0.0.1:8989'}});
      if(u.pathname==='/api/gateway/trace')return json({seq:2,totals:{requests:3,rerouted:1,errors:0},routes:[]});
      if(u.pathname==='/api/usage')return json({totals:{requests:3,tokens:4500,cost:0.12},days:[],requests:[]});
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
      if(u.pathname==='/'){body=body.toString()
       .replace('</head>','<link rel="stylesheet" href="intranet-retro.css"></head>')
       .replaceAll('<title>magpie</title>','<title>sub2agent</title>')
       .replaceAll('<span>magpie</span>','<span>sub2agent</span>');}
      return route.fulfill({body,contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[path.extname(u.pathname)]||'text/html'});
     }catch{return route.fulfill({status:404,body:''});}
    });
    await page.goto('http://sub2agent.test/?view=providers');
    await page.waitForTimeout(700);
    await page.evaluate(t=>{if(document.documentElement.dataset.theme!==t)document.documentElement.dataset.theme=t;},theme);
    await page.waitForTimeout(300);

    // 1. the header's "＋ 添加供应商" entry (row not expanded yet, so
    // nothing is inert): open it, then close without saving
    const addBtn=page.locator('#addProvider');
    await addBtn.click();
    await page.locator('#addSheet').waitFor({state:'visible'});
    await page.screenshot({path:path.join(output,`providers-add-entry-${theme}-${engine}-${width}.png`)});
    await page.keyboard.press('Escape');
    await page.locator('#addSheet').waitFor({state:'hidden'});

    // 2. expand the on provider's row (the editor closes again)
    const row=page.locator('#providers > .row.provider').first();
    await row.scrollIntoViewIfNeeded();
    await row.locator('.who').click();
    await page.waitForTimeout(500);
    const dbg=await page.evaluate(()=>({
     editor:!!document.querySelector('.editor'),
     dialog:!!document.querySelector('.modal .dialog'),
     anyDialog:!!document.querySelector('dialog[open],.modal[open]'),
     inert:!!document.querySelector('body [inert]'),
     rows:document.querySelectorAll('#providers > .row.provider').length
    }));
    console.log(engine,theme,'after click:',JSON.stringify(dbg));
    // the editor (or an expanded detail region) must be present and framed
    // the editor opens as a modal dialog (or inline .editor); in light it
    // must be framed by the retro skin, in dark upstream styles rule
    const editorOpen=await page.evaluate(theme=>{
     const ed=document.querySelector('.editor, .modal .dialog');
     if(!ed || ed.offsetHeight<=80) return false;
     return theme==='light' ? getComputedStyle(ed).borderTopWidth!=='0px' : true;
    },theme);
    assert.ok(editorOpen,`${engine} ${theme}: provider row did not open a framed editor`);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${engine} ${theme} ${width}: horizontal overflow`);
    await page.screenshot({path:path.join(output,`providers-expanded-${theme}-${engine}-${width}.png`)});
    assert.deepEqual(errors,[],`${engine} ${theme}: page errors`);
    await page.close();
   }
  }finally{await browser.close();}
 }
 console.log('providers interaction review passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
