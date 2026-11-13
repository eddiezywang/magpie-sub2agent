'use strict';

// Usage/billing server entry point. Zero-dependency Node HTTP service that
// pairs with the desktop clients' usage-reporter (sub2agent-usage/1 batches).
//
// Endpoints:
//   GET  /healthz                      liveness + png availability
//   POST /usage/events                 ingest a batch (dedup by event id)
//   GET  /users                        user directory (who has reported)
//   GET  /admin/pricing                pricing table snapshot
//   PUT  /admin/pricing                {models:{name:{input,output,cache_read,cache_write}}} ($/Mtok)
//   DELETE /admin/pricing?model=name   remove a model price
//   GET  /reports/:user/daily.json     ?date=YYYY-MM-DD (default: today, server-local)
//   GET  /reports/:user/weekly.json    ?date= (Monday-based week containing date)
//   GET  /reports/:user/daily.svg|.png (weekly.* too) report card for chat bots
//
// :user resolves by exact install id first, then unique username
// (store.resolveUser). Reports are read-only and LAN-trusted, like the
// existing telemetry endpoint; ingest optionally requires a bearer token via
// USAGE_SERVER_TOKEN; admin endpoints are disabled unless
// USAGE_SERVER_ADMIN_TOKEN is set.
//
// Deployment note: the desktop client's default report URL is
// http://<box>:17890/usage/events — the same box:port as the existing
// telemetry server (/events). If telemetry keeps the port, front both with a
// reverse proxy or set USAGE_SERVER_PORT here and CB_PROXY_USAGE_REPORT_URL on
// clients accordingly.

const http = require('node:http');
const path = require('node:path');
const { createUsageStore } = require('./store');
const { createTelemetryStore, MAX_JSON_BYTES } = require('./telemetry-store');
const { createDailyLogger } = require('./daily-logger');
const { createPricingStore } = require('./pricing');
const { createAggregator, normalizeDateParam, weekStamps } = require('./aggregate');
const { renderReportCardSvg } = require('./card');
const { renderPng, pngAvailable } = require('./png');

const DEFAULT_PORT = 17890;
const DEFAULT_KEEP_DAYS = 400;
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024; // 200-event batches are ~100KB.

