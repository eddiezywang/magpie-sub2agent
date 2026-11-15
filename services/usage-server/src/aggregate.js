'use strict';

// Billing aggregation: turns raw usage events into daily/weekly report JSON.
// Cost math lives here (via pricing.computeCost); token events are the source
// of truth, pricing changes re-price history on the fly.

const { computeCost } = require('./pricing');
const { dayStamp, stampToDate } = require('./store');
const { agentIcon, modelIcon } = require('./icon-names');
const { buildDay, hitRate, tokensOf, streak, canceled, failed, cacheNotCounted, cacheUnknownIn } = require('./magpie-day');

const REPORT_SCHEMA = 'sub2agent-usage-report/1';

function safeRatio(numerator, denominator) {
  const num = Number(numerator) || 0;
  const den = Number(denominator) || 0;
  if (den <= 0) return null;
  return num / den;
}

function round4(value) {
  if (value == null) return null;
  return Math.round(value * 10_000) / 10_000;
}

function addDay(stamp, days) {
  const date = stampToDate(stamp);
  date.setDate(date.getDate() + days);
  return dayStamp(date);
}

// Monday-based week containing the given stamp; returns array of 7 stamps.
function weekStamps(stamp) {
  const date = stampToDate(stamp);
  const weekday = (date.getDay() + 6) % 7; // 0 = Monday
  const monday = addDay(stamp, -weekday);
  return Array.from({ length: 7 }, (_, index) => addDay(monday, index));
}

function aggregateEvents(events, pricingTable) {
  const totals = {
    requests: 0,
    ok: 0,
    error: 0,
    aborted: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_usd: 0,
    virtual_cost_usd: 0,
    unpriced_requests: 0,
    cache_unknown_tokens: 0,
  };
  const byModel = new Map();
  const byAgent = new Map();
  const byAgentModel = new Map(); // agent -> (model -> row)

  for (const event of events) {
    const weight=event._summary?.requests ?? 1;
    totals.requests += weight;
    // Share magpie's status definition with the day feed so the legacy
    // aliases can never disagree with day.calls/errors/unpriced.
    if(event._summary){totals.aborted+=event._summary.canceled;totals.error+=event._summary.failed;totals.ok+=event._summary.success;}
    else if (canceled(event)) totals.aborted += 1;
    else if (failed(event)) totals.error += 1;
    else totals.ok += 1;

    totals.input_tokens += event.input_tokens;
    totals.output_tokens += event.output_tokens;
    totals.cache_read_tokens += event.cache_read_tokens;
    totals.cache_write_tokens += event.cache_write_tokens;
    // magpie #3464: a vendor that never counts cache tokens has its whole
    // prompt excluded from the hit-rate denominator.
    const unknownTokens = cacheNotCounted(event) ? cacheUnknownIn(event) : 0;
    totals.cache_unknown_tokens += unknownTokens;

    const cost = computeCost(pricingTable, event.model, {
      ...event,
      own_cost_usd: event.own_cost_usd,
    });
    totals.cost_usd += cost.cost;
    totals.virtual_cost_usd += cost.virtual;
    // usage.go: a call with no input AND no output is neither priced nor
    // unpriced. Align with magpie-day.addRecord's early return.
    if (!cost.priced && event.input_tokens + event.output_tokens > 0) totals.unpriced_requests += event._summary?.attempts ?? 1;

    const modelKey = event.model || 'unknown';
    let modelRow = byModel.get(modelKey);
    if (!modelRow) {
      modelRow = {
        model: modelKey,
        requests: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        cache_unknown_tokens: 0,
        cost_usd: 0,
        virtual_cost_usd: 0,
        priced: cost.priced,
      };
      byModel.set(modelKey, modelRow);
    }
    modelRow.requests += weight;
    modelRow.input_tokens += event.input_tokens;
    modelRow.output_tokens += event.output_tokens;
    modelRow.cache_read_tokens += event.cache_read_tokens;
    modelRow.cache_write_tokens += event.cache_write_tokens;
    modelRow.cache_unknown_tokens += unknownTokens;
    modelRow.cost_usd += cost.cost;
    modelRow.virtual_cost_usd += cost.virtual;
    modelRow.priced = modelRow.priced || cost.priced;

    const agentKey = event.agent || 'unknown';
    let agentRow = byAgent.get(agentKey);
    if (!agentRow) {
      agentRow = { agent: agentKey, requests: 0, cost_usd: 0 };
      byAgent.set(agentKey, agentRow);
    }
    agentRow.requests += weight;
    agentRow.cost_usd += cost.cost;

    // Two-level agent → model breakdown for the receipt-style card.
    let agentModels = byAgentModel.get(agentKey);
    if (!agentModels) {
      agentModels = new Map();
      byAgentModel.set(agentKey, agentModels);
    }
    let pairRow = agentModels.get(modelKey);
    if (!pairRow) {
      pairRow = { model: modelKey, requests: 0, cost_usd: 0, priced: cost.priced };
      agentModels.set(modelKey, pairRow);
    }
    pairRow.requests += weight;
    pairRow.cost_usd += cost.cost;
    pairRow.priced = pairRow.priced || cost.priced;
  }

  return { totals, byModel, byAgent, byAgentModel };
}

