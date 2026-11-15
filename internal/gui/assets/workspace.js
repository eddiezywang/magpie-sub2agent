// Internal-only composition. Each original page has one active DOM host.
(() => {
  if (!window.bootPrefs?.intranet) return;
  const nav=document.querySelector('#nav');
  const button=document.createElement('button');button.dataset.view='workspace';button.innerHTML='<svg class="nav-ic" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM12 12h5v5h-5z" fill="none" stroke="currentColor"/></svg><span>工作台</span>';nav.querySelector('[data-view=agents]').before(button);
  let main, homes=[], active=false, observer, generation=0;
  magpie.plugin('workspace',ctx=>ctx.slots.add('page',{
    key:'workspace',title:'工作台',loads:'providers',
    html:`<div class="ws-grid"><div class="ws-primary"><details id="ws-agents"><summary><b>Agent 接入</b><span id="ws-agent-counts"></span><span class="ws-fold">查看全部⌄</span></summary><div id="ws-agent-host"></div></details><section><h2>路由策略</h2><div id="ws-route-controls"></div><div id="ws-routing-host"></div></section></div><aside class="ws-providers"><h2>供应商</h2><div id="ws-provider-host"></div></aside></div>`,
    mount(node){main=node;},
    async open(){
      active=true;generation++;
      for(const [id,host] of [['agents','agent'],['routing','routing'],['providers','provider']]){
        const page=document.querySelector('#view-'+id);
        if(!homes.some(h=>h.page===page))homes.push({page,parent:page.parentNode,next:page.nextSibling});
        main.querySelector('#ws-'+host+'-host').append(page);page.hidden=false;
      }
      document.body.classList.add('workspace-active');
      const details=main.querySelector('#ws-agents');details.ontoggle=()=>{details.querySelector('.ws-fold').textContent=details.open?'收起⌃':'查看全部⌄';};
      observer?.disconnect();observer=new MutationObserver(counts);observer.observe(document.querySelector('#agents'),{childList:true,subtree:true});
      renderAgents();counts();if(providers)renderProviders();
      import('./agentconnections.js').then(m=>m.enter(),statusErr);
      await routeControls();window.workspaceThroughput?.start();
    },
    leave(){active=false;generation++;observer?.disconnect();window.workspaceThroughput?.stop();for(const h of homes){h.parent.insertBefore(h.page,h.next?.parentNode===h.parent?h.next:null);h.page.hidden=true;}document.body.classList.remove('workspace-active');},
    render(){if(active&&providers)renderProviders();},
    draft(){if(active&&providers)renderProviders();},
    loading(){if(active)renderProvidersLoading();}
  }));
  function counts(){if(!active||!state?.agents)return;const list=state.agents.filter(a=>!a.hidden);const unknown=list.filter(a=>window.agentConnectionStatus?.(a.id)==='unknown').length;const on=list.filter(a=>a.wired&&window.agentConnectionStatus?.(a.id)!=='unknown').length;main.querySelector('#ws-agent-counts').textContent=`已接入 ${on} · 未接入 ${list.length-on-unknown}`+(unknown?` · 未知 ${unknown}`:'');}
  async function routeControls(){
    const visit=generation,box=main.querySelector('#ws-route-controls');box.replaceChildren();
    try{
      const data=await api('groups');if(!active||visit!==generation)return;
      const eligible=(state?.agents||[]).filter(a=>a.wired&&a.fields.some(f=>f.key==='model'&&f.options?.length));
      if(!eligible.length){box.textContent='接入 Agent 后可选择路由组';return;}
      let target=eligible.find(a=>a.id===box.dataset.agent)||eligible[0];box.dataset.agent=target.id;
      const choose=magpie.ui.menu(eligible.map(a=>({v:a.id,name:a.name})),target.id,'Agent',id=>{box.dataset.agent=id;routeControls();});
      const current=target.fields.find(f=>f.key==='model'),groups=(data.groups||[]).filter(g=>g.templateKind&&['plan','smart','thrifty','steady'].includes(g.templateKind));
      box.append(choose);const saved=el('span','note',optionFor(current,current.value)?.label||current.value||t('Default'));box.append(saved);
      for(const g of groups){const b=el('button','text',g.name);b.disabled=!g.ready;b.setAttribute('aria-pressed',String(current.value===g.ref));b.onclick=async()=>{for(const x of box.querySelectorAll('button'))x.disabled=true;try{await setPick(target,current,g.ref,{value:g.ref,ref:g.ref,label:g.name});}catch(err){statusErr(err)}finally{if(active&&visit===generation)routeControls();}};box.append(b);}
      if(!groups.length)box.append(el('span','note','暂无已配置的预定义路由组'));
      const edit=el('button','text','编辑路由组 ›');edit.onclick=()=>show('groups');box.append(edit);
    }catch(err){if(active&&visit===generation){box.textContent=err.message;}}
  }
})();
