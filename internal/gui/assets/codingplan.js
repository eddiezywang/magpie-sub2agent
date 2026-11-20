// Institutional instructions stay with this provider rather than the core script.
export function notice(editor, preset, provider) {
  const box = document.createElement("section");
  box.className = "coding-plan-notice";
  const title = document.createElement("strong");
  title.textContent = "澶фā鍨嬭繍缁村姪鎵?路 浼佸井瀹夊叏椤荤煡";
  box.append(title);
  for (const text of [
    "鎮ㄥソ锛佹偍鐢宠鐨勫叕鏈変簯澶фā鍨嬪瘑閽ュ凡涓嬪彂锛岃涓ユ牸閬靛畧浠ヤ笅瀹夊叏瑕佹眰锛?,
    "1. 浠呴檺闈炴晱鎰熶唬鐮侊紝浠呯敤浜庝笉鍖呭惈鏁忔劅浠ｇ爜鐨勭郴缁熺爺鍙戯紱",
    "2. 涓ョ涓婁紶閲嶈鏁版嵁銆佷竴绾ф暟鎹€佷笟鍔℃暟鎹€佸鎴蜂俊鎭€佺郴缁熻璁℃枃妗ｇ瓑鏁忔劅璧勬枡锛屾垨浣跨敤鏈湇鍔″鐞嗘秹鍙婂晢涓氱瀵嗐€佸鎴烽殣绉佸強鍥藉瀹夊叏鐨勭浉鍏充俊鎭紝娑夊強鏁忔劅鏁版嵁璇风敤琛屽唴涓撴湁浜戞湇鍔★紱",
    "3. 杩濊闇€鑷鎷呰矗骞舵帴鍙椾弗鑲冨鐞嗭紝璇峰Ε鍠勪繚绠″瘑閽ワ紝鍒囧嬁娉勯湶銆佽浆鍊熴€?,
    `鍦板潃濉啓缃戝叧 ${preset.anthropic}锛屼笉瑕佽拷鍔?/v1/messages銆傚簲鐢ㄤ細鑷姩鎷兼帴璇锋眰璺緞锛屽苟浣跨敤 Authorization: Bearer 閴存潈銆俙,
    "API Key 璇峰～鍐?AIEP 骞冲彴鐢宠鐨?Coding Plan Key锛堝埆鍚嶅惈 codeplan / codingplan锛夛紱鍙湪骞冲彴鐢宠瀵嗛挜鎴栨煡鐪嬪墿浣欓搴︺€?,
  ]) {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    box.append(paragraph);
  }
  editor.querySelector('.ehead .site')?.remove();
  if (!provider) editor.querySelector(".ehead").after(box);
  const rules = document.createElement('section');
  rules.className = 'coding-plan-notice';
  const heading = document.createElement('strong'); heading.textContent = t('TIG plan usage'); rules.append(heading);
  const link = document.createElement('button'); link.type = 'button'; link.className = 'link';
  link.textContent = t('TIG usage guide'); link.onclick = () => api('open', {url:'http://docs.weoa.com/docs/47kgJOEB8WTo77qV'}); rules.append(link);
  const content = document.createElement('div'); content.textContent = t('Usage unavailable; waiting for the billing service'); rules.append(content);
  if (provider) editor.querySelector('.ehead').after(rules); else box.after(rules);
  fetch('/api/accounting/tig-plans').then(r => { if (!r.ok) throw Error('unavailable'); return r.json(); }).then(data => {
    if (!rules.isConnected) return;
    content.replaceChildren();
    const names = {zp:t('Zhipu 路 team advanced'),hs:t('Volcengine 路 AFP'),tc:t('Tencent 路 TIG reference')};
    const channels = provider ? [...new Set((provider.models || []).map(m => channel(m.id)).filter(Boolean))] : ['zp','hs','tc'];
    if (!channels.length) { content.textContent = t('No recognized plan channels'); return; }
    const tabs = document.createElement('div'); tabs.className = 'segs tig-plan-tabs'; tabs.setAttribute('role', 'tablist');
    const panel = document.createElement('div'); panel.className = 'tig-plan-panel';
    content.append(tabs, panel);
    const selectedModels = new Set((provider?.models || []).map(m => canonical(m.id)));
    const select = id => {
      tabs.querySelectorAll('button').forEach(b => { const on = b.dataset.channel === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
      panel.replaceChildren();
      const plan = data.config?.plans?.[id];
      if (!plan || !Array.isArray(plan.windows)) { panel.textContent = t('Usage unavailable; waiting for the billing service'); return; }
      const row = document.createElement('p'); row.textContent = names[id] + ' 路 ' + plan.windows.map(w => `${windowName(w.id)} ${Number(w.limit).toLocaleString(intlLang())} ${planUnit(plan.unit)}`).join(' / '); panel.append(row);
      const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = t('Model coefficients'); details.append(summary);
      if (id === 'zp') { const explanation = document.createElement('p'); explanation.textContent = t('Input / cached input / output coefficients. Points per 10,000 tokens; off-peak is half. Estimate only; actual charge depends on TIG.'); details.append(explanation); }
      const list = document.createElement('div'); list.className = 'tig-plan-rates';
      const seen = new Set();
      for (const rate of data.rates || []) {
        const key = canonical(rate.model); if (rate.deployment !== id || seen.has(key) || provider && !selectedModels.has(key)) continue; seen.add(key);
        const item = document.createElement('p'), c = rate.credit_rates;
        item.textContent = `${rate.model} 路 ${c ? `${c.input} / ${c.cache_read} / ${c.output}` : rate.coefficient} ${planUnit(rate.currency)}`; list.append(item);
      }
      if (!seen.size) list.textContent = t('Billing rule unknown');
      details.append(list); panel.append(details);
    };
    for (const id of channels) { const button = document.createElement('button'); button.type = 'button'; button.className = 'opt'; button.dataset.channel = id; button.setAttribute('role','tab'); button.textContent = names[id]; button.onclick = () => select(id); tabs.append(button); }
    select(channels[0]);
  }).catch(() => {});
}

function windowName(id) { return id === 'rolling_5h' ? t('5 hours') : id === 'month' ? t('TIG plan month') : t('TIG plan week'); }
function planUnit(unit) { return unit === 'GLM_POINTS' ? t('Zhipu points') : unit === 'TC_POINTS' ? t('Tencent weighted tokens') : unit === 'VOLC_AFP' ? 'AFP' : ''; }
function channel(id) { return /(?:-openai)?-(zp|hs|tc)(?:-openai)?$/i.exec(String(id || '').split('/').pop())?.[1]?.toLowerCase(); }
function canonical(id) { return String(id || '').split('/').pop().toLowerCase().replace(/-openai-(zp|hs|tc)$/, '-$1').replace(/-(zp|hs|tc)-openai$/, '-$1'); }

// Uses the managed plan report; never substitutes hard-coded limits on failure.
export async function models(box, provider) {
  const ids = [...new Set((provider.models || []).map(m => channel(m.id)).filter(Boolean))];
  if (!ids.length) return;
  const line = document.createElement('div');
  line.className = 'hint billing-legend';
  line.textContent = t('Detected from available model IDs; entitlement and balance are not confirmed.');
  box.querySelector('.mchips')?.before(line);
  try {
    const response = await fetch('/api/accounting/tig-plans');
    if (!response.ok) return;
    const report = (await response.json()).config;
    if (!line.isConnected) return;
    const names = {zp: t('Zhipu 路 team advanced'), hs: t('Volcengine 路 AFP'), tc: t('Tencent 路 TIG reference')};
    const descriptions = ids.flatMap(id => {
      const windows = report.plans?.[id]?.windows;
      if (!Array.isArray(windows)) return [];
      return [names[id] + ' 路 ' + windows.map(w => {
        const name = windowName(w.id);
        return name + ' ' + Number(w.limit).toLocaleString(intlLang()) + ' ' + planUnit(report.plans[id].unit);
      }).join(' / ')];
    });
    if (descriptions.length) line.textContent += '  ' + descriptions.join('銆€');
  } catch { /* unavailable is distinct from a zero limit */ }
}
