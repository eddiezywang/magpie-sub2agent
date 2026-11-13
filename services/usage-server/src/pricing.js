'use strict';

// Pricing table for billing. Prices are USD per million tokens, maintained
// server-side and updatable in real time via PUT /admin/pricing; updates
// re-price historical aggregation on the fly (raw token events are kept, only
// the derived cost changes).
//
// Seed prices below are Anthropic first-party list prices (verified against the
// claude-api reference, 2026-11). cache_write seeds follow Anthropic's 1.25x
// input convention; explicit cache_read prices are used where published.
// The offline catalog snapshot is exported by the desktop's MakerPrice lookup.
// Administrator prices override it, including explicit deployment variants.

const fs = require('node:fs');
const path = require('node:path');
const catalog = require('./catalog-prices.json');

const PRICING_FILE = 'pricing.json';
const SCHEMA = 'sub2agent-pricing/1';

// $ per 1M tokens: [input, output, cache_read, cache_write]
const SEED_PRICES = {
  'claude-fable-5-2': [8, 40, 0.2, 10],
  'claude-mythos-5-2': [8, 40, 0.2, 10],
  'claude-fable-5-1': [10, 50, 0.2, 12.5],
  'claude-fable-5': [10, 50, 0.2, 12.5],
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-opus-5': [5, 25, 0.5, 6.25],
  'claude-opus-4-8': [5, 25, 0.5, 6.25],
  'claude-opus-4-7': [5, 25, 0.5, 6.25],
  'claude-opus-4-6': [5, 25, 0.5, 6.25],
  'claude-sonnet-5-5': [2, 10, 0.1, 2.5],
  'claude-sonnet-5': [2, 10, 0.2, 2.5],
  'claude-sonnet-4-6': [3, 15, 0.3, 3.75],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
  'claude-haiku-4-5': [1, 5, 0.1, 1.25],
};

function seedModels(nowIso) {
  const models = {};
  for (const [name, price] of Object.entries(catalog.models)) {
    models[name] = { ...price, updated_at: nowIso, source: 'catalog.MakerPrice' };
  }
  for (const [name, [input, output, cacheRead, cacheWrite]] of Object.entries(SEED_PRICES)) {
    if (models[name]) continue;
    models[name] = {
      input,
      output,
      cache_read: cacheRead,
      cache_write: cacheWrite,
      updated_at: nowIso,
      source: 'seed',
    };
  }
  return models;
}

function normalizePriceEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const price = {};
  for (const key of ['input', 'output', 'cache_read', 'cache_write']) {
    const value = Number(entry[key]);
    if (!Number.isFinite(value) || value < 0) return null;
    price[key] = value;
  }
  // Optional 1-hour cache-write rate (Claude defaults to 2x input).
  if (entry.cache_write_1h !== undefined && entry.cache_write_1h !== null) {
    const value = Number(entry.cache_write_1h);
    if (!Number.isFinite(value) || value < 0) return null;
    price.cache_write_1h = value;
  }
  if (entry.tiers !== undefined) {
    if (!Array.isArray(entry.tiers)) return null;
    price.tiers = [];
    for (const tier of entry.tiers) {
      const normalized = normalizePriceEntry({...tier,tiers:undefined});
      if (!normalized || !Number.isSafeInteger(tier.above) || tier.above <= 0) return null;
      price.tiers.push({...normalized,above:tier.above});
    }
    price.tiers.sort((a,b)=>a.above-b.above);
  }
  if (entry.peak) {
    if (!catalog.peak_days[entry.peak]) return null;
    price.peak = entry.peak;
  }
  return price;
}

// Resolve "claude-sonnet-4-5-20250929" style snapshots to the base entry.
function resolveModelKey(models, model) {
  if (!model) return null;
  if (models[model]) return model;
  const stripped = String(model).replace(/-\d{8}$/, '').replace(/-latest$/, '');
  if (stripped && stripped !== model && models[stripped]) return stripped;
  const bare=String(model).trim().toLowerCase().split('/').pop();
  const deployed=/^(glm-|deepseek-|minimax-|hy)/.test(bare)
    ? bare.replace(/-maas(?:-[a-z0-9_.-]+)?$/,'').replace(/-zp(?:-openai)?$/,'') : bare;
  for (const name of [bare,deployed,deployed.replace(/-\d{8}$/,'').replace(/-latest$/,'')]) {
    if (models[name]) return name;
  }
  return null;
}

/**
 * Cost of one request. `virtual` is what the same tokens would have cost with
 * zero cache hits (cache tokens at full input price) — the difference is the
 * savings attributable to prompt caching.
 *
 * Anthropic's 1-hour cache writes are billed at 2x input while 5-minute
 * writes are 1.25x. `cache_write_1h` is an optional fifth rate; when a record
 * reports `cache_write_1h_tokens`, that subset is charged at the higher rate
 * and the remainder at `cache_write` (magpie usage.go CostSplit semantics).
 */
