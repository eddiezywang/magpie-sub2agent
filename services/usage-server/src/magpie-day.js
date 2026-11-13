'use strict';

// A faithful port of magpie's data contract:
//   internal/usage/usage.go        Record -> Totals (addFrom/count/countCache/HitRate)
//   internal/usageapi/day.go       Totals -> Day ("usage:day" feed)
//   plugins/day-card/page/view.js  Day -> card (streak/average/versus/hitRate/tokensOf)
//
// magpie reads those Records from local agent session files. Here the very
// same shape is assembled from events stored on the remote server. Keeping
// the contract identical means the day-card's view logic applies unchanged.

const { computeCost } = require('./pricing');
const { dayStamp } = require('./store');
const { agentIcon, modelIcon } = require('./icon-names');

const DAY_AGENTS = 12;   // usageapi/day.go DayAgents
const DAY_MODELS = 12;   // usageapi/day.go DayModels
const LOOP_ERR_TYPE = 'reply_loop';       // usage.go LoopErrType
const CANCELED_ERR_TYPE = 'agent_canceled'; // ledger.go CanceledErrType
const STATUS_CANCELED = 499;               // ledger.go StatusCanceled

function round4(value) {
  if (value == null) return null;
  return Math.round(value * 10_000) / 10_000;
}

// usage.go: CountsNoCache — a vendor that caches but never reports cache tokens.
function countsNoCache(provider) {
  return provider === 'kiro' || provider === 'kiro-plugin';
}

// usage.go: cacheNotCounted / cacheUnknownIn (#3464).
function cacheNotCounted(event) {
  return event.cache_unknown === true ||
    (event.cache_read_tokens + event.cache_write_tokens === 0 && countsNoCache(event.provider));
}

function cacheUnknownIn(event) {
  if(event._summary)return event._summary.cache_unknown_input_tokens;
  if (!cacheNotCounted(event)) return 0;
  return event.input_tokens + event.cache_read_tokens + event.cache_write_tokens;
}

// ledger.go: Failed / Canceled / Answered.
function canceled(event) {
  // The gateway knows a client abort explicitly (outcome:'aborted'); a bare
  // 499 is not proof the agent canceled (magpie ledger.go: CanceledBy also
  // needs the err_type/message). Trust the explicit flag, else the 499+type.
  if (event.canceled === true || event.err_type === CANCELED_ERR_TYPE) return true;
  return Number(event.status_code) === STATUS_CANCELED && event.canceled === true;
}
function failed(event) {
  // Gateway terminal entries always carry an outcome; older captured rows
  // may have no HTTP status. Treat outcome:'error' as the local equivalent
  // of magpie's Status>=400/Error!="" (ledger.go:51).
  return (Number(event.status_code) >= 400 || Boolean(event.error_code) || event.outcome === 'error') &&
    !canceled(event);
}

function emptyTotals() {
  return {
    calls: 0,
    errors: 0,
    retried: 0,
    canceled: 0,
    loops: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cacheWrite1h: 0,
    cacheUnknown: 0,
    cacheUnknownCalls: 0,
    reasoning: 0,
    cost: 0,
    unpriced: 0,
    credits: 0,
    credited: 0,
    timed: 0,
    ttftMs: 0,
    decodeMs: 0,
    decodeOut: 0,
    decodeN: 0,
    upBytes: 0,
    downBytes: 0,
  };
}

