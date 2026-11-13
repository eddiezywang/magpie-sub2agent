'use strict';

// Daily-rotating application log. The legacy python collector only wrote
// uvicorn's stdout (one unrotated events.jsonl for data, and Docker's json-file
// driver for stdout). The new service keeps both concerns explicit:
//   - telemetry-YYYYMMDD.jsonl : event DATA, one file per local day
//   - logs/server-YYYYMMDD.log : access + ingest + error lines, one per day
// Both are pruned by the same keepDays policy.

const fs = require('node:fs');
const path = require('node:path');

const LOG_FILE_RE = /^server-(\d{8})\.log$/;
const DEFAULT_KEEP_DAYS = 90;

function dayStamp(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function stampToDate(stamp) {
  return new Date(Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1, Number(stamp.slice(6, 8)));
}

function stringify(value) {
  if (value instanceof Error) return value.stack || String(value);
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function createDailyLogger({ dir, now = () => new Date(), keepDays = DEFAULT_KEEP_DAYS, echo = false } = {}) {
  if (!dir) throw new Error('daily logger requires dir');

  function write(level, args) {
    const line = `[${now().toISOString()}] [${level}] ${args.map(stringify).join(' ')}\n`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, `server-${dayStamp(now())}.log`), line, 'utf8');
    } catch {
      // Logging is best-effort by design; a broken log file must never take
      // the HTTP service down.
    }
    if (echo) {
      const out = level === 'ERROR' || level === 'WARN' ? process.stderr : process.stdout;
      try {
        out.write(line);
      } catch {
        // stdout/stderr closed: nothing else to do
      }
    }
  }

  function log(...args) {
    write('INFO', args);
  }
  function warn(...args) {
    write('WARN', args);
  }
  function error(...args) {
    write('ERROR', args);
  }

  /** One line per HTTP request, with status and duration. */
  function access({ method, path: urlPath, status, durationMs, note = '' }) {
    write('ACCESS', [`${method} ${urlPath} ${status} ${Math.round(durationMs)}ms`, note]);
  }

  function prune() {
    const cutoff = now().getTime() - keepDays * 86_400_000;
    try {
      for (const name of fs.readdirSync(dir)) {
        const match = LOG_FILE_RE.exec(name);
        if (!match) continue;
        const date = stampToDate(match[1]);
        if (Number.isFinite(date.getTime()) && date.getTime() < cutoff) {
          try {
            fs.unlinkSync(path.join(dir, name));
          } catch {
            // kept on failure; retried next prune
          }
        }
      }
    } catch {
      // dir not created yet: nothing to prune
    }
  }

  function close() {
    // appendFileSync needs no flush; kept for a stable call surface.
  }

  return { log, warn, error, access, prune, close };
}

module.exports = { createDailyLogger, dayStamp, stampToDate, LOG_FILE_RE, DEFAULT_KEEP_DAYS };
