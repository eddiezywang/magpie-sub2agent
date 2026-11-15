// Compose existing pages. No copies of agent rows or provider editors.
window.addEventListener('load', async () => {
  const surface=new URLSearchParams(location.search).get('view')||'routing';
  document.body.dataset.surface=surface;
  await window.show(surface);
  const fixIcons=()=>{
    document.querySelectorAll('img[src^="icons/"]').forEach(img=>img.src='../../../build/intranet/pixel-icons/'+img.getAttribute('src').split('/').pop());
    document.querySelectorAll('image.app-mark').forEach(img=>{const href='../../../build/intranet/pixel-icons/sub2agent.svg';if(img.getAttribute('href')!==href)img.setAttribute('href',href)});
  };
  fixIcons();
  new MutationObserver(fixIcons).observe(document.body,{childList:true,subtree:true});
  const resize=()=>{
    const page=document.querySelector('#view-'+surface);
    const modal=document.querySelector('#modal');
    parent.postMessage({type:'native-height',surface,height:Math.max(page.scrollHeight+16,modal&&!modal.hidden?760:0)},location.origin);
  };
  new ResizeObserver(resize).observe(document.querySelector('#view-'+surface));
  new MutationObserver(resize).observe(document.querySelector('#modal'),{attributes:true,attributeFilter:['hidden']});
  resize();
  if(surface!=='routing')return;
  const host=document.querySelector('#rt');
  const controls=document.createElement('div');controls.className='ws-route-controls';
  controls.innerHTML='<label for="ws-route-preset">预定义路由组</label><select id="ws-route-preset" aria-label="预定义路由组"></select><span id="ws-route-feedback" role="status"></span><a href="../../../design-preview/routing-workspace.html?view=groups" target="_top">编辑路由组 ›</a>';
  workspaceSamples.groups.forEach(g=>{const o=document.createElement('option');o.value=g.id;o.textContent=g.name;controls.querySelector('select').append(o)});
  host.before(controls);
  const presetPicker=segs(workspaceSamples.groups.map(g=>[g.id,g.name]),workspaceSamples.groups[0].id,id=>{controls.querySelector('#ws-route-feedback').textContent='已选择 '+workspaceSamples.groups.find(g=>g.id===id).name+'（预览）'});
  presetPicker.setAttribute('aria-label','预定义路由组');controls.querySelector('label').removeAttribute('for');controls.querySelector('select').replaceWith(presetPicker);
  const node=document.createElement('details');node.id='throughput';node.className='ws-throughput';
  node.innerHTML='<summary><div class="rt-stats"><span><b><span id="ws-current">0.0</span><small class="ws-unit">token/s</small></b><span>实时吞吐量</span></span><span><b><span id="ws-peak">0.0</span><small class="ws-unit">token/s</small></b><span>峰值吞吐量</span></span></div><span class="ws-expand"><svg viewBox="0 0 220 24" role="img" aria-label="近 180 秒总吞吐量"><path id="ws-summary-line"/></svg><span id="ws-expand-label">按维度查看</span><svg style="width:12px" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></span></summary><div class="ws-dimensions" role="group" aria-label="吞吐量维度"><button class="text" data-dimension="provider" aria-pressed="true">供应商</button><button class="text" data-dimension="model" aria-pressed="false">模型</button><button class="text" data-dimension="session" aria-pressed="false">会话</button></div><table class="ws-table"><thead><tr><th id="ws-dimension-name">供应商</th><th class="ws-trend-column">近 180 秒</th><th>实时 token/s</th><th>峰值 token/s</th></tr></thead><tbody id="ws-rows"></tbody></table><p class="ws-note">模拟数据 · 每秒刷新，最近 5 秒平均输出 token/s · 峰值为本次预览以来最高值</p>';
  host.append(node);
  const streams=[{provider:'WorkBuddy 企业',model:'示例模型 A',session:'OpenCode · 会话 01',base:56},{provider:'WorkBuddy 企业',model:'示例模型 B',session:'Pi · 会话 02',base:38}];
  let step=0,dimension='provider',totalPeak=0;
  const recentRates=streams.map(()=>[]);
  const values={},peaks={provider:{},model:{},session:{}},histories={provider:{},model:{},session:{}},totalHistory=[];
  const path=values=>{const ceiling=Math.max(...values,1)*1.1;return values.map((v,i)=>(i?'L':'M')+(i*220/Math.max(values.length-1,1)).toFixed(2)+','+(23-v/ceiling*21).toFixed(2)).join(' ')};
  const draw=()=>{
    const rows=document.querySelector('#ws-rows');
    const entries=Object.entries(values[dimension]);
    if(rows.dataset.dimension!==dimension){rows.replaceChildren();rows.dataset.dimension=dimension;entries.forEach(([name])=>{const row=rows.insertRow();row.insertCell().textContent=name;const graph=row.insertCell();graph.className='ws-trend-column';graph.innerHTML='<svg class="ws-spark" viewBox="0 0 220 26" role="img" aria-label="近 180 秒吞吐量趋势"><path/></svg>';row.insertCell();row.insertCell()})}
    entries.forEach(([name,value],i)=>{const row=rows.rows[i];row.cells[2].textContent=value.toFixed(1);row.cells[3].textContent=peaks[dimension][name].toFixed(1);row.querySelector('path').setAttribute('d',path(histories[dimension][name]))});
  };
  const update=()=>{
    const rates=streams.map((x,i)=>{
      const recent=recentRates[i];recent.push(x.base*(.85+.18*Math.sin(step*.23+i)+.08*Math.cos(step*.59)));if(recent.length>5)recent.shift();
      return recent.reduce((sum,value)=>sum+value,0)/recent.length;
    });
    const total=rates.reduce((a,b)=>a+b,0);totalPeak=Math.max(totalPeak,total);
    document.querySelector('#ws-current').textContent=total.toFixed(1);document.querySelector('#ws-peak').textContent=totalPeak.toFixed(1);
    totalHistory.push(total);if(totalHistory.length>180)totalHistory.shift();document.querySelector('#ws-summary-line').setAttribute('d',path(totalHistory));
    for(const kind of ['provider','model','session']){values[kind]={};streams.forEach((x,i)=>values[kind][x[kind]]=(values[kind][x[kind]]||0)+rates[i]);for(const [name,value]of Object.entries(values[kind])){peaks[kind][name]=Math.max(peaks[kind][name]||0,value);const h=histories[kind][name]||=[];h.push(value);if(h.length>180)h.shift()}}
    if(node.open)draw();step++;
  };
  // Seed three synthetic minutes, then advance once per second.
  for(let i=0;i<180;i++)update();
  setInterval(()=>{if(!document.hidden)update()},1000);
  node.addEventListener('toggle',()=>{document.querySelector('#ws-expand-label').textContent=node.open?'收起明细':'按维度查看';if(node.open)draw();resize()});
  node.querySelectorAll('[data-dimension]').forEach(b=>b.onclick=()=>{dimension=b.dataset.dimension;node.querySelectorAll('[data-dimension]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));document.querySelector('#ws-dimension-name').textContent=b.textContent;draw()});
});