// usage.go Totals.addFrom + count + countCache.
function addRecord(totals, event, pricingTable) {
  const t = totals;
  if(event._summary){
    const g=event._summary;t.calls+=g.requests;t.errors+=g.failed;t.canceled+=g.canceled;
    t.input+=g.input_tokens;t.output+=g.output_tokens;t.cacheRead+=g.cache_read_tokens;
    t.cacheWrite+=g.cache_write_5m_tokens+g.cache_write_1h_tokens;t.cacheWrite1h+=g.cache_write_1h_tokens;
    t.cacheUnknown+=g.cache_unknown_input_tokens;t.cacheUnknownCalls+=g.cache_unknown_calls;
    t.reasoning+=g.reasoning_tokens;t.timed+=g.ttft_samples;t.ttftMs+=g.ttft_ms_sum;
    const charge=computeCost(pricingTable,event.model,event);
    if(charge.priced)t.cost+=charge.cost;else if(g.input_tokens+g.output_tokens>0)t.unpriced+=g.attempts;
    return;
  }
  // magpie Record.Credits is a pointer: null/absent means "no credit info",
  // while an explicit 0 is a real reported value. Number(null) would be 0.
  if (event.credits !== null && event.credits !== undefined && Number.isFinite(Number(event.credits))) {
    t.credits += Number(event.credits);
    t.credited += 1;
  }
  t.calls += 1;
  if (canceled(event)) t.canceled += 1;
  else if (failed(event)) {
    t.errors += 1;
    if (event.err_type === LOOP_ERR_TYPE) t.loops += 1;
  } else if (Number(event.tries) > 1) t.retried += 1;

  t.input += event.input_tokens;
  t.output += event.output_tokens;
  t.cacheRead += event.cache_read_tokens;
  t.cacheWrite += event.cache_write_tokens;
  t.cacheWrite1h += event.cache_write_1h_tokens || 0;
  if (cacheNotCounted(event)) {
    t.cacheUnknown += cacheUnknownIn(event);
    t.cacheUnknownCalls += 1;
  }
  t.reasoning += event.reasoning_tokens || 0;
  t.upBytes += event.up_bytes || 0;
  t.downBytes += event.down_bytes || 0;
  if (event.ttft_ms > 0 && !failed(event) && !canceled(event)) {
    t.timed += 1;
    t.ttftMs += event.ttft_ms;
    if (event.decode_ms > 0) {
      t.decodeMs += event.decode_ms;
      t.decodeOut += event.decode_out_tokens || 0;
      t.decodeN += 1;
    }
  }
  // usage.go: a call with no input AND no output is neither priced nor unpriced.
  if (event.input_tokens + event.output_tokens === 0) return;
  const cost = computeCost(pricingTable, event.model, {
    ...event,
    own_cost_usd: event.own_cost_usd,
  });
  if (!cost.priced) t.unpriced += 1;
  else t.cost += cost.cost;
}

// usage.go Totals.HitRate (#3464): read / (input + read + write - unknown),
// null when no vendor-counted prompt remains.
function hitRate(t) {
  const prompt = t.input + t.cacheRead + t.cacheWrite - t.cacheUnknown;
  if (prompt <= 0) return null;
  return Math.min(1, t.cacheRead / prompt);
}

// view.js tokensOf: in + out + through the cache.
function tokensOf(t) {
  return t.input + t.output + t.cacheRead + t.cacheWrite;
}

function dayTotalsView(t) {
  return {
    calls: t.calls,
    errors: t.errors,
    retried: t.retried || undefined,
    canceled: t.canceled || undefined,
    loops: t.loops || undefined,
    input: t.input,
    output: t.output,
    cacheRead: t.cacheRead,
    cacheWrite: t.cacheWrite,
    cacheWrite1h: t.cacheWrite1h || undefined,
    cacheUnknown: t.cacheUnknown || undefined,
    cacheUnknownCalls: t.cacheUnknownCalls || undefined,
    reasoning: t.reasoning,
    // Keep full float precision in the data feed: view.money renders a
    // sub-cent amount as "<$0.01". round4() here would turn it into $0.00 and
    // also flip versus() from the cost ratio to the token fallback.
    cost: t.cost,
    unpriced: t.unpriced,
    credits: t.credits || undefined,
    credited: t.credited || undefined,
    timed: t.timed || undefined,
    ttftMs: t.ttftMs || undefined,
    decodeMs: t.decodeMs || undefined,
    decodeOut: t.decodeOut || undefined,
    decodeN: t.decodeN || undefined,
    upBytes: t.upBytes || undefined,
    downBytes: t.downBytes || undefined,
  };
}

