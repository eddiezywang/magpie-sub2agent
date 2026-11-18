// Internal-only composition. Each original page has one active DOM host.
(() => {
  if (!window.bootPrefs?.intranet) return;
  // This distribution presents the existing group editor as routing policies.
  for (const [lang, label] of Object.entries({en:'Routing policies',zh:'路由策略','zh-TW':'路由策略',ja:'ルーティングポリシー',de:'Routingstrategien'})) {
    (I18N[lang] ||= {})['Routing groups'] = label;
    if (lang === 'zh' || lang === 'zh-TW') for (const key of Object.keys(I18N[lang])) I18N[lang][key] = I18N[lang][key].replaceAll('路由组','路由策略').replaceAll('路由組','路由策略');
  }
  const nav=document.querySelector('#nav');
  const navButton=document.createElement('button');navButton.dataset.view='workspace';navButton.innerHTML='<svg class="nav-ic" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM12 12h5v5h-5z" fill="none" stroke="currentColor"/></svg><span data-t>Workspace</span>';nav.querySelector('[data-view=agents]').before(navButton);
  nav.querySelector('[data-view=routing]')?.remove();
  window.wsView=v=>v==='routing'?'workspace':v;
  window.workspaceScrollRoot=()=>active ? (matchMedia('(min-width:901px)').matches ? main.querySelector('.ws-primary') : main) : null;
  const layout=()=>document.dispatchEvent(new Event('workspace-layout'));
  addEventListener('resize',()=>{if(active)layout();});
  let main, homes=[], active=false, observer, generation=0, routeRequest=0, routeStamp='', routeData=null, saving=false, routeError='', pendingPaint=false;
  magpie.plugin('workspace',ctx=>ctx.slots.add('page',{
    key:'workspace',title:'Workspace',loads:'providers',
    html:`<nav id="ws-guide" aria-label="Workspace setup"></nav><div id="ws-next" role="status"></div><div class="ws-grid"><div class="ws-primary"><details id="ws-agents"><summary><b data-t>Agent connections</b><span id="ws-agent-counts"></span><span class="ws-fold"></span></summary><div id="ws-agent-host"></div></details><section><h2 data-t>Routing policy</h2><div id="ws-route-controls"></div><div id="ws-route-members"></div><div id="ws-routing-host"></div></section></div><aside class="ws-providers"><h2 data-t>Providers</h2><div id="ws-provider-host"></div></aside></div>`,
    mount(node){main=node;const grid=main.querySelector('.ws-grid');grid.prepend(grid.querySelector('.ws-providers'));},
    async open(){
      active=true;generation++;routeStamp='';routeData=null;main.querySelector('#ws-guide').setAttribute('aria-label',t('Workspace setup'));
      for(const [id,host] of [['agents','agent'],['routing','routing'],['providers','provider']]){
        const page=document.querySelector('#view-'+id);
        if(!homes.some(h=>h.page===page))homes.push({page,parent:page.parentNode,next:page.nextSibling});
        main.querySelector('#ws-'+host+'-host').append(page);page.hidden=false;
      }
      document.body.classList.add('workspace-active');
      layout();
      const details=main.querySelector('#ws-agents');details.ontoggle=()=>{details.querySelector('.ws-fold').textContent=t(details.open?'Collapse agents':'Show all agents');};details.ontoggle();
      observer?.disconnect();observer=new MutationObserver(counts);observer.observe(document.querySelector('#agents'),{childList:true,subtree:true});
      renderAgents();counts();if(providers)renderProviders();
      import('../../agentconnections.js').then(m=>m.enter(),statusErr);
      window.workspaceThroughput?.start();
    },
    leave(){active=false;pendingPaint=false;if(agentMenu&&main.contains(agentMenu.anchor))closeAgentMenu();generation++;observer?.disconnect();window.workspaceThroughput?.stop();for(const h of homes){h.parent.insertBefore(h.page,h.next?.parentNode===h.parent?h.next:null);h.page.hidden=true;}document.body.classList.remove('workspace-active');},
    render(){if(active&&providers){renderProviders();counts();main.querySelector('#ws-agents').ontoggle();routeControls();}},
    draft(){if(active&&providers)renderProviders();},
    loading(){if(active)renderProvidersLoading();}
  }));
  window.renderWorkspaceQuota=(row,p)=>{
    if (p.tigQuotaWindows?.length && active) {
      const windows = el("div", "tig-quota-windows");
      for (const window of p.tigQuotaWindows) {
        const expiry = Date.parse(window.until);
        const time = Number.isFinite(expiry) ? new Intl.DateTimeFormat(document.documentElement.lang || undefined,
          {timeZone:"Asia/Shanghai", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hourCycle:"h23"}).format(expiry) : "";
        const label = t(window.period === "week" ? "7-day window" : "5-hour window");
        const condition = !time ? t("Window unknown") : expiry <= Date.now() ? t("Waiting for first accepted request") :
          t(window.estimated ? "Estimated end {time}" : "Quota exhausted · recovers {time}", {time});
        windows.append(el("span", "tig-quota-window", label + " · " + condition));
      }
      row.append(windows);
    }
  };
  function counts(){if(!active||!state?.agents)return;const list=state.agents.filter(a=>!a.hidden);const unknown=list.filter(a=>window.agentConnectionStatus?.(a.id)==='unknown').length;const on=list.filter(a=>a.wired&&window.agentConnectionStatus?.(a.id)!=='unknown').length;main.querySelector('#ws-agent-counts').textContent=t('Connected {on} · Not connected {off}',{on,off:list.length-on-unknown})+(unknown?t(' · Unknown {n}',{n:unknown}):'');guide();const stamp=JSON.stringify(list.map(a=>[a.id,a.wired,window.agentConnectionStatus?.(a.id),a.fields.find(f=>f.key==='model')?.value]));if(stamp!==routeStamp){routeStamp=stamp;routeControls();}}
  const kinds={'flash-first':'Flash first','flagship-first':'Flagship models first',smart:'Hard to strong, easy to cheap',thrifty:'Cheap first',steady:'Never stuck',plan:'Plan first',fast:'Fastest first',even:'Spread evenly'};
  const eligible=()=> (state?.agents||[]).filter(a=>a.wired&&window.agentConnectionStatus?.(a.id)!=='unknown'&&a.fields.some(f=>f.key==='model'&&f.options?.length));
  const target=()=>eligible().find(a=>a.id===main.dataset.agent)||eligible()[0];
  const field=a=>a?.fields.find(f=>f.key==='model');
  const modelRef=a=>{const f=field(a);return (f&&optionFor(f,f.value)?.ref)||f?.value||'';};
  const selected=a=>{const ref=modelRef(a).replace(/\[[^\]]+\]$/,'');return routeData?.groups?.find(g=>[g.ref,'group/'+g.id].includes(ref));};
  const configured=a=>!!modelRef(a);
  const button=(name,run,primary=false)=>{const b=el('button','text'+(primary?' primary':''),t(name));b.type='button';b.onclick=run;return b;};
  function step(i){
    if(i===0){const host=main.querySelector('#ws-provider-host');host.scrollIntoView({block:'nearest'});if(!adding)document.querySelector('#addProvider')?.click();requestAnimationFrame(()=>document.querySelector('#addSheet input')?.focus({preventScroll:true}));}
    else if(i===1){const d=main.querySelector('#ws-agents');d.open=true;d.querySelector('summary').focus({preventScroll:true});d.scrollIntoView({block:'nearest'});}
    else main.querySelector('[data-ws-focus=strategy]')?.focus({preventScroll:true});
  }
  function guide(){
    if(!active)return;
    const ps=(providers?.providers||[]).filter(p=>!p.off&&p.ready!==false&&((p.exposed||0)>0||p.models?.some(m=>m.on&&!m.noAPI))),a=target(),g=selected(a);
    const focusedNext=main.querySelector('#ws-next').contains(document.activeElement)?document.activeElement.dataset.action:null;
    const focusedStep=main.querySelector('#ws-guide').contains(document.activeElement)?document.activeElement.closest('[data-step]')?.dataset.step:null;
    const done=[ps.length>0,eligible().length>0,configured(a)],first=done.findIndex(x=>!x),box=main.querySelector('#ws-guide');box.replaceChildren();
    ['Providers','Agent connections','Routing policy'].forEach((name,i)=>{const b=button('',()=>step(i)),copy=el('span','ws-step-copy');b.classList.add('ws-step');b.dataset.step=i;if(first===i)b.setAttribute('aria-current','step');b.classList.toggle('done',done[i]);copy.append(el('span','ws-step-title',t(name)),el('span','ws-step-state',i===0?t('{n} ready',{n:ps.length}):i===1?t('{n} connected',{n:eligible().length}):(g&&t(g.name))||modelRef(a)||t('Not applied')));b.append(el('span','ws-step-number',String(i+1)),copy);box.append(b);});
    if(focusedStep)box.querySelector(`[data-step="${focusedStep}"]`)?.focus({preventScroll:true});
    const next=main.querySelector('#ws-next');next.replaceChildren();box.hidden=first<0&&!!providers&&!!routeData;next.hidden=box.hidden;
    if(!providers||!routeData){next.append(el('span','note',t('Checking workspace configuration…')));return;}
    if(first<0)return;
    const unknown=(state?.agents||[]).some(a=>!a.hidden&&window.agentConnectionStatus?.(a.id)==='unknown');
    const text=['Add or enable a provider with credentials and usable models',unknown?'Agent connection status is unknown; check again before connecting':'Connect an Agent to use your configured models',field(a)?.value?'Current model is kept. You can switch to Flash first here.':'Flash first is recommended; apply it to this Agent'][first];next.append(el('span','ws-next-message'+(first===2&&field(a)?.value?' is-positive':''),t(text)));
    if(first===2){const tp=routeData.templates?.find(tp=>tp.kind==='flash-first'),b=button('Use Flash first',()=>apply('flash-first'),true);const saved=routeData.groups?.find(g=>g.templateKind==='flash-first');b.disabled=saving||!tp||!!tp.need||!!saved?.disabled||!!saved&&!saved.ready;b.dataset.action='flash';next.append(b);if(tp?.need)next.append(el('span','note',t('No recognized model in this tier; choose members in Routing groups')));}
    else {const recheck=first===1&&unknown,b=button(recheck?'Refresh status':first===0?'Configure providers':'View Agents',recheck?async()=>{b.disabled=true;try{await (await import('../../agentconnections.js')).refresh();}catch(err){statusErr(err);}}:()=>step(first),true);b.dataset.action=recheck?'refresh':String(first);next.append(b);}
    if(focusedNext)next.querySelector(`[data-action="${focusedNext}"]`)?.focus({preventScroll:true});
  }
  function toggleMenu(anchor,items){
    const same=agentMenu?.anchor===anchor;closeAgentMenu();closeProtoMenu();
    if(same)return;
    openRowMenu(anchor,items,undefined,()=>queueMicrotask(()=>{if(active&&pendingPaint&&!agentMenu){pendingPaint=false;paint();guide();}}),true);
  }
  function paint(){
    if(!active)return;
    const box=main.querySelector('#ws-route-controls');
    const menu=agentMenu&&box.contains(agentMenu.anchor)?agentMenu:protoMenu&&box.contains(protoMenu.anchor)?protoMenu:null;
    const focus=box.contains(document.activeElement)?document.activeElement.dataset.wsFocus:menu?.box.contains(document.activeElement)?menu.anchor.dataset.wsFocus:null;
    // Keep the open menu usable while an asynchronous refresh arrives.
    // Selecting an item repaints from the latest state; later refreshes do too.
    if(menu){pendingPaint=true;return;}pendingPaint=false;box.replaceChildren();
    const a=target();if(!a){if(focus)main.querySelector('#ws-agents summary').focus({preventScroll:true});box.textContent=t('Connect an Agent to choose a routing group');main.querySelector('#ws-route-members').replaceChildren();return;}
    main.dataset.agent=a.id;const f=field(a),g=selected(a),choose=button('Agent',e=>{e.stopPropagation();toggleMenu(choose,eligible().map(agent=>({name:agent.name,run:()=>{main.dataset.agent=agent.id;paint();guide();}})));});choose.textContent=a.name;choose.append(svg('M4 6l4 4 4-4',12,1.6));choose.setAttribute('aria-haspopup','menu');choose.setAttribute('aria-expanded','false');choose.classList.add('ws-control');choose.dataset.wsFocus='agent';choose.disabled=saving;
    const pick=button('Routing policy',e=>{e.stopPropagation();const items=(routeData?.templates||[]).map(tp=>{const saved=routeData.groups?.find(g=>g.templateKind===tp.kind),reason=saved?.disabled?'Routing group is disabled':saved&&!saved.ready?'Routing group has no available members':tp.need?tp.need==='model'?'No recognized model in this tier; choose members in Routing groups':'Template prerequisites are not met; check Routing groups':'';return {name:t(kinds[tp.kind]||tp.group.name),off:!!reason,why:reason?t(reason):'',tip:tp.group.members.map(id=>routeData.models?.find(m=>m.id===id)?.name||id).join('\n'),run:()=>apply(tp.kind)};});for(const group of routeData?.groups||[])if(!group.templateKind||!kinds[group.templateKind])items.push({name:group.name,off:!group.ready||!!group.disabled,run:()=>applySaved(group)});toggleMenu(pick,items);});
    pick.textContent=(g&&t(kinds[g.templateKind]||g.name))||optionFor(f,f.value)?.label||f.value||t('Not applied');pick.append(svg('M4 6l4 4 4-4',12,1.6));pick.dataset.wsFocus='strategy';pick.setAttribute('aria-haspopup','menu');pick.setAttribute('aria-expanded','false');pick.classList.add('ws-control');pick.disabled=saving||!routeData;
    const edit=button('Edit routing groups',()=>{show('groups');if(g)requestAnimationFrame(()=>document.querySelector(`.rt-group[data-id="${CSS.escape(g.id)}"]`)?.scrollIntoView({block:'nearest'}));});edit.dataset.wsFocus='edit';edit.disabled=saving;
    box.append(el('span','note',t('Agent configuration')),choose,pick,edit);
    if(saving)box.append(el('span','note',t('Applying routing policy…')));
    if(routeError){const n=el('span','ws-route-error',routeError);n.setAttribute('role','alert');box.append(n);const retry=button('Refresh status',async()=>{try{state=await api('state');routeError='';renderAgents();await routeControls();}catch(err){statusErr(err);}});retry.disabled=saving;box.append(retry);}
    const info=main.querySelector('#ws-route-members');info.replaceChildren();
    if(g){info.append(el('span','note',(g.members||[]).map(id=>{const m=routeData.models?.find(m=>m.id===id);return [m?.providerName,m?.name||id,routingBillingText(m?.routingBilling)].filter(Boolean).join(' · ');}).join(' / ')));if(!g.ready||g.disabled)info.append(el('span','note',t('Routing group has no available members')));}
    else if(modelRef(a).startsWith('group/')) info.append(el('span','note',t('Routing group has no available members')));
    if(focus)(box.querySelector(`[data-ws-focus="${focus}"]`)||choose).focus({preventScroll:true});
  }
  async function write(run){
    if(saving)return;const a=target();if(!a)return;const release=window.agentConnectionAcquire?.(a.id);if(release===false)return;
    saving=true;routeError='';paint();guide();
    try{state=await run(a);renderAgents();if(state.notice)status(withNotice(t('Routing policy applied'),state.notice),'warn');else status(t('Routing policy applied'));}
    catch(err){routeError=t(err.message);status(routeError,'err');}
    finally{saving=false;release?.();if(active)await routeControls();}
  }
  function apply(kind){return write(a=>api('workspace/strategy',{agent:a.id,kind,expected:field(a).value}));}
  function applySaved(g){return write(a=>api('set',{agent:a.id,field:field(a).key,value:g.ref||'group/'+g.id}));}
  async function routeControls(){
    const visit=generation,request=++routeRequest;
    try{const next=await api('groups');if(!active||visit!==generation||request!==routeRequest)return;routeData=next;paint();guide();}
    catch(err){if(active&&visit===generation&&request===routeRequest){routeError=err.message;paint();guide();}}
  }
})();
