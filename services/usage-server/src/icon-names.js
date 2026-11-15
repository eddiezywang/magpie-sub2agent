'use strict';

// Icon naming, ported from magpie's internal/agent/icons.go: a model is
// known by its id's family prefix, an agent by its id; anything else has no
// icon at all, never a made-up one (the receipt draws a plain dot).

// byFamily pairs a model id prefix with the vendor logo it belongs to.
const BY_FAMILY = [
  ['claude', 'claude-color'],
  ['gpt', 'openai'], ['o1', 'openai'], ['o3', 'openai'], ['o4', 'openai'], ['codex', 'openai'],
  ['gemini', 'gemini-color'], ['gemma', 'gemini-color'],
  ['deepseek', 'deepseek-color'],
  ['grok', 'xai'],
  ['kimi', 'kimi'], ['moonshot', 'kimi'],
  ['glm', 'zhipu-color'],
  ['qwen', 'qwen-color'], ['qwq', 'qwen-color'],
  ['mistral', 'mistral-color'], ['codestral', 'mistral-color'], ['devstral', 'mistral-color'], ['magistral', 'mistral-color'],
  ['minimax', 'minimax-color'],
  ['mimo', 'mimocode'], ['xiaomi', 'mimocode'],
  ['step', 'stepfun-color'],
];

const BY_AGENT = [
  ['claude', 'claudecode-color'],
  ['codex', 'codex-color'],
  ['opencode', 'opencode'],
  ['zcode', 'zcode'],
  ['pi', 'pi'],
  ['dsh', ''],
  ['anthropic-client', 'anthropic'],
  ['openai-client', 'openai'],
  ['openai', 'openai'],
  ['gemini', 'geminicli-color'],
  ['cursor', 'cursor'],
  ['copilot', 'githubcopilot'],
  ['crush', 'crush'],
  ['goose', 'goose'],
  ['trae', 'trae'],
  ['windsurf', 'windsurf'],
  ['workbuddy', 'workbuddy-color'],
  ['codebuddy', 'codebuddy-color'],
];

/** The vendor logo of a model id ("claude-opus-5-5" → "claude-color"). */
function modelIcon(model) {
  let id = String(model || '').toLowerCase();
  const slash = id.indexOf('/');
  if (slash >= 0) id = id.slice(slash + 1); // "vendor/model" on relays
  for (const [prefix, icon] of BY_FAMILY) {
    if (id.startsWith(prefix)) return icon;
  }
  return '';
}

/** The logo of an agent id ("claude-code" → "claudecode-color"). Matches
 * whole segments only — "anthropic-client" must not read as "pi". */
function agentIcon(agent) {
  const id = String(agent || '').toLowerCase().trim();
  if (!id || id === 'unknown') return '';
  const segments = id.split(/[-_.]/);
  for (const [needle, icon] of BY_AGENT) {
    if (!icon) continue;
    if (id === needle || id.startsWith(`${needle}-`) || segments.includes(needle)) {
      return icon;
    }
  }
  return '';
}

module.exports = { modelIcon, agentIcon, BY_FAMILY, BY_AGENT };