// The provider a model belongs to (usageapi/day.go splits "provider/model").
// Our model ids have no slash, so use the event's provider, then the same
// prefix families as magpie's internal/agent/icons.go byFamily.
const PROVIDER_FACES = {
  claude: { name: 'Anthropic', icon: 'claude-color' },
  anthropic: { name: 'Anthropic', icon: 'anthropic' },
  gpt: { name: 'OpenAI', icon: 'openai' },
  o1: { name: 'OpenAI', icon: 'openai' },
  o3: { name: 'OpenAI', icon: 'openai' },
  o4: { name: 'OpenAI', icon: 'openai' },
  codex: { name: 'OpenAI', icon: 'openai' },
  gemini: { name: 'Google', icon: 'gemini-color' },
  gemma: { name: 'Google', icon: 'gemini-color' },
  deepseek: { name: 'DeepSeek', icon: 'deepseek-color' },
  grok: { name: 'xAI', icon: 'xai' },
  kimi: { name: 'Moonshot', icon: 'kimi' },
  moonshot: { name: 'Moonshot', icon: 'kimi' },
  glm: { name: 'Zhipu', icon: 'zhipu-color' },
  qwen: { name: 'Qwen', icon: 'qwen-color' },
  qwq: { name: 'Qwen', icon: 'qwen-color' },
  mistral: { name: 'Mistral', icon: 'mistral-color' },
  codestral: { name: 'Mistral', icon: 'mistral-color' },
  devstral: { name: 'Mistral', icon: 'mistral-color' },
  magistral: { name: 'Mistral', icon: 'mistral-color' },
  minimax: { name: 'MiniMax', icon: 'minimax-color' },
  step: { name: 'StepFun', icon: 'stepfun-color' },
};

// A vendor id, not the icon prefix: magpie's providerFaces keys off the
// provider's own id, and usage:day's DayModel.provider carries that id.
const PREFIX_TO_PROVIDER = {
  claude: 'anthropic', anthropic: 'anthropic',
  gpt: 'openai', o1: 'openai', o3: 'openai', o4: 'openai', codex: 'openai',
  gemini: 'google', gemma: 'google',
  deepseek: 'deepseek', grok: 'xai',
  kimi: 'moonshot', moonshot: 'moonshot',
  glm: 'zhipu', qwen: 'qwen', qwq: 'qwen',
  mistral: 'mistral', codestral: 'mistral', devstral: 'mistral', magistral: 'mistral',
  minimax: 'minimax', step: 'stepfun',
};

function providerFace(event, model) {
  const id = String(model || '').toLowerCase();
  let provider = String(event.provider || '').toLowerCase();
  if (!provider || !PREFIX_TO_PROVIDER[provider]) {
    provider = Object.keys(PREFIX_TO_PROVIDER).find((prefix) => id.startsWith(prefix)) || '';
  }
  const vendor = PREFIX_TO_PROVIDER[provider] || 'generic';
  const face = PROVIDER_FACES[provider];
  return {
    provider: vendor,
    name: face ? face.name : (vendor === 'generic' ? 'Unknown' : vendor),
    icon: face ? face.icon : modelIcon(model),
  };
}

