// Keep authentication, refresh and inference in the pinned MIT community source.
export function adaptWorkBuddySource(source) {
  source = source.replace(/\r\n/g, '\n');
  const marker = 'async function liveModels(site, a) {';
  if (source.split(marker).length !== 2) throw new Error('WorkBuddy catalog seam changed');
  // Apply our provider compatibility policy before signing/compressing. Keep
  // the reviewed community transport, but replace its broader prompt rewrites
  // and system-as-user retries with the shared, bounded policy.
  const replaceOnce = (from, to) => {
    if (source.split(from).length !== 2) throw new Error('WorkBuddy compatibility seam changed');
    source = source.replace(from, () => to);
  };
  const rulesStart = source.indexOf('const FLAGGED = [');
  const dshStart = source.indexOf('  // DeepSeek Harness (DSH)', rulesStart);
  if (rulesStart < 0 || dshStart < 0) throw new Error('WorkBuddy rules seam changed');
  source = source.slice(0, rulesStart) + 'const FLAGGED = [\n' + source.slice(dshStart);
  replaceOnce('function unflagged(text) {\n  for (const [re, to] of FLAGGED) text = text.replace(re, to)\n  return text\n}',
    `function unflagged(text, role = 'system') {
  text = normalizeClientText(text, role)
  if (['system', 'developer', 'assistant'].includes(role)) {
    for (const [re, to] of FLAGGED) text = text.replace(re, to)
  }
  return text
}`);
  replaceOnce('unflagged(m.content)', 'unflagged(m.content, m.role)');
  replaceOnce('unflagged(p.text)', 'unflagged(p.text, m.role)');
  const start = source.indexOf('            if (res.status === 400 && !native) {');
  const end = source.indexOf('              const again = res.status === 400 && !endsAfterTools.has(model)', start);
  if (start < 0 || end < 0) throw new Error('WorkBuddy retry seam changed');
  source = source.slice(0, start) + `            if (!native) res = await withChannelFallback(res, {
              body, signal: init?.signal ?? req?.signal,
              send: next => { body = next; return send(shaped(body)) },
            })
            if (!native && res.headers.has('X-Sub2Agent-Upstream-Status')) return kept(res, renewed ? 'renewed' : 'kept')
            if (res.status === 400 && !native) {
              let text = await res.text()
` + source.slice(end);
  // Never apply a previously cached role-demotion policy in this distribution.
  replaceOnce('if (sysKey && refusedSystems.has(sysKey) && systemAsUserOn(chat)) changed = true', '// System instructions retain their original role.');
  return `import {normalizeClientText, withChannelFallback} from 'sub2agent/core/workbuddy-prompt-compat';\n` +
    source.replace(marker, marker + '\n  if (site.catalog) return site.catalog();') +
    '\nexport {makePlugin, current, meter, reissued};\n';
}