function totalsView(totals) {
  const input = totals.input_tokens;
  const output = totals.output_tokens;
  const cacheRead = totals.cache_read_tokens;
  // magpie usage.go HitRate (#3464): read / (input + read + write − unknown).
  // Older formula omitted cacheWrite and never excluded cache-unknown calls.
  const magpieLike = {
    input,
    cacheRead,
    cacheWrite: totals.cache_write_tokens,
    cacheUnknown: totals.cache_unknown_tokens || 0,
  };
  return {
    requests: totals.requests,
    ok: totals.ok,
    error: totals.error,
    aborted: totals.aborted,
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_write_tokens: totals.cache_write_tokens,
    total_tokens: input + output + cacheRead + totals.cache_write_tokens,
    cost_usd: round4(totals.cost_usd),
    virtual_cost_usd: round4(totals.virtual_cost_usd),
    cache_saved_usd: round4(Math.max(0, totals.virtual_cost_usd - totals.cost_usd)),
    cache_hit_rate: round4(hitRate(magpieLike)),
    input_share: round4(safeRatio(input, input + output)),
    output_share: round4(safeRatio(output, input + output)),
    input_output_ratio: round4(safeRatio(input, output)),
    unpriced_requests: totals.unpriced_requests,
  };
}

function modelRowsView(byModel) {
  return [...byModel.values()]
    .sort((a, b) => b.cost_usd - a.cost_usd || b.requests - a.requests)
    .map((row) => {
      const cacheRead = row.cache_read_tokens;
      const total = row.input_tokens + row.output_tokens + cacheRead + row.cache_write_tokens;
      return {
        model: row.model,
        requests: row.requests,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cache_read_tokens: cacheRead,
        cache_write_tokens: row.cache_write_tokens,
        total_tokens: total,
        cost_usd: round4(row.cost_usd),
        virtual_cost_usd: round4(row.virtual_cost_usd),
        cache_saved_usd: round4(Math.max(0, row.virtual_cost_usd - row.cost_usd)),
        cache_hit_rate: round4(hitRate({
          input: row.input_tokens,
          cacheRead,
          cacheWrite: row.cache_write_tokens,
          cacheUnknown: row.cache_unknown_tokens || 0,
        })),
        input_share: round4(safeRatio(row.input_tokens, row.input_tokens + row.output_tokens)),
        output_share: round4(safeRatio(row.output_tokens, row.input_tokens + row.output_tokens)),
        input_output_ratio: round4(safeRatio(row.input_tokens, row.output_tokens)),
        priced: row.priced,
      };
    });
}

