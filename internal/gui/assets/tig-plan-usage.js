// Internal TIG plan information is inferred from listed model IDs. The ledger
// is per user, so numbers are never labelled as an individual key's balance.
(() => {
 let serial=0, timer=null;
 const ch=id=>/(?:-openai)?-(zp|hs|tc)(?:-openai)?$/i.exec(String(id||'').split('/').pop())?.[1]?.toLowerCase();
 const names={zp:'Zhipu · team advanced (estimated)',hs:'Volcengine · AFP',tc:'Tencent · TIG reference'};
 const units={zp:'Zhipu points',hs:'AFP',tc:'Tencent weighted tokens'};
 const fmt=n=>Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
 const text=(tag,value,cls)=>{const e=document.createElement(tag);if(cls)e.className=cls;e.textContent=value;return e};
 async function refresh(){
  const box=document.querySelector('#tig-plan-usage');if(!box)return;const turn=++serial;
  const [p,r]=await Promise.allSettled([fetch('/api/providers').then(x=>{if(!x.ok)throw Error();return x.json()}),fetch('/api/accounting/report?period=tig-plans&format=json').then(x=>{if(!x.ok)throw Error();return x.json()})]);
  if(turn!==serial||!box.isConnected)return;
  if(p.status!=='fulfilled'||!Array.isArray(p.value.providers)){box.hidden=false;box.replaceChildren(text('p',t('TIG plan detection unavailable'),'note'));return;}
  const sources=p.value.providers.filter(x=>x.preset==='aiep-coding-plan'||/^(sub2agent-tigcodingplan|aiep-coding-plan)/.test(x.id||''));
  if(!sources.length){box.hidden=true;box.replaceChildren();return;}
  box.hidden=false;box.replaceChildren(text('h2',t('TIG plan usage')));
  box.append(text('p',t('Detected from available model IDs; entitlement and balance are not confirmed.'),'note'));
  const data=r.status==='fulfilled'?r.value:null;
  {
   const row=text('div','', 'tig-plan-source');
   const available=sources.filter(source=>Array.isArray(source.models));
   if(!available.length){row.append(text('p',t('Model list unavailable'),'note'));box.append(row);return;}
   const channels=[...new Set(available.flatMap(source=>source.models.map(m=>ch(typeof m==='string'?m:m?.id))).filter(Boolean))].sort();
   if(!channels.length)row.append(text('p',t('No recognized plan channels'),'note'));
   for(const id of channels){
    const line=text('div','', 'tig-plan-line'), info=text('div','', 'tig-plan-info');info.append(text('strong',`${t(names[id])} · ${t(units[id])}`));
    const plan=data?.plans?.[id], usage=data?.channels?.[id];
    if(!plan||!usage){info.append(text('p',t('Usage unavailable; waiting for the billing service'),'note'));line.append(info);row.append(line);continue;}
    const win=plan.windows||[], five=win.find(w=>w.id==='rolling_5h');
    if(five){const pct=usage.rolling_5h/five.limit;info.append(text('p',t('Last 5 hours: {used} / {limit} (estimated)',{used:fmt(usage.rolling_5h),limit:fmt(five.limit)}),'note'));if(pct>=(data.warning_thresholds?.[0]??.8))info.append(text('p',t('Estimated usage is near the reference limit; actual balance is unknown.'),'tig-plan-alert'));}
    for(const w of win.filter(w=>w.id!=='rolling_5h')){
     info.append(text('p',t(w.id==='month'?'Reference limit: {limit} per month':'Reference limit: {limit} per subscription week',{limit:fmt(w.limit)}),'note'));
     const observed=w.id==='month'?usage.rolling_30d:usage.rolling_7d;
     if(observed/w.limit>=(data.warning_thresholds?.[0]??.8))info.append(text('p',t('Rolling usage is near the reference limit; the actual reset date is unknown.'),'tig-plan-alert'));
    }
    info.append(text('p',t('Observed last 7 / 30 days: {week} / {month}',{week:fmt(usage.rolling_7d),month:fmt(usage.rolling_30d)}),'note'));
    const consumed=Object.entries(usage.models||{}).sort((a,b)=>b[1]-a[1]);
    if(consumed.length){const details=document.createElement('details'),summary=text('summary',t('Model usage in the last 30 days'));details.append(summary);for(const [model,amount] of consumed)details.append(text('p',`${model}: ${fmt(amount)} ${t(units[id])}`,'note'));info.append(details);}
    if(usage.unpriced)info.append(text('p',t('{n} attempts could not be priced',{n:usage.unpriced}),'tig-plan-alert'));
    const rates=[...new Map((data.rates||[]).filter(x=>x.deployment===id&&available.some(source=>[source.id,source.preset].some(v=>v&&String(v).startsWith(String(x.provider||'').replace(/\*$/,''))))).map(x=>[String(x.model).toLowerCase(),x])).values()];
    if(rates.length){const details=document.createElement('details'),summary=text('summary',t('Model coefficients'));details.append(summary);for(const rate of rates){const v=rate.credit_rates?`${rate.credit_rates.input} / ${rate.credit_rates.cache_read} / ${rate.credit_rates.output}`:String(rate.coefficient);details.append(text('p',`${rate.model}: ${v}`,'note'));}info.append(details);}
    line.append(info);row.append(line);
   }
   box.append(row);
  }
  box.append(text('p',t('Usage combines reported activity by username, not by key. Other devices, shared pools and unreported usage may differ. Subscription reset dates are unknown.'),'note'));
 }
 window.tigPlanUsage={refresh,start:()=>{refresh();if(!timer)timer=setInterval(()=>{if(!document.hidden)refresh()},60000)},stop:()=>{serial++;clearInterval(timer);timer=null}};
})();
