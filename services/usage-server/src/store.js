'use strict';

// Usage event store: one append-only JSONL file per local day
// (usage-YYYYMMDD.jsonl), modelled on the client's request-log persist design.
// Ingest deduplicates by event id (clients may retry batches), reads are
// mtime-cached, and pruning enforces a keep-window.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DAY_FILE_RE = /^usage-(\d{8})\.jsonl$/;
const DEFAULT_KEEP_DAYS = 400;

function dayStamp(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function stampToDate(stamp) {
  return new Date(Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1, Number(stamp.slice(6, 8)));
}

// A count must be a finite, non-negative safe integer. JSON can deliver
// "Infinity" (Number → Infinity → JSON.stringify writes null → silently 0 on
// the next read) or negative byte counts; both corrupt cumulative accounting.
// Absent optional fields fall back; an explicit invalid value rejects the row.
function parseCount(value, fallback) {
  if (value === null || value === undefined || value === '') return { ok: true, value: fallback };
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? { ok: true, value: n } : { ok: false, value: null };
}

function normalizeEvent(raw, { now = () => new Date() } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null;
  if (!id) return null;

  let ts = typeof raw.ts === 'string' && raw.ts ? raw.ts : null;
  const tsTime = ts ? Date.parse(ts) : NaN;
  if (!Number.isFinite(tsTime)) ts = now().toISOString();

  // Required token counts: absent → 0, explicit invalid → reject the row.
  // Optional counts: absent → 0/null, explicit invalid → reject as well so
  // no Infinity/negative ever reaches the JSONL store.
  const req = (v) => parseCount(v, 0);
  const opt = (v) => parseCount(v, 0);
  const optN = (v) => parseCount(v, null);
  const fields = {
    input_tokens: req(raw.input_tokens),
    output_tokens: req(raw.output_tokens),
    cache_read_tokens: req(raw.cache_read_tokens),
    cache_write_tokens: req(raw.cache_write_tokens),
    raw_prompt_tokens: optN(raw.raw_prompt_tokens),
    duration_ms: optN(raw.duration_ms),
    status_code: optN(raw.status_code),
    tries: parseCount(raw.tries, 1),
    credits: optN(raw.credits),
    own_cost_usd: parseCount(raw.own_cost_usd, null),
    cache_write_1h_tokens: opt(raw.cache_write_1h_tokens),
    reasoning_tokens: opt(raw.reasoning_tokens),
    ttft_ms: optN(raw.ttft_ms),
    decode_ms: optN(raw.decode_ms),
    decode_out_tokens: opt(raw.decode_out_tokens),
    up_bytes: optN(raw.up_bytes),
    down_bytes: optN(raw.down_bytes),
  };
  if (Object.values(fields).some((f) => !f.ok)) return null;
  const v = Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.value]));
  const event = {
    id,
    ts,
    install_id: typeof raw.install_id === 'string' && raw.install_id ? raw.install_id : null,
    username: typeof raw.username === 'string' && raw.username ? raw.username : null,
    model: typeof raw.model === 'string' && raw.model ? raw.model : null,
    ...v,
    agent: typeof raw.agent === 'string' && raw.agent ? raw.agent : null,
    session: typeof raw.session === 'string' && raw.session ? raw.session : null,
    outcome: typeof raw.outcome === 'string' && raw.outcome ? raw.outcome : null,
    streamed: raw.streamed === true,
    source_id: typeof raw.source_id === 'string' && raw.source_id ? raw.source_id : null,
    usage_source: typeof raw.usage_source === 'string' && raw.usage_source ? raw.usage_source : null,
    // Magpie Record fields (see usage-server/src/magpie-day.js).
    requested_model: typeof raw.requested_model === 'string' && raw.requested_model ? raw.requested_model : null,
    served_model: typeof raw.served_model === 'string' && raw.served_model ? raw.served_model : null,
    upstream: typeof raw.upstream === 'string' && raw.upstream ? raw.upstream : null,
    provider: typeof raw.provider === 'string' && raw.provider ? raw.provider : null,
    error_code: typeof raw.error_code === 'string' && raw.error_code ? raw.error_code : null,
    err_type: typeof raw.err_type === 'string' && raw.err_type ? raw.err_type : null,
    canceled: raw.canceled === true,
    cache_unknown: raw.cache_unknown === true,
  };
  if (!event.model && !event.input_tokens && !event.output_tokens) return null;
  return event;
}

function eventUserKey(event) {
  // Canonical identity is the install id; username is display + fallback key.
  return event.install_id || `name:${event.username || 'unknown'}`;
}