function computeCost(table, model, tokens) {
  const input = Math.max(0, Number(tokens.input_tokens) || 0);
  const output = Math.max(0, Number(tokens.output_tokens) || 0);
  const cacheRead = Math.max(0, Number(tokens.cache_read_tokens) || 0);
  const cacheWrite = Math.max(0, Number(tokens.cache_write_tokens) || 0);
  const key = resolveModelKey(table.models, model);
  if (!key) {
    return { priced: false, cost: 0, virtual: 0, pricing: null, modelKey: null };
  }
  let price = table.models[key];
  const tiers = price.tiers || [];
  if (tokens._summary && tiers.length) {
    // A minute total cannot reveal the input size of its individual calls.
    // Never apply a request-size tier to the sum of the minute's tokens.
    return {priced:false,cost:0,virtual:0,pricing:null,modelKey:key,reason:'context_classification_required'};
  }
  if (!tokens._summary) {
    for (const tier of tiers) if(input+cacheRead+cacheWrite>tier.above) price={...price,...tier};
  }
  let factor=1;
  const at=new Date(tokens.ts);
  if (price.peak && Number.isFinite(at.getTime())) {
    const hour=at.getUTCHours();
    const inHours=price.peak==='ollama' ? hour>=12&&hour<18 : hour>=1&&hour<4||hour>=6&&hour<10;
    if(inHours && catalog.peak_days[price.peak].includes(at.toISOString().slice(0,10)))factor=2;
  }
  const perMillion = (tokens, rate) => (tokens * rate) / 1_000_000;
  const write1h = Math.min(cacheWrite, Math.max(0, Number(tokens.cache_write_1h_tokens) || 0));
  const write5m = cacheWrite - write1h;
  // A record may carry its own reported cost (magpie Record.OwnCost).
  const ownCost = tokens.own_cost_usd;
  const cost = Number.isFinite(Number(ownCost)) && ownCost !== null && ownCost !== undefined
    ? Math.max(0, Number(ownCost))
    : factor * (perMillion(input, price.input) +
      perMillion(output, price.output) +
      perMillion(cacheRead, price.cache_read) +
      perMillion(write5m, price.cache_write) +
      perMillion(write1h, Number.isFinite(Number(price.cache_write_1h))
        ? Number(price.cache_write_1h)
        : /claude/i.test(key) && price.cache_write>0 ? 2*price.input : price.cache_write));
  const virtual =
    perMillion(input + cacheRead + cacheWrite, price.input) +
    perMillion(output, price.output);
  return { priced: true, cost, virtual:virtual*factor, pricing: price, modelKey: key };
}

function createPricingStore({ dataDir, now = () => new Date() } = {}) {
  const filePath = dataDir ? path.join(dataDir, PRICING_FILE) : null;
  let table = null;

  function ensureTable() {
    if (table) return table;
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (raw && raw.models && typeof raw.models === 'object') {
        table = {
          schema: raw.schema || SCHEMA,
          currency: raw.currency || 'USD',
          updated_at: raw.updated_at || now().toISOString(),
          models: seedModels(now().toISOString()),
        };
        for (const [name, entry] of Object.entries(raw.models)) {
          if (catalog.models[name] && ['seed','catalog.MakerPrice'].includes(entry.source)) continue;
          const price = normalizePriceEntry(entry);
          if (price) {
            table.models[name] = {
              ...price,
              updated_at: entry.updated_at || table.updated_at,
              source: entry.source || 'admin',
            };
          }
        }
        return table;
      }
    } catch {
      // Missing or corrupt file: fall through to seed.
    }
    table = {
      schema: SCHEMA,
      currency: 'USD',
      updated_at: now().toISOString(),
      models: seedModels(now().toISOString()),
    };
    persist();
    return table;
  }

  function persist() {
    if (!filePath) return true;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `${JSON.stringify(table, null, 2)}\n`, 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  function get() {
    return ensureTable();
  }

  /** entries: { modelName: {input, output, cache_read, cache_write} } */
  function setModels(entries) {
    ensureTable();
    if (!entries || typeof entries !== 'object') {
      throw new Error('pricing.models must be an object of {input, output, cache_read, cache_write}');
    }
    // Validate the WHOLE update first: a bad entry must not leave earlier
    // models already mutated in the live table (a 400 that still changed prices).
    const updatedAt = now().toISOString();
    const candidate = [];
    for (const [name, rawEntry] of Object.entries(entries)) {
      const cleanName = String(name).trim();
      if (!cleanName) throw new Error('model name must be a non-empty string');
      const price = normalizePriceEntry(rawEntry);
      if (!price) {
        throw new Error(`invalid price entry for ${cleanName}: input/output/cache_read/cache_write must be non-negative numbers`);
      }
      candidate.push([cleanName, { ...price, updated_at: updatedAt, source: 'admin' }]);
    }
    const nextModels = { ...table.models };
    for (const [name, price] of candidate) nextModels[name] = price;
    const nextTable = { ...table, models: nextModels, updated_at: updatedAt };
    if (candidate.length > 0) {
      const previous = table;
      table = nextTable;
      if (!persist()) {
        table = previous; // never claim a saved update that failed to persist
        throw new Error('failed to persist pricing table');
      }
    }
    return { applied: candidate.length, table: snapshot() };
  }

  function removeModel(name) {
    ensureTable();
    if (table.models[name]) {
      delete table.models[name];
      table.updated_at = now().toISOString();
      persist();
    }
    return snapshot();
  }

  function snapshot() {
    const current = ensureTable();
    return JSON.parse(JSON.stringify(current));
  }

  function costFor(model, tokens) {
    return computeCost(ensureTable(), model, tokens);
  }

  return { get, setModels, removeModel, costFor, snapshot };
}

module.exports = {
  createPricingStore,
  computeCost,
  resolveModelKey,
  SEED_PRICES,
  SCHEMA,
};