// usageapi/day.go SpanOf: build the "usage:day" feed from a set of events.
function buildDay({ events, pricingTable, from, date, today, dayCounts = [], now = () => new Date() }) {
  const totals = emptyTotals();
  const agents = new Map(); // agent id -> {totals, models: Map}
  for (const event of events) {
    addRecord(totals, event, pricingTable);
    const agentId = event.agent || '';
    let agent = agents.get(agentId);
    if (!agent) {
      agent = { totals: emptyTotals(), models: new Map() };
      agents.set(agentId, agent);
    }
    addRecord(agent.totals, event, pricingTable);
    // usageapi/day.go groups by "provider/model", not by model alone: the
    // same model behind two relays is two ledger rows.
    const face = providerFace(event, event.model);
    const groupKey = `${face.provider}/${event.model || 'unknown'}`;
    let model = agent.models.get(groupKey);
    if (!model) {
      model = { totals: emptyTotals(), face, modelId: event.model || 'unknown' };
      agent.models.set(groupKey, model);
    }
    addRecord(model.totals, event, pricingTable);
  }

  // usageapi/day.go caps the breakdown BEFORE the card sorts by cost:
  // tokens desc, calls desc, id asc (reference ledger.go:1134-1160).
  // view.card() then re-sorts the retained rows by cost/tokens for display.
  const byBreakdown = (a, b) =>
    tokensOf(b.totals) - tokensOf(a.totals) ||
    b.totals.calls - a.totals.calls ||
    String(a.id).localeCompare(String(b.id));
  const byCost = (a, b) => b.totals.cost - a.totals.cost || tokensOf(b.totals) - tokensOf(a.totals);
  const agentList = [...agents.entries()]
    .map(([id, a]) => ({ id, ...a }))
    .sort(byBreakdown);
  const shownAgents = agentList.slice(0, DAY_AGENTS).map((a) => {
    const models = [...a.models.entries()]
      .map(([model, m]) => ({ id: model, model, ...m }))
      .sort(byBreakdown);
    return {
      id: a.id,
      name: a.id || 'unknown',
      icon: agentIcon(a.id) || 'generic',
      ...dayTotalsView(a.totals),
      models: models.slice(0, DAY_MODELS).map((m) => ({
        model: m.modelId,
        provider: m.face.provider,
        providerName: m.face.name,
        icon: m.face.icon,
        ...dayTotalsView(m.totals),
      })),
      moreModels: Math.max(0, models.length - DAY_MODELS),
    };
  });

  return {
    from: from || date,
    date,
    today,
    ...dayTotalsView(totals),
    currency: 'USD',
    rate: 1,
    agents: shownAgents,
    moreAgents: Math.max(0, agentList.length - DAY_AGENTS),
    days: dayCounts, // [{date, calls, tokens, cost}] — usageapi DayCount
    hitRate: hitRate(totals),
    tokens: tokensOf(totals),
  };
}

// ---- view.js consumption semantics (plugins/day-card/page/view.js) ----

function shift(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function streak(days, date, today) {
  const had = new Set((days || []).filter((d) => Number(d.calls) > 0).map((d) => d.date));
  let at = date;
  if (!had.has(at) && at === today) at = shift(at, -1);
  let n = 0;
  while (had.has(at)) {
    n += 1;
    at = shift(at, -1);
  }
  return n;
}

function average(days, date) {
  const list = (days || []).filter((d) => d.date < date && Number(d.calls) > 0);
  if (!list.length) return null;
  const sum = list.reduce(
    (s, d) => ({ tokens: s.tokens + (Number(d.tokens) || 0), cost: s.cost + (Number(d.cost) || 0) }),
    { tokens: 0, cost: 0 },
  );
  return { days: list.length, tokens: sum.tokens / list.length, cost: sum.cost / list.length };
}

function versus(day, avg) {
  if (!avg) return null;
  let r = 0;
  if (avg.cost > 0 && Number(day.cost) > 0) r = Number(day.cost) / avg.cost;
  else if (avg.tokens > 0) r = Number(day.tokens || tokensOf(day)) / avg.tokens;
  else return null;
  return r;
}

module.exports = {
  emptyTotals,
  addRecord,
  canceled,
  failed,
  cacheNotCounted,
  cacheUnknownIn,
  hitRate,
  tokensOf,
  dayTotalsView,
  providerFace,
  buildDay,
  streak,
  average,
  versus,
  DAY_AGENTS,
  DAY_MODELS,
};
