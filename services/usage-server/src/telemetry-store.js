'use strict';

// Telemetry event store: the /events endpoint's append-only JSONL per local
// day (telemetry-YYYYMMDD.jsonl). This is the wire the desktop/CLI clients'
// src/telemetry.js has always spoken — one event per POST, fire-and-forget,
// no auth, no retries — so the usage server can replace the old collector
// outright. Normalization stays loose on purpose: an analytics feed we can't
// lose rows from is worse than one with a few odd rows.

const fs = require('node:fs');
const path = require('node:path');

// Live rows are written to telemetry-YYYYMMDD.jsonl. Files imported from the
// legacy single-file collector are named telemetry-archived-YYYYMMDD.jsonl:
// same content, but they are exempt from the retention prune (otherwise the
// first restart after an import would delete months of history).
const DAY_FILE_RE = /^telemetry-(archived-)?(\d{8})\.jsonl$/;
const DEFAULT_KEEP_DAYS = 90;
const MAX_JSON_BYTES = 256 * 1024; // argv lists are the big part; be generous but bounded

function dayStamp(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function stampToDate(stamp) {
  return new Date(Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1, Number(stamp.slice(6, 8)));
}

/**
 * Loose normalization: keep every field the client sent, coerce only the
 * identity/timestamp core. The client packs structured fields into argv as
 * `--key=value` tokens (proxy uptime, token totals, flush windows); parse
 * those into an args object so aggregation never re-parses raw lines.
 * Returns null only when there is nothing at all.
 */
function normalizeEvent(raw, { now = () => new Date() } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const event = typeof raw.event === 'string' && raw.event.trim() ? raw.event.trim() : null;
  if (!event) return null;

  let ts = typeof raw.timestamp === 'string' && raw.timestamp ? raw.timestamp : null;
  if (!Number.isFinite(Date.parse(ts))) ts = now().toISOString();

  // Ingest-side privacy filter: older clients still send raw process argv,
  // which can hold credentials, URLs, paths or prompt text. Keep only short
  // shaped flags and drop their unsafe values.
  const SAFE_KEY = /^[a-z][a-z0-9_-]{0,47}$/;
  const SAFE_VALUE = /^[a-zA-Z0-9_.:-]{0,96}$/;
  const SENSITIVE = /[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/|(?:[a-z]:\\|\\\\|\/(?:home|users?|tmp|var)\/)|-----BEGIN [A-Z ]+PRIVATE KEY-----/i;
  const safeArgv = [];
  const args = {};
  if (Array.isArray(raw.argv)) {
    for (const token of raw.argv.slice(0, 16)) {
      if (typeof token !== 'string' || !token.startsWith('--')) continue;
      const eq = token.indexOf('=');
      if (eq <= 2) continue;
      const key = token.slice(2, eq);
      const value = token.slice(eq + 1);
      if (!SAFE_KEY.test(key) || value.length > 96 || !SAFE_VALUE.test(value) || SENSITIVE.test(value)) continue;
      safeArgv.push(`--${key}=${value}`);
      args[key] = value;
    }
  }

  return {
    ...raw,
    // The legacy python collector stamped every row with its own receive
    // time; keep that field so imported history and new rows are identical.
    received_at: typeof raw.received_at === 'string' && raw.received_at ? raw.received_at : now().toISOString(),
    event,
    timestamp: ts,
    username: typeof raw.username === 'string' && raw.username ? raw.username : '',
    install_id: typeof raw.install_id === 'string' && raw.install_id ? raw.install_id : '',
    argv: safeArgv,
    entry_mode: typeof raw.entry_mode === 'string' && raw.entry_mode ? raw.entry_mode : '',
    platform: typeof raw.platform === 'string' && raw.platform ? raw.platform : '',
    arch: typeof raw.arch === 'string' && raw.arch ? raw.arch : '',
    node_version: typeof raw.node_version === 'string' && raw.node_version ? raw.node_version : '',
    app_version: typeof raw.app_version === 'string' && raw.app_version ? raw.app_version : '',
    args,
  };
}

function createTelemetryStore({ dataDir, keepDays = DEFAULT_KEEP_DAYS, now = () => new Date(), dedupe = true } = {}) {
  if (!dataDir) throw new Error('telemetry store requires dataDir');
  // Dedup keys are bucketed by local day so they can expire with the file's
  // retention window instead of growing for the process lifetime.
  let seen = new Map(); // stamp -> Set(keys)
  let seenLoaded = false;

  function dayFilePath(stamp) {
    return path.join(dataDir, `telemetry-${stamp}.jsonl`);
  }

  function listDayFiles() {
    try {
      return fs
        .readdirSync(dataDir)
        .map((name) => {
          const match = DAY_FILE_RE.exec(name);
          return match ? { name, stamp: match[2], archived: Boolean(match[1]) } : null;
        })
        .filter(Boolean)
        .sort((a, b) => (a.stamp < b.stamp ? -1 : 1));
    } catch {
      return [];
    }
  }

  // Only recent files rebuild the dedup set: dedup guards against a client
  // re-sending today's events, not against two-year-old archive rows. This
  // keeps startup cheap even with hundreds of imported history day files.
  const SEEN_LOOKBACK_DAYS = 7;

  function seenBucket(stamp) {
    if (!seen.has(stamp)) seen.set(stamp, new Set());
    return seen.get(stamp);
  }

  function loadSeen() {
    if (seenLoaded) return seen;
    seen = new Map();
    // Load ALL day files that carry _key (live rows only; archives have no
    // _key by design). This fixes the replay hole where an old event could be
    // accepted twice after a restart because its file was outside a lookback.
    for (const { name, stamp } of listDayFiles()) {
      try {
        const content = fs.readFileSync(path.join(dataDir, name), 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed && parsed._key) seenBucket(stamp).add(parsed._key);
          } catch {
            // torn line: skip
          }
        }
      } catch {
        // missing file: nothing to remember
      }
    }
    seenLoaded = true;
    return seen;
  }

  // Events carry no id: fingerprint the event, timestamp, identity AND the
  // payload (argv/args), so two different usage windows in the same
  // millisecond are not collapsed into one.
  function eventKey(event) {
    const payload = JSON.stringify(event.args || event.argv || []);
    return `${event.event}|${event.timestamp}|${event.install_id || ''}|${event.username || ''}|${payload}`;
  }

  /** Append one event. Returns 'stored' | 'duplicate' | 'invalid' | 'write_failed'. */
  function append(raw) {
    const event = normalizeEvent(raw, { now });
    if (!event) return 'invalid';
    const key = eventKey(event);
    const stamp = dayStamp(new Date(event.timestamp));
    // The legacy collector never deduped. Keep dedup for our retrying client,
    // but let a full drop-in replacement turn it off via config.
    if (dedupe && loadSeen().get(stamp)?.has(key)) return 'duplicate';
    const stamped = { ...event, _key: key };
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.appendFileSync(dayFilePath(stamp), `${JSON.stringify(stamped)}\n`, 'utf8');
    } catch (error) {
      return 'write_failed';
    }
    if (dedupe) {
      loadSeen();
      seenBucket(stamp).add(key);
    }
    return 'stored';
  }

  // A stable fingerprint for an imported/live row. Used to collapse an
  // archived row and its live counterpart (an overlap the importer may leave)
  // so active duration / sessions are never counted twice.
  function rowFingerprint(row) {
    return `${row.event}|${row.timestamp}|${row.install_id || ''}|${row.username || ''}|${JSON.stringify(row.args || row.argv || [])}`;
  }

  function readRange(startStamp, endStamp) {
    const events = [];
    const fingerprints = new Set();
    for (const { stamp, name } of listDayFiles()) {
      if (stamp < startStamp || stamp > endStamp) continue;
      try {
        const content = fs.readFileSync(path.join(dataDir, name), 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            // Always fingerprint the row content: live rows carry a legacy
            // _key whose format differs from archived rows, so comparing
            // _key directly would miss the overlap.
            const key = rowFingerprint(parsed);
            delete parsed._key;
            if (fingerprints.has(key)) continue;
            fingerprints.add(key);
            events.push(parsed);
          } catch {
            // torn line: skip
          }
        }
      } catch {
        // missing file: skip
      }
    }
    return events;
  }

  /**
   * Resolve a report target from telemetry rows within a day range, for users
   * who only ever reported legacy /events (no billing events yet). Same shape
   * as the usage store's resolveUser: {key, install_id, username} |
   * 'ambiguous' | null. Only the requested period is scanned, so a large
   * imported history never costs a full 2M-row pass per report.
   */
  function resolveUser(nameOrId, startStamp, endStamp) {
    const needle = String(nameOrId || '').trim().toLowerCase();
    if (!needle) return null;
    const byId = new Map();
    const byName = new Map();
    for (const event of readRange(startStamp, endStamp)) {
      const id = event.install_id || '';
      const name = event.username || '';
      if (!id && !name) continue;
      const key = id || `name:${name}`;
      const entry = { key, install_id: id || null, username: name || null };
      if (!byId.has(key)) byId.set(key, entry);
      else if (!byId.get(key).username && name) byId.get(key).username = name;
      if (name) {
        if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), new Set());
        byName.get(name.toLowerCase()).add(key);
      }
    }
    const exact = byId.get(needle);
    if (exact) return exact;
    const names = byName.get(needle);
    if (!names) return null;
    if (names.size > 1) return 'ambiguous';
    const key = [...names][0];
    return byId.get(key) || null;
  }

  function prune() {
    const cutoff = now().getTime() - keepDays * 86_400_000;
    for (const { name, stamp, archived } of listDayFiles()) {
      if (archived) continue; // imported legacy history is permanent until removed by hand
      const date = stampToDate(stamp);
      if (Number.isFinite(date.getTime()) && date.getTime() < cutoff) {
        try {
          fs.unlinkSync(path.join(dataDir, name));
          seen.delete(stamp); // drop its dedup bucket with the file
        } catch {
          // kept on failure; retried next prune
        }
      }
    }
  }

  return { append, readRange, resolveUser, prune };
}

module.exports = {
  createTelemetryStore,
  normalizeEvent,
  dayStamp,
  stampToDate,
  DEFAULT_KEEP_DAYS,
  MAX_JSON_BYTES,
};