function createUsageStore({ dataDir, keepDays = DEFAULT_KEEP_DAYS, now = () => new Date() } = {}) {
  if (!dataDir) throw new Error('usage store requires dataDir');

  const dayCache = new Map(); // stamp -> {mtimeMs, events}
  const seenIds = new Map(); // stamp -> Set(eventId), lazy per day
  let userIndex = null; // key -> {install_id, username, first_seen, last_seen, events}

  function dayFilePath(stamp) {
    return path.join(dataDir, `usage-${stamp}.jsonl`);
  }

  function ensureDir() {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch {
      // Read paths treat a missing dir as empty.
    }
  }

  function listDayFiles() {
    try {
      return fs
        .readdirSync(dataDir)
        .map((name) => {
          const match = DAY_FILE_RE.exec(name);
          return match ? { name, stamp: match[1] } : null;
        })
        .filter(Boolean)
        .sort((a, b) => (a.stamp < b.stamp ? -1 : 1));
    } catch {
      return [];
    }
  }

  function loadSeen(stamp) {
    let set = seenIds.get(stamp);
    if (!set) {
      set = new Set();
      for (const event of readDay(stamp)) set.add(event.id);
      seenIds.set(stamp, set);
    }
    return set;
  }

  function stampForEvent(event) {
    const time = new Date(event.ts);
    return Number.isFinite(time.getTime()) ? dayStamp(time) : dayStamp(now());
  }

  /**
   * Append one normalized event. Returns 'stored' | 'duplicate' | 'invalid'
   * | 'write_failed'. A failed disk write must never look like a rejected
   * row: the client retries on non-2xx and would otherwise drop the batch.
   */
  function append(raw) {
    const event = normalizeEvent(raw, { now });
    if (!event) return 'invalid';
    const stamp = stampForEvent(event);
    const seen = loadSeen(stamp);
    if (seen.has(event.id)) return 'duplicate';
    try {
      ensureDir();
      fs.appendFileSync(dayFilePath(stamp), `${JSON.stringify(event)}\n`, 'utf8');
    } catch {
      return 'write_failed';
    }
    seen.add(event.id);
    dayCache.delete(stamp);
    indexEvent(event);
    return 'stored';
  }

  function readDay(stamp) {
    let filePath;
    let mtimeMs;
    try {
      filePath = dayFilePath(stamp);
      mtimeMs = fs.statSync(filePath).mtimeMs;
    } catch {
      return [];
    }
    const cached = dayCache.get(stamp);
    if (cached && cached.mtimeMs === mtimeMs) return cached.events;

    const events = [];
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = normalizeEvent(JSON.parse(trimmed), { now });
          if (event) events.push(event);
        } catch {
          // Torn or foreign line: skip.
        }
      }
    } catch {
      return [];
    }
    dayCache.set(stamp, { mtimeMs, events });
    return events;
  }

  /** Inclusive day range [startStamp, endStamp], both YYYYMMDD. */
  function readRange(startStamp, endStamp) {
    const events = [];
    for (const { stamp } of listDayFiles()) {
      if (stamp >= startStamp && stamp <= endStamp) {
        events.push(...readDay(stamp));
      }
    }
    return events;
  }

  function indexEvent(event) {
    if (!userIndex) return;
    const key = eventUserKey(event);
    const entry = userIndex.get(key);
    if (entry) {
      entry.events += 1;
      entry.last_seen = event.ts > entry.last_seen ? event.ts : entry.last_seen;
      if (!entry.username && event.username) entry.username = event.username;
    } else {
      userIndex.set(key, {
        key,
        id: event.install_id || null,
        username: event.username || null,
        first_seen: event.ts,
        last_seen: event.ts,
        events: 1,
      });
    }
  }

  /** Lazy user directory across all retained files. */
  function users() {
    if (!userIndex) {
      userIndex = new Map();
      for (const { stamp } of listDayFiles()) {
        for (const event of readDay(stamp)) indexEvent(event);
      }
    }
    return [...userIndex.values()].sort((a, b) => (a.last_seen < b.last_seen ? 1 : -1));
  }

  /**
   * Resolve a report target: exact install id first, then unique username.
   * Returns {key, install_id, username} | 'ambiguous' | null.
   */
  function resolveUser(nameOrId) {
    const needle = String(nameOrId || '').trim();
    if (!needle) return null;
    const all = users();
    const byId = all.filter((entry) => entry.id && entry.id.toLowerCase() === needle.toLowerCase());
    if (byId.length === 1) {
      return { key: byId[0].key, install_id: byId[0].id, username: byId[0].username };
    }
    const byName = all.filter((entry) => entry.username && entry.username.toLowerCase() === needle.toLowerCase());
    if (byName.length === 1) {
      return { key: byName[0].key, install_id: byName[0].id, username: byName[0].username };
    }
    if (byName.length > 1) return 'ambiguous';
    if (byId.length > 1) return 'ambiguous';
    return null;
  }

  function eventsForUser(userKey, startStamp, endStamp) {
    return readRange(startStamp, endStamp).filter((event) => eventUserKey(event) === userKey);
  }

  /** Stamps (YYYYMMDD) within the range that contain events for the user. */
  function activeDaysForUser(userKey, startStamp, endStamp) {
    const active = new Set();
    for (const { stamp } of listDayFiles()) {
      if (stamp < startStamp || stamp > endStamp) continue;
      for (const event of readDay(stamp)) {
        if (eventUserKey(event) === userKey) {
          active.add(stamp);
          break;
        }
      }
    }
    return active;
  }

  function prune() {
    const cutoff = now().getTime() - keepDays * 86_400_000;
    for (const { name, stamp } of listDayFiles()) {
      const fileDate = stampToDate(stamp);
      if (Number.isFinite(fileDate.getTime()) && fileDate.getTime() < cutoff) {
        try {
          fs.unlinkSync(path.join(dataDir, name));
          dayCache.delete(stamp);
          seenIds.delete(stamp);
          userIndex = null; // rebuild lazily
        } catch {
          // Kept on failure; retried next prune.
        }
      }
    }
  }

  return { append, readDay, readRange, users, resolveUser, eventsForUser, activeDaysForUser, prune, normalizeEvent };
}

module.exports = {
  createUsageStore,
  normalizeEvent,
  dayStamp,
  stampToDate,
  eventUserKey,
  DEFAULT_KEEP_DAYS,
};
