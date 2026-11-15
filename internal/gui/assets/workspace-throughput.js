// Workspace output telemetry: the server owns time, windows and peaks.
(() => {
 let running=false,timer=null,controller=null,visit=0,last=null,dimension='providers',node;
 const numeric=v=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(1):t('Awaiting calibration');
 function spark(points,label){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),p=document.createElementNS(ns,'path');svg.setAttribute('viewBox','0 0 220 32');svg.setAttribute('role','img');svg.setAttribute('aria-label',label);svg.classList.add('ws-spark');
  const top=Math.max(1,...points.filter(v=>typeof v==='number'));let pen=false;const d=[];
  points.forEach((v,i)=>{if(typeof v!=='number'){pen=false;return;}d.push((pen?'L':'M')+(i*220/179).toFixed(2)+','+(29-v/top*25).toFixed(2));pen=true});p.setAttribute('d',d.join(' '));svg.append(p);return svg;
 }
 function mount(){
  if(node)return;node=document.createElement('details');node.id='ws-throughput';
  node.innerHTML='<summary><span class="ws-metrics"><span><b id="ws-current">—</b><small data-t>Current throughput</small></span><span><b id="ws-peak">—</b><small data-t>Peak throughput</small></span></span><span id="ws-total-curve"></span><span class="ws-expand-label"></span></summary><div class="ws-dimension-tabs" role="group"></div><div id="ws-throughput-rows"></div><p class="ws-telemetry-note" data-t>Estimated output token/s · Updated every second · Last 5 seconds average · Last 180 seconds · Peak since gateway start or series reset</p><p id="ws-throughput-status" role="status"></p>';
  for(const [id,name]of [['providers','Providers'],['models','Models'],['sessions','Sessions']]){const b=document.createElement('button');b.className='text';b.dataset.t='';b.dataset.en=name;b.textContent=t(name);b.dataset.dimension=id;b.onclick=()=>{dimension=id;paint()};node.querySelector('.ws-dimension-tabs').append(b)}
  node.ontoggle=()=>{node.querySelector('.ws-expand-label').textContent=t(node.open?'Collapse throughput details':'View throughput dimensions')+(node.open?'⌃':'⌄');paint()};
  document.querySelector('#rt').append(node);
  node.querySelector('.ws-dimension-tabs').setAttribute('aria-label',t('Throughput dimensions'));
  translateStatic();node.ontoggle();
 }
 function paint(){
  if(!last||!node)return;
  node.querySelector('.ws-expand-label').textContent=t(node.open?'Collapse throughput details':'View throughput dimensions')+(node.open?'⌃':'⌄');
  node.querySelector('.ws-dimension-tabs').setAttribute('aria-label',t('Throughput dimensions'));
  for(const [id,key]of [['ws-current','current'],['ws-peak','peak']])node.querySelector('#'+id).textContent=numeric(last.total[key])+(last.total[key]===null?'':' token/s');
  const curve=node.querySelector('#ws-total-curve');curve.replaceChildren(spark(last.total.points,t('Total throughput over the last 180 seconds')));
  node.querySelectorAll('[data-dimension]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.dimension===dimension)));
  if(!node.open)return;
  const rows=node.querySelector('#ws-throughput-rows');rows.replaceChildren();
  const list=last[dimension]||[];
  if(!list.length){rows.textContent=t('No output records yet');return;}
  for(const item of list){const row=document.createElement('div');row.className='ws-throughput-row';const name=document.createElement('span');name.className='ws-series-name';let label=item.name;
   if(dimension==='providers')label=providers?.providers?.find(p=>p.id===item.id)?.name||label;
   if(dimension==='sessions')label=(state.agents?.find(a=>a.id===item.agent)?.name||item.agent||'Agent')+' · '+(item.name==='Unidentified session'?t('Unidentified session'):item.name);
   name.textContent=label;name.title=label;const stats=document.createElement('span');stats.className='ws-series-stats';stats.textContent=t('Current {current} · Peak {peak} token/s',{current:numeric(item.current),peak:numeric(item.peak)});row.append(name,spark(item.points,t('{name} throughput over the last 180 seconds',{name:label})),stats);rows.append(row);}
 }
 function status(message){if(node)node.querySelector('#ws-throughput-status').textContent=message;}
 async function poll(token){
  if(!running||document.hidden||token!==visit)return;
  controller=new AbortController();const current=controller;const timeout=setTimeout(()=>current.abort(),5000);
  try{const res=await fetch('/api/gateway/throughput',{signal:current.signal});if(!res.ok)throw new Error('throughput query failed');const data=await res.json();if(!running||token!==visit)return;
   if(data.status==='unavailable'||data.version!==1||data.total?.points?.length!==180)throw new Error('throughput unavailable');
   last=data;paint();status((data.status==='partial'?t('Some models await calibration · '):'')+(data.truncated?t('Some dimensions were evicted · '):'')+t('Updated at {time}',{time:new Date(data.asOf*1000).toLocaleTimeString(intlLang())}));
  }catch(err){if(running&&token===visit)status(last?t('Connection interrupted · Keeping last data ({time})',{time:new Date(last.asOf*1000).toLocaleTimeString(intlLang())}):t('Connection interrupted · Waiting for gateway data'));}
  finally{clearTimeout(timeout);if(controller===current)controller=null;if(running&&!document.hidden&&token===visit)timer=setTimeout(()=>poll(token),1000);}
 }
 function start(){mount();if(running)return;running=true;poll(++visit)}
 function stop(){running=false;visit++;clearTimeout(timer);controller?.abort();controller=null;}
 document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);controller?.abort();visit++;}else if(running)poll(++visit)});
 window.workspaceThroughput={start,stop};
})();
