// Workspace output telemetry: the server owns time, windows and peaks.
(() => {
 let running=false,timer=null,controller=null,visit=0,last=null,dimension='providers',node;
 const numeric=v=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(1):'待校准';
 function spark(points,label){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),p=document.createElementNS(ns,'path');svg.setAttribute('viewBox','0 0 220 32');svg.setAttribute('role','img');svg.setAttribute('aria-label',label);svg.classList.add('ws-spark');
  const top=Math.max(1,...points.filter(v=>typeof v==='number'));let pen=false;const d=[];
  points.forEach((v,i)=>{if(typeof v!=='number'){pen=false;return;}d.push((pen?'L':'M')+(i*220/179).toFixed(2)+','+(29-v/top*25).toFixed(2));pen=true});p.setAttribute('d',d.join(' '));svg.append(p);return svg;
 }
 function mount(){
  if(node)return;node=document.createElement('details');node.id='ws-throughput';
  node.innerHTML='<summary><span class="ws-metrics"><span><b id="ws-current">—</b><small>实时吞吐量</small></span><span><b id="ws-peak">—</b><small>峰值吞吐量</small></span></span><span id="ws-total-curve"></span><span class="ws-expand-label">按维度查看⌄</span></summary><div class="ws-dimension-tabs" role="group" aria-label="吞吐量维度"></div><div id="ws-throughput-rows"></div><p class="ws-telemetry-note">估算输出 token/s · 每秒更新 · 最近 5 秒平均 · 近 180 秒曲线 · 峰值自网关启动或序列重建以来</p><p id="ws-throughput-status" role="status"></p>';
  for(const [id,name]of [['providers','供应商'],['models','模型'],['sessions','会话']]){const b=document.createElement('button');b.className='text';b.textContent=name;b.dataset.dimension=id;b.onclick=()=>{dimension=id;paint()};node.querySelector('.ws-dimension-tabs').append(b)}
  node.ontoggle=()=>{node.querySelector('.ws-expand-label').textContent=node.open?'收起明细⌃':'按维度查看⌄';paint()};
  document.querySelector('#rt').append(node);
 }
 function paint(){
  if(!last||!node)return;
  for(const [id,key]of [['ws-current','current'],['ws-peak','peak']])node.querySelector('#'+id).textContent=numeric(last.total[key])+(last.total[key]===null?'':' token/s');
  const curve=node.querySelector('#ws-total-curve');curve.replaceChildren(spark(last.total.points,'近 180 秒总吞吐量'));
  node.querySelectorAll('[data-dimension]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.dimension===dimension)));
  if(!node.open)return;
  const rows=node.querySelector('#ws-throughput-rows');rows.replaceChildren();
  const list=last[dimension]||[];
  if(!list.length){rows.textContent='暂无输出记录';return;}
  for(const item of list){const row=document.createElement('div');row.className='ws-throughput-row';const name=document.createElement('span');name.className='ws-series-name';let label=item.name;
   if(dimension==='providers')label=providers?.providers?.find(p=>p.id===item.id)?.name||label;
   if(dimension==='sessions')label=(state.agents?.find(a=>a.id===item.agent)?.name||item.agent||'Agent')+' · '+(item.name==='Unidentified session'?'未识别会话':item.name);
   name.textContent=label;name.title=label;const stats=document.createElement('span');stats.className='ws-series-stats';stats.textContent='实时 '+numeric(item.current)+' · 峰值 '+numeric(item.peak)+' token/s';row.append(name,spark(item.points,'近 180 秒 '+label+' 吞吐量'),stats);rows.append(row);}
 }
 function status(message){if(node)node.querySelector('#ws-throughput-status').textContent=message;}
 async function poll(token){
  if(!running||document.hidden||token!==visit)return;
  controller=new AbortController();const current=controller;const timeout=setTimeout(()=>current.abort(),5000);
  try{const res=await fetch('/api/gateway/throughput',{signal:current.signal});if(!res.ok)throw new Error('查询失败');const data=await res.json();if(!running||token!==visit)return;
   if(data.status==='unavailable'||data.version!==1||data.total?.points?.length!==180)throw new Error('网关吞吐量暂不可用');
   last=data;paint();status((data.status==='partial'?'部分模型待校准 · ':'')+(data.truncated?'部分维度已淘汰 · ':'')+'更新于 '+new Date(data.asOf*1000).toLocaleTimeString());
  }catch(err){if(running&&token===visit)status('连接中断 · '+(last?'保留最后数据（'+new Date(last.asOf*1000).toLocaleTimeString()+'）':'等待网关数据'));}
  finally{clearTimeout(timeout);if(controller===current)controller=null;if(running&&!document.hidden&&token===visit)timer=setTimeout(()=>poll(token),1000);}
 }
 function start(){mount();if(running)return;running=true;poll(++visit)}
 function stop(){running=false;visit++;clearTimeout(timer);controller?.abort();controller=null;}
 document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);controller?.abort();visit++;}else if(running)poll(++visit)});
 window.workspaceThroughput={start,stop};
})();
