// A shared Agent surface: connection diagnostics and native bulk wiring.
let active=false,generation=0,snapshot=null,busy=false,failures=[],resultText='';
const pending=new Set();
window.agentConnectionBusy=id=>busy||pending.has(id);
window.agentConnectionStatus=id=>snapshot?.[id]?.status;
// Native row writes and the bulk queue share a gate: each returns a full state.
window.agentConnectionAcquire=id=>{
 if(busy||pending.size)return false;
 pending.add(id);draw();
 return ()=>{pending.delete(id);draw();};
};
const visible=()=>!document.getElementById('view-agents')?.hidden;
export function leave(){active=false;snapshot=null;generation++;}
export async function refresh(){leave();await enter();return t('Agents looked for again');}
function candidates(){return (state.agents||[]).filter(a=>!a.cliMissing&&!a.wired&&connectable(a)&&snapshot?.[a.id]&&snapshot[a.id].status!=='unknown'&&!pending.has(a.id));}
function draw(){
 if(!visible())return;
 const page=document.getElementById('view-agents');
 let bar=page.querySelector('.agent-bulk');
 if(!bar){bar=document.createElement('div');bar.className='agent-bulk';page.prepend(bar);}
 bar.replaceChildren();
 const button=el('button','text',t('Connect every Agent'));const count=candidates().length;
 button.disabled=busy||pending.size>0||!count;button.textContent+=`（${count}）`;button.onclick=()=>run(candidates());bar.append(button);
 const result=el('span','agent-bulk-result');result.setAttribute('role','status');result.textContent=resultText;bar.append(result);
 if((state.agents||[]).some(a=>snapshot?.[a.id]?.status==='unknown')){
  const recheck=el('button','text connection-recheck',t('Check again'));
  recheck.disabled=busy||pending.size>0;recheck.onclick=()=>refresh().catch(statusErr);bar.append(recheck);
 }
 if(failures.length){const retry=el('button','text',t('Retry failed connections'));retry.disabled=busy||pending.size>0;retry.onclick=()=>run(failures.map(x=>state.agents.find(a=>a.id===x.id)).filter(a=>a&&!a.wired));bar.append(retry);}
 for(const row of document.querySelectorAll('#agents .agent[data-id]')){
  row.querySelector('.connection-check')?.remove();row.querySelector('.connection-adapt')?.remove();
  const check=snapshot?.[row.dataset.id];if(!check)continue;
  if(check.status==='unknown'){
   const line=row.querySelector('.ag-st-t')||row.querySelector('.sub');if(line){line.textContent=t('Could not read connection configuration');line.setAttribute('role','status');const status=line.closest('.ag-st');status?.classList.remove('on','bad');status?.classList.add('wait');}
  }else if(check.status==='configured'&&!check.managed){
   const line=row.querySelector('.ag-st-t')||row.querySelector('.sub');
   if(line)line.textContent=t('Adapt existing connection');
   const control=row.querySelector('.ag-conn');if(control)control.title=t('Adapt existing connection');
  }
 }
}
async function run(list){
 if(busy||pending.size)return;busy=true;failures=[];const visit=generation;let success=0,skipped=0;
 draw();
 for(let i=0;i<list.length;i++){
  if(visit!==generation||!visible()){skipped+=list.length-i;break;}
  const a=state.agents.find(x=>x.id===list[i].id);
  if(!a||a.cliMissing||a.wired||!connectable(a)||!snapshot?.[a.id]||snapshot[a.id].status==='unknown'||pending.has(a.id)){skipped++;continue;}
  pending.add(a.id);
  const statusLine=document.querySelector('.agent-bulk-result');resultText=t('Connecting {i}/{n} · {agent}',{i:i+1,n:list.length,agent:a.name});if(statusLine)statusLine.textContent=resultText;
  try{const next=await api('agents/connect/'+encodeURIComponent(a.id),{});if(visit===generation){state=next;renderAgents();}success++;}
  catch(err){failures.push({id:a.id,name:a.name,error:err.message});}
  finally{pending.delete(a.id);}
 }
 busy=false;
 resultText=t('Connected {ok} · Failed {failed} · Skipped {skipped}',{ok:success,failed:failures.length,skipped})+(failures.length?'; '+failures.map(x=>x.name+': '+t(x.error)).join('; '):'');
 if(visible()){
  const finishVisit=generation;
  try{const next=await api('state');if(finishVisit!==generation||!visible())return;state=next;renderAgents();}catch(err){if(finishVisit===generation)statusErr(err)}
  if(finishVisit!==generation||!visible())return;
  snapshot=null;active=false;await enter();draw();
 }
}
export async function enter(){
 if(!visible())return;
 if(active){draw();return;}
 active=true;const visit=generation;
 try{
  const next=await api('agents/connections');if(visit!==generation||!visible())return;
  snapshot=Object.fromEntries(next.agents.map(a=>[a.id,next.checks?.[a.id]||{status:'unknown'}]));const previous=new Map((state.agents||[]).map(a=>[a.id,a]));
  state.agents=next.agents.map(a=>({...previous.get(a.id),...a}));renderAgents();draw();
 }catch(err){if(visit===generation&&visible()){
  // A failed read is unknown, even for rows retained from an earlier state.
  // Keep this visit active: redraws must not start an automatic retry loop.
  snapshot=Object.fromEntries((state.agents||[]).map(a=>[a.id,{status:'unknown'}]));
  renderAgents();draw();statusErr(err);
 }}
}