function createUsageServer(options = {}) {
  const {
    // Legacy python collector's env names are still honored so this service
    // can take over the old container without re-plumbing its deployment.
    port = Number(process.env.USAGE_SERVER_PORT || process.env.TELEMETRY_PORT) || DEFAULT_PORT,
    host = process.env.USAGE_SERVER_HOST || process.env.TELEMETRY_HOST || '0.0.0.0',
    dataDir = process.env.USAGE_SERVER_DATA_DIR || process.env.TELEMETRY_DATA_DIR ||
      (process.env.TELEMETRY_LOG_PATH ? path.dirname(process.env.TELEMETRY_LOG_PATH) : null) ||
      path.resolve(__dirname, '..', 'data'),
    token = process.env.USAGE_SERVER_TOKEN || '',
    adminToken = process.env.USAGE_SERVER_ADMIN_TOKEN || '',
    keepDays = Number(process.env.USAGE_SERVER_KEEP_DAYS) || DEFAULT_KEEP_DAYS,
    telemetryKeepDays = Number(process.env.USAGE_SERVER_TELEMETRY_KEEP_DAYS) || 90,
    logDir = process.env.USAGE_SERVER_LOG_DIR || process.env.TELEMETRY_LOG_DIR || path.join(dataDir, 'logs'),
    logKeepDays = Number(process.env.USAGE_SERVER_LOG_KEEP_DAYS) || 90,
    telemetryDedupe = process.env.USAGE_SERVER_TELEMETRY_DEDUPE !== '0',
    fontFile = process.env.USAGE_SERVER_FONT_FILE || '',
    fontFamily = process.env.USAGE_SERVER_FONT_FAMILY || '',
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    now = () => new Date(),
    logger = null,
  } = options;

  const store = createUsageStore({ dataDir, keepDays, now });
  const telemetry = createTelemetryStore({
    dataDir,
    keepDays: telemetryKeepDays,
    now,
    dedupe: telemetryDedupe,
  });
  const dailyLog = createDailyLogger({
    dir: logDir,
    keepDays: logKeepDays,
    now,
    echo: (process.env.USAGE_SERVER_LOG_LEVEL || process.env.TELEMETRY_LOG_LEVEL || '').toUpperCase() === 'DEBUG',
  });
  const pricing = createPricingStore({ dataDir, now });
  const aggregator = createAggregator({ store, pricing, now, telemetryStore: telemetry });

  function log(...args) {
    if (logger) logger(...args);
    dailyLog.log(...args);
  }

  function authorizeIngest(req) {
    if (!token) return true; // LAN-trusted, like the telemetry endpoint.
    const header = String(req.headers.authorization || '');
    return header === `Bearer ${token}`;
  }

  function authorizeAdmin(req) {
    if (!adminToken) return false; // Admin surface stays closed by default.
    const header = String(req.headers.authorization || '');
    return header === `Bearer ${adminToken}`;
  }

  function readBody(req, limit = maxBodyBytes) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) {
          reject(Object.assign(new Error('body too large'), { code: 'too_large' }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  function sendSvg(res, svg) {
    res.writeHead(200, {
      'content-type': 'image/svg+xml; charset=utf-8',
      'content-length': Buffer.byteLength(svg),
    });
    res.end(svg);
  }

  function sendPng(res, svg) {
    const png = renderPng(svg, { fontFile, defaultFontFamily: fontFamily || undefined });
    if (!png) {
      sendJson(res, 503, {
        error: 'png_unavailable',
        hint: 'install @resvg/resvg-js in usage-server and set USAGE_SERVER_FONT_FILE for CJK text; use .svg meanwhile',
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length });
    res.end(png);
  }

  async function handleIngest(req, res) {
    if (!authorizeIngest(req)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    let payload;
    try {
      payload = JSON.parse((await readBody(req)) || '{}');
    } catch (error) {
      if (error && error.code === 'too_large') {
        sendJson(res, 413, { error: 'body_too_large' });
      } else {
        sendJson(res, 400, { error: 'invalid_json' });
      }
      return;
    }
    const events = Array.isArray(payload.events) ? payload.events : null;
    if (!events) {
      sendJson(res, 400, { error: 'invalid_batch', hint: 'expected {schema, install_id, username, events:[...]}' });
      return;
    }
    // Client batches carry identity at the envelope level; merge it into each
    // event (event-level fields win) before normalization/dedup.
    const counts = { stored: 0, duplicate: 0, invalid: 0, write_failed: 0 };
    for (const raw of events) {
      const merged = typeof raw === 'object' && raw !== null
        ? {
            ...raw,
            install_id: raw.install_id || payload.install_id || null,
            username: raw.username || payload.username || null,
          }
        : raw;
      counts[store.append(merged)] += 1;
    }
    log(`[usage] ingest stored=${counts.stored} duplicate=${counts.duplicate} invalid=${counts.invalid} write_failed=${counts.write_failed}`);
    if (counts.write_failed > 0) {
      // Non-2xx makes usage-reporter keep the batch for a later retry.
      dailyLog.error('[usage] persist failed', counts);
      sendJson(res, 503, { ok: false, error: 'failed_to_persist_events', ...counts });
      return;
    }
    sendJson(res, 200, { ok: true, ...counts });
  }

  function handleAdminPricing(req, res, url) {
    if (!authorizeAdmin(req)) {
      sendJson(res, adminToken ? 401 : 403, adminToken ? { error: 'unauthorized' } : { error: 'admin_disabled', hint: 'set USAGE_SERVER_ADMIN_TOKEN' });
      return;
    }
    if (req.method === 'GET') {
      sendJson(res, 200, pricing.snapshot());
      return;
    }
    if (req.method === 'PUT') {
      readBody(req)
        .then((body) => {
          let payload;
          try {
            payload = JSON.parse(body || '{}');
          } catch {
            sendJson(res, 400, { error: 'invalid_json' });
            return;
          }
          try {
            const { applied, table } = pricing.setModels(payload.models);
            log(`[usage] pricing updated models=${applied}`);
            sendJson(res, 200, { ok: true, applied, table });
          } catch (error) {
            sendJson(res, 400, { error: 'invalid_pricing', message: error.message });
          }
        })
        .catch(() => sendJson(res, 400, { error: 'invalid_body' }));
      return;
    }
    if (req.method === 'DELETE') {
      const name = url.searchParams.get('model');
      if (!name) {
        sendJson(res, 400, { error: 'missing_model' });
        return;
      }
      sendJson(res, 200, { ok: true, table: pricing.removeModel(name) });
      return;
    }
    sendJson(res, 405, { error: 'method_not_allowed' });
  }

  function resolveReportUser(param, stamps) {
    let decoded = param;
    try {
      decoded = decodeURIComponent(param);
    } catch {
      return null;
    }
    const resolved = store.resolveUser(decoded);
    if (resolved && resolved !== 'ambiguous') return resolved;
    // Users who only reported legacy /events (no billing events yet) still
    // deserve a report: resolve them from telemetry rows in the period.
    if (stamps && stamps.length) {
      const fromTelemetry = telemetry.resolveUser(decoded, stamps[0], stamps[stamps.length - 1]);
      if (fromTelemetry && fromTelemetry !== 'ambiguous') return fromTelemetry;
      if (fromTelemetry === 'ambiguous') return 'ambiguous';
    }
    return resolved === 'ambiguous' ? 'ambiguous' : null;
  }

  function handleReport(req, res, url, userParam, format) {
    const date = url.searchParams.get('date');
    const daily = format.startsWith('daily');
    const stamp = normalizeDateParam(date, now);
    if (!stamp) {
      sendJson(res, 400, { error: 'invalid_date', hint: 'date must be YYYY-MM-DD' });
      return;
    }
    const stamps = daily ? [stamp] : weekStamps(stamp);
    const user = resolveReportUser(userParam, stamps);
    if (!user || user === 'ambiguous') {
      const needle = (() => {
        try {
          return decodeURIComponent(userParam).toLowerCase();
        } catch {
          return userParam.toLowerCase();
        }
      })();
      const ambiguous = user === 'ambiguous' || store.users().filter(
        (entry) =>
          (entry.username || '').toLowerCase() === needle ||
          (entry.id || '').toLowerCase() === needle
      ).length > 1;
      sendJson(res, ambiguous ? 409 : 404, {
        error: ambiguous ? 'ambiguous_user' : 'user_not_found',
        hint: 'see /users for known install ids and usernames',
      });
      return;
    }

    const report = daily
      ? aggregator.dailyReport(user, date)
      : aggregator.weeklyReport(user, date);
    if (report.error === 'invalid_date') {
      sendJson(res, 400, { error: 'invalid_date', hint: 'date must be YYYY-MM-DD' });
      return;
    }

    if (format.endsWith('.json')) {
      sendJson(res, 200, report);
      return;
    }
    let svg;
    try {
      svg = renderReportCardSvg(report);
    } catch (error) {
      sendJson(res, 500, { error: 'render_failed', message: error.message });
      return;
    }
    if (format.endsWith('.png')) {
      sendPng(res, svg);
    } else {
      sendSvg(res, svg);
    }
  }

  // Legacy telemetry ingest: one event per POST, no auth, fire-and-forget
  // (src/telemetry.js never checks the response). Keeping this endpoint
  // byte-compatible lets this service replace the old collector outright.
  async function handleTelemetryEvent(req, res) {
    let payload;
    try {
      payload = JSON.parse((await readBody(req, MAX_JSON_BYTES)) || '{}');
    } catch (error) {
      if (error && error.code === 'too_large') {
        sendJson(res, 413, { error: 'body_too_large' });
      } else {
        sendJson(res, 400, { error: 'invalid_json' });
      }
      return;
    }
    const result = telemetry.append(payload);
    if (result === 'invalid') {
      sendJson(res, 400, { error: 'invalid_event', hint: 'event (string) is required' });
      return;
    }
    if (result === 'write_failed') {
      // The legacy collector returned 500 on OSError; never pretend a lost
      // event was accepted.
      dailyLog.error('[telemetry] persist failed', payload && payload.event);
      sendJson(res, 500, { error: 'failed_to_persist_event' });
      return;
    }
    log(`[telemetry] event ${result}: ${payload && payload.event}`);
    sendJson(res, 200, { ok: true, result });
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (pathname === '/healthz' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        png_available: pngAvailable(),
        users: store.users().length,
        now: now().toISOString(),
      });
      return;
    }
    if (pathname === '/usage/events' && req.method === 'POST') {
      await handleIngest(req, res);
      return;
    }
    if (pathname === '/events' && req.method === 'POST') {
      await handleTelemetryEvent(req, res);
      return;
    }
    if (pathname === '/users' && req.method === 'GET') {
      sendJson(res, 200, { users: store.users() });
      return;
    }
    if (pathname === '/admin/pricing') {
      handleAdminPricing(req, res, url);
      return;
    }
    const reportMatch = /^\/reports\/([^/]+)\/(daily|weekly)\.(json|svg|png)$/.exec(pathname);
    if (reportMatch && req.method === 'GET') {
      handleReport(req, res, url, reportMatch[1], `${reportMatch[2]}.${reportMatch[3]}`);
      return;
    }
    sendJson(res, 404, { error: 'not_found' });
  }

  let server = null;
  let pruneTimer = null;

  return {
    port,
    host,
    start() {
      if (server) return Promise.resolve(server.address().port);
      // Each store owns its own retention window; all three rotate by day.
      store.prune();
      telemetry.prune();
      dailyLog.prune();
      pruneTimer = setInterval(() => {
        store.prune();
        telemetry.prune();
        dailyLog.prune();
      }, 6 * 60 * 60 * 1000);
      if (typeof pruneTimer.unref === 'function') pruneTimer.unref();
      server = http.createServer((req, res) => {
        const startedAt = Date.now();
        res.on('finish', () => {
          dailyLog.access({
            method: req.method,
            path: req.url,
            status: res.statusCode,
            durationMs: Date.now() - startedAt,
          });
        });
        route(req, res).catch((error) => {
          dailyLog.error(`[usage] request failed: ${error && error.stack ? error.stack : error}`);
          if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
          else res.end();
        });
      });
      return new Promise((resolve) => {
        server.listen(port, host, () => resolve(server.address().port));
      });
    },
    stop() {
      if (pruneTimer) {
        clearInterval(pruneTimer);
        pruneTimer = null;
      }
      dailyLog.close();
      if (!server) return Promise.resolve();
      const closing = server;
      server = null;
      return new Promise((resolve) => closing.close(() => resolve()));
    },
    // Exposed for tests/admin tooling.
    _store: store,
    _pricing: pricing,
    _aggregator: aggregator,
  };
}

module.exports = { createUsageServer, DEFAULT_PORT };

if (require.main === module) {
  const app = createUsageServer();
  app.start().then((bound) => {
    console.log(`[usage-server] listening on ${app.host}:${bound} (png: ${pngAvailable() ? 'available' : 'svg-only, install @resvg/resvg-js'})`);
  });
  const shutdown = () => app.stop().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