function agentRowsView(byAgent) {
  const totalCost = [...byAgent.values()].reduce((sum, row) => sum + row.cost_usd, 0);
  return [...byAgent.values()]
    .sort((a, b) => b.requests - a.requests)
    .map((row) => ({
      agent: row.agent,
      requests: row.requests,
      cost_usd: round4(row.cost_usd),
      share: round4(safeRatio(row.cost_usd, totalCost)) ?? round4(safeRatio(row.requests, totalsRequests(byAgent))),
    }));
}

function totalsRequests(byAgent) {
  return [...byAgent.values()].reduce((sum, row) => sum + row.requests, 0);
}

/** Receipt-style two-level breakdown: agent groups with nested model rows, both cost-desc. */
function agentModelGroupsView(byAgentModel) {
  return [...byAgentModel.entries()]
    .map(([agent, models]) => {
      const rows = [...models.values()].sort((a, b) => b.cost_usd - a.cost_usd || b.requests - a.requests);
      return {
        agent,
        icon: agentIcon(agent),
        requests: rows.reduce((sum, row) => sum + row.requests, 0),
        cost_usd: round4(rows.reduce((sum, row) => sum + row.cost_usd, 0)),
        models: rows.map((row) => ({
          model: row.model,
          icon: modelIcon(row.model),
          requests: row.requests,
          cost_usd: round4(row.cost_usd),
          priced: row.priced,
        })),
      };
    })
    .sort((a, b) => b.cost_usd - a.cost_usd || b.requests - a.requests);
}

