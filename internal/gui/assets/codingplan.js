// Institutional instructions stay with this provider rather than the core script.
export function notice(editor, preset) {
  const box = document.createElement("section");
  box.className = "coding-plan-notice";
  const title = document.createElement("strong");
  title.textContent = "大模型运维助手 · 企微安全须知";
  box.append(title);
  for (const text of [
    "您好！您申请的公有云大模型密钥已下发，请严格遵守以下安全要求：",
    "1. 仅限非敏感代码，仅用于不包含敏感代码的系统研发；",
    "2. 严禁上传重要数据、一级数据、业务数据、客户信息、系统设计文档等敏感资料，或使用本服务处理涉及商业秘密、客户隐私及国家安全的相关信息，涉及敏感数据请用行内专有云服务；",
    "3. 违规需自行担责并接受严肃处理，请妥善保管密钥，切勿泄露、转借。",
    `地址填写网关 ${preset.anthropic}，不要追加 /v1/messages。应用会自动拼接请求路径，并使用 Authorization: Bearer 鉴权。`,
    "API Key 请填写 AIEP 平台申请的 Coding Plan Key（别名含 codeplan / codingplan）；可在平台申请密钥或查看剩余额度。",
  ]) {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    box.append(paragraph);
  }
  editor.querySelector('.ehead .site')?.remove();
  editor.querySelector(".ehead").after(box);
  const rules = document.createElement('section');
  rules.className = 'coding-plan-notice';
  const heading = document.createElement('strong'); heading.textContent = t('TIG plan usage'); rules.append(heading);
  const link = document.createElement('button'); link.type = 'button'; link.className = 'link';
  link.textContent = t('TIG usage guide'); link.onclick = () => api('open', {url:'http://docs.weoa.com/docs/47kgJOEB8WTo77qV'}); rules.append(link);
  const content = document.createElement('div'); content.textContent = t('Usage unavailable; waiting for the billing service'); rules.append(content); box.after(rules);
  fetch('/api/accounting/tig-plans').then(r => { if (!r.ok) throw Error('unavailable'); return r.json(); }).then(data => {
    if (!rules.isConnected) return;
    content.replaceChildren();
    const names = {zp:t('Zhipu · team advanced (estimated)'),hs:t('Volcengine · AFP'),tc:t('Tencent · TIG reference')};
    for (const id of ['zp','hs','tc']) {
      const plan = data.config?.plans?.[id]; if (!plan) continue;
      const row = document.createElement('p'); row.textContent = names[id] + ' · ' + plan.windows.map(w => `${windowName(w.id)} ${Number(w.limit).toLocaleString()} ${planUnit(plan.unit)}`).join(' / '); content.append(row);
    }
    const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = t('Model coefficients'); details.append(summary);
    const explanation = document.createElement('p'); explanation.textContent = t('Input / cached input / output coefficients. Points per 10,000 tokens; off-peak is half. Estimate only; actual charge depends on TIG.'); details.append(explanation);
    const seen = new Set();
    for (const rate of data.rates || []) {
      const key = rate.model + ':' + rate.deployment; if (seen.has(key)) continue; seen.add(key);
      const row = document.createElement('p'); const c = rate.credit_rates;
      row.textContent = `${rate.model} · ${c ? `${c.input} / ${c.cache_read} / ${c.output}` : rate.coefficient} ${planUnit(rate.currency)}`; details.append(row);
    }
    content.append(details);
  }).catch(() => {});
}

function windowName(id) { return id === 'rolling_5h' ? t('5 hours') : id === 'month' ? t('Month') : t('Week'); }
function planUnit(unit) { return unit === 'GLM_POINTS' ? t('Zhipu points') : unit === 'TC_POINTS' ? t('Tencent weighted tokens') : unit === 'VOLC_AFP' ? 'AFP' : ''; }

// Uses the managed plan report; never substitutes hard-coded limits on failure.
export async function models(box, provider) {
  const suffix = id => /(?:-openai)?-(zp|hs|tc)(?:-openai)?$/i.exec(String(id || '').split('/').pop())?.[1]?.toLowerCase();
  const ids = [...new Set((provider.models || []).map(m => suffix(m.id)).filter(Boolean))];
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
    const names = {zp: t('Zhipu · team advanced (estimated)'), hs: t('Volcengine · AFP'), tc: t('Tencent · TIG reference')};
    const descriptions = ids.flatMap(id => {
      const windows = report.plans?.[id]?.windows;
      if (!Array.isArray(windows)) return [];
      return [names[id] + ' · ' + windows.map(w => {
        const name = windowName(w.id);
        return name + ' ' + Number(w.limit).toLocaleString() + ' ' + planUnit(report.plans[id].unit);
      }).join(' / ')];
    });
    if (descriptions.length) line.textContent += '  ' + descriptions.join('　');
  } catch { /* unavailable is distinct from a zero limit */ }
}