function pctChange(current, previous) {
  const cur = Number(current);
  const prev = Number(previous);
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function dayTotals(events, pricingTable) {
  const { totals } = aggregateEvents(events, pricingTable);
  return {
    requests: totals.requests,
    total_tokens:
      totals.input_tokens + totals.output_tokens + totals.cache_read_tokens + totals.cache_write_tokens,
    cost_usd: round4(totals.cost_usd),
  };
}

// Receipt "连续使用 N 天" — count back from the period end, capping the
// lookback so a lazy walk never scans the whole 400-day keep window.
const MAX_STREAK_LOOKBACK_DAYS = 90;

function consecutiveActiveDays(store, userKey, endStamp) {
  const active = store.activeDaysForUser(userKey, addDay(endStamp, -(MAX_STREAK_LOOKBACK_DAYS - 1)), endStamp);
  // Anchor on the most recent active day (the calendar period end may be a
  // future date with no data — e.g. a weekly report rendered mid-week), then
  // count consecutive active days back from there.
  let anchor = -1;
  for (let index = 0; index < MAX_STREAK_LOOKBACK_DAYS; index += 1) {
    if (active.has(addDay(endStamp, -index))) {
      anchor = index;
      break;
    }
  }
  if (anchor < 0) return 0;
  let streak = 0;
  for (let index = anchor; index < MAX_STREAK_LOOKBACK_DAYS; index += 1) {
    if (!active.has(addDay(endStamp, -index))) break;
    streak += 1;
  }
  return streak;
}

// Usage duration + session count from the telemetry feed (the old
// /events埋点): desktop_proxy_usage_flushed carries --proxy-usage-ms — the
// proxy's active window, a much finer "how long they actually used it"
// than day streaks — and desktop_proxy_start counts sessions. Matched by
// install id, falling back to username.
function telemetryStats(telemetryStore, user, startStamp, endStamp) {
  if (!telemetryStore) return { active_ms: 0, sessions: 0 };
  const events = telemetryStore.readRange(startStamp, endStamp);
  let activeMs = 0;
  let sessions = 0;
  for (const event of events) {
    const mine =
      (user.install_id && event.install_id === user.install_id) ||
      (!user.install_id && user.username && event.username === user.username);
    if (!mine) continue;
    if (event.event === 'desktop_proxy_usage_flushed') {
      const ms = Number(event.args && event.args['proxy-usage-ms']);
      if (Number.isFinite(ms) && ms > 0) activeMs += ms;
    } else if (event.event === 'desktop_proxy_start') {
      sessions += 1;
    }
  }
  return { active_ms: Math.round(activeMs), sessions };
}

function buildPeriodReport({ store, pricing, user, stamps, type, label, generatedAt, now, telemetryStore }) {
  const pricingTable = pricing.get();
  const events = store.eventsForUser(user.key, stamps[0], stamps[stamps.length - 1]);
  const eventsByStamp = new Map();
  for (const event of events) {
    const stamp = dayStamp(new Date(event.ts));
    if (!eventsByStamp.has(stamp)) eventsByStamp.set(stamp, []);
    eventsByStamp.get(stamp).push(event);
  }

  const { totals, byModel, byAgent, byAgentModel } = aggregateEvents(events, pricingTable);

  // usageapi/day.go HeatmapOf: all days with calls up to the period end,
  // oldest first, so view.js can compute streak and an average day.
  const endStamp = stamps[stamps.length - 1];
  const allEvents = store.eventsForUser(user.key, '19700101', endStamp);
  const byDayAll = new Map();
  for (const event of allEvents) {
    const stamp = dayStamp(new Date(event.ts));
    if (!byDayAll.has(stamp)) byDayAll.set(stamp, []);
    byDayAll.get(stamp).push(event);
  }
  const dayCounts = [...byDayAll.entries()]
    .map(([stamp, dayEvents]) => {
      const sum = dayTotals(dayEvents, pricingTable);
      return {
        date: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`,
        calls: sum.requests,
        tokens: sum.total_tokens,
        cost: sum.cost_usd,
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // Calendar-week reports can end on a future Sunday mid-week. Magpie's
  // SpanOf rejects dates after today and never renders a future `date`,
  // otherwise view.streak() anchors on a day that has no calls yet → 0.
  // Cap the feed's effective end at today (the period/trend still show the
  // full calendar week, which is this product's intentional span choice).
  const todayStamp = dayStamp(now());
  const feedEndStamp = endStamp > todayStamp ? todayStamp : endStamp;
  const iso = (stamp) => `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
  const day = buildDay({
    events,
    pricingTable,
    from: iso(stamps[0]),
    date: iso(feedEndStamp),
    today: iso(todayStamp),
    dayCounts: dayCounts.filter((d) => d.date <= iso(feedEndStamp)),
    now,
  });

  const daily = stamps.map((stamp) => ({
    date: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`,
    ...(dayTotals(eventsByStamp.get(stamp) || [], pricingTable)),
  }));

  const prevStamps = stamps.map((stamp) => addDay(stamp, -stamps.length));
  const prevFirst = store.eventsForUser(user.key, prevStamps[0], prevStamps[0]);
  const prevRest = prevStamps.length > 1
    ? store.eventsForUser(user.key, prevStamps[1], prevStamps[prevStamps.length - 1])
    : [];
  const previous = dayTotals([...prevFirst, ...prevRest], pricingTable);
  // Compare like with like: the whole period vs the whole previous period.
  // (Comparing the last calendar slot reads as -100% when rendered mid-period,
  // since future days have no events yet. For daily reports the period total
  // IS that single day, so both types share this path.)
  const current = dayTotals(events, pricingTable);

  // Receipt stats, following the magpie day-card's view.js: the streak of
  // consecutive days with calls, and (daily reports) this day's cost as a
  // multiple of the average of ALL earlier days that had calls — falling
  // back to tokens when nothing had a price. Weekly reports instead show
  // active days in the period and the average cost of an active day.
  let vsDailyAvg = null;
  let activeDays = 0;
  let avgActiveDay = 0;
  if (type === 'daily') {
    // All days the store still keeps (its prune window), up to the day
    // before the report, grouped by local day stamp.
    const historyEvents = store.eventsForUser(user.key, addDay(endStamp, -399), addDay(endStamp, -1));
    const byDay = new Map();
    for (const event of historyEvents) {
      const stamp = dayStamp(new Date(event.ts));
      if (!byDay.has(stamp)) byDay.set(stamp, []);
      byDay.get(stamp).push(event);
    }
    let sumCost = 0;
    let sumTokens = 0;
    for (const dayEvents of byDay.values()) {
      const d = dayTotals(dayEvents, pricingTable);
      sumCost += d.cost_usd;
      sumTokens += d.total_tokens;
    }
    const n = byDay.size;
    if (n > 0 && sumCost > 0 && current.cost_usd > 0) {
      vsDailyAvg = Math.round((current.cost_usd / (sumCost / n)) * 100) / 100;
    } else if (n > 0 && sumTokens > 0) {
      vsDailyAvg = Math.round((current.total_tokens / (sumTokens / n)) * 100) / 100;
    }
  } else {
    const seen = new Set();
    for (const event of events) {
      seen.add(dayStamp(new Date(event.ts)));
    }
    activeDays = seen.size;
    avgActiveDay = activeDays ? Math.round((current.cost_usd / activeDays) * 10_000) / 10_000 : 0;
  }

  return {
    schema: REPORT_SCHEMA,
    user: { id: user.install_id, name: user.username, key: user.key },
    // magpie's "usage:day" feed, assembled from the remote event store.
    // The day-card's view.card() consumes this shape verbatim.
    day,
    period: {
      type,
      label,
      start: `${stamps[0].slice(0, 4)}-${stamps[0].slice(4, 6)}-${stamps[0].slice(6, 8)}`,
      end: `${stamps[stamps.length - 1].slice(0, 4)}-${stamps[stamps.length - 1].slice(4, 6)}-${stamps[stamps.length - 1].slice(6, 8)}`,
      generated_at: generatedAt,
    },
    totals: totalsView(totals),
    by_model: modelRowsView(byModel),
    by_agent: agentRowsView(byAgent),
    by_agent_model: agentModelGroupsView(byAgentModel),
    stats: {
      // Single source of truth: view.js streak() over the day feed's days[],
      // instead of a separate store scan that could anchor on a stale day.
      streak_days: streak(dayCounts, day.date, day.today),
      vs_daily_avg: vsDailyAvg,
      active_days: activeDays,
      avg_active_day: avgActiveDay,
      ...telemetryStats(telemetryStore, user, stamps[0], endStamp),
    },
    trend: {
      daily,
      previous,
      change: {
        cost_pct: pctChange(current.cost_usd, previous.cost_usd),
        tokens_pct: pctChange(current.total_tokens, previous.total_tokens),
        requests_pct: pctChange(current.requests, previous.requests),
      },
    },
  };
}

function normalizeDateParam(value, now) {
  if (value == null || value === '') return dayStamp(now());
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (!match) return null;
  const stamp = `${match[1]}${match[2]}${match[3]}`;
  const date = stampToDate(stamp);
  if (!Number.isFinite(date.getTime()) || dayStamp(date) !== stamp) return null;
  return stamp;
}

function createAggregator({ store, pricing, now = () => new Date(), telemetryStore = null }) {
  function dailyReport(user, dateParam) {
    const stamp = normalizeDateParam(dateParam, now);
    if (!stamp) return { error: 'invalid_date' };
    return buildPeriodReport({
      store,
      pricing,
      user,
      stamps: [stamp],
      type: 'daily',
      label: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`,
      generatedAt: now().toISOString(),
      now,
      telemetryStore,
    });
  }

  function weeklyReport(user, dateParam) {
    const stamp = normalizeDateParam(dateParam, now);
    if (!stamp) return { error: 'invalid_date' };
    const stamps = weekStamps(stamp);
    return buildPeriodReport({
      store,
      pricing,
      user,
      stamps,
      type: 'weekly',
      label: `week ${stamps[0].slice(4, 6)}/${stamps[0].slice(6, 8)} - ${stamps[6].slice(4, 6)}/${stamps[6].slice(6, 8)}`,
      generatedAt: now().toISOString(),
      now,
      telemetryStore,
    });
  }

  return { dailyReport, weeklyReport, normalizeDateParam };
}

module.exports = {
  createAggregator,
  aggregateEvents,
  totalsView,
  agentModelGroupsView,
  safeRatio,
  weekStamps,
  normalizeDateParam,
  REPORT_SCHEMA,
};
