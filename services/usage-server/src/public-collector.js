'use strict';

const { DatabaseSync } = require('node:sqlite');
const { timingSafeEqual } = require('node:crypto');
const { createServer } = require('node:https');
const { readFileSync } = require('node:fs');
const { SCHEMA, normalizeSummary } = require('./summary-store');
const { normalizeEvent } = require('./telemetry-store');

const MAX_BODY = 2 * 1024 * 1024;
const EVENTS = new Set(['process_start', 'app_start', 'desktop_app_start', 'desktop_app_quit',
  'desktop_proxy_start', 'desktop_proxy_stop', 'desktop_proxy_usage_flushed', 'desktop_operation_failed']);
const label = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max &&
  !/[\x00-\x1f\x7f]/.test(value) && !value.includes('://');

function createPublicCollector(file, secret) {
  if (!secret) throw new Error('mirror token is required');
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    PRAGMA max_page_count=131072;
    CREATE TABLE IF NOT EXISTS inbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
      installation TEXT NOT NULL, packet TEXT NOT NULL, received INTEGER NOT NULL,
      payload TEXT NOT NULL, UNIQUE(kind, installation, packet)
    );
    CREATE INDEX IF NOT EXISTS inbox_received ON inbox(received);
    CREATE TABLE IF NOT EXISTS rules (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
  `);
  const find = db.prepare('SELECT payload FROM inbox WHERE kind=? AND installation=? AND packet=?');
  const insert = db.prepare('INSERT INTO inbox (kind,installation,packet,received,payload) VALUES (?,?,?,?,?)');
  const mirror = db.prepare('SELECT seq,kind,payload FROM inbox WHERE seq>? ORDER BY seq LIMIT 64');
  const getRules = db.prepare('SELECT payload FROM rules WHERE id=1');
  const setRules = db.prepare('INSERT INTO rules VALUES (1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');
  const prune = db.prepare('DELETE FROM inbox WHERE received<?');
  const expected = Buffer.from('Bearer ' + secret);
  let interval = 0, total = 0;
  let ips = new Map();

  function allowed(req) {
    const now = Math.floor(Date.now() / 60000);
    if (interval !== now) {
      interval = now;
      total = 0;
      ips = new Map();
    }
    if (++total > 3000) return false;
    const host = req.socket.remoteAddress;
    const count = (ips.get(host) || 0) + 1;
    ips.set(host, count);
    return count <= 300;
  }

  function authorized(req) {
    const actual = Buffer.from(req.headers.authorization || '');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  function save(kind, row, packet) {
    const payload = JSON.stringify(row);
    const previous = find.get(kind, row.install_id, packet);
    if (previous) return previous.payload === payload ? 'duplicate' : 'rejected';
    insert.run(kind, row.install_id, packet, Date.now(), payload);
    return 'accepted';
  }

  const reply = (res, code, value) => {
    const data = JSON.stringify(value);
    res.writeHead(code, {'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(data);
  };
  async function read(req) {
    let totalBytes = 0;
    const parts = [];
    for await (const part of req) {
      totalBytes += part.length;
      if (totalBytes > MAX_BODY) throw new RangeError('payload too large');
      parts.push(part);
    }
    return JSON.parse(Buffer.concat(parts));
  }

  async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://collector');
      if (url.pathname === '/mirror' || url.pathname === '/mirror/rules') {
        if (!authorized(req)) return reply(res, 401, {ok:false});
        if (req.method === 'GET' && url.pathname === '/mirror') {
          const after = url.searchParams.get('after') || '0';
          if (!/^\d{1,15}$/.test(after)) return reply(res, 400, {ok:false});
          return reply(res, 200, {rows:mirror.all(Number(after))});
        }
        if (req.method === 'PUT' && url.pathname === '/mirror/rules') {
          const rules = await read(req);
          if (!label(rules?.revision, 128)) return reply(res, 400, {ok:false});
          setRules.run(JSON.stringify(rules));
          return reply(res, 200, {ok:true});
        }
        return reply(res, 404, {ok:false});
      }
      if (!allowed(req)) return reply(res, 429, {ok:false});
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return reply(res, 200, {ok:true,usage_schemas:[SCHEMA]});
      }
      if (req.method === 'GET' && url.pathname === '/usage/aggregation-rules') {
        const stored = getRules.get();
        return stored ? reply(res, 200, JSON.parse(stored.payload)) : reply(res, 503, {ok:false});
      }
      if (req.method !== 'POST' || !['/events','/usage/events'].includes(url.pathname)) return reply(res,404,{ok:false});
      const data = await read(req);
      if (!label(data?.install_id, 256) || !label(data?.username, 256)) return reply(res,400,{ok:false});
      if (url.pathname === '/events') {
        if (!EVENTS.has(data.event) || !label(data.id,128)) return reply(res,400,{ok:false});
        const stamp = Date.parse(data.timestamp);
        if (!Number.isFinite(stamp) || stamp < Date.now()-120*86400000 || stamp > Date.now()+300000) {
          return reply(res,400,{ok:false});
        }
        const row = normalizeEvent({
          install_id:data.install_id, username:data.username, event:data.event, id:data.id,
          timestamp:new Date(stamp).toISOString(), received_at:new Date(stamp).toISOString(),
          argv:data.argv, entry_mode:'desktop',
          platform:label(data.platform,32)?data.platform:'',
          arch:label(data.arch,32)?data.arch:'',
          app_version:label(data.app_version,64)?data.app_version:'',
        });
        const state = save('legacy',row,row.id);
        return reply(res,state === 'rejected' ? 409 : 200,{ok:state !== 'rejected'});
      }
      const packets = data.summaries;
      if (data.schema !== SCHEMA || !Array.isArray(packets) || packets.length < 1 || packets.length > 200 ||
          packets.some(row => !label(row?.id,128)) || new Set(packets.map(row=>row.id)).size !== packets.length) {
        return reply(res,400,{ok:false});
      }
      const ack = {ok:true,schema:SCHEMA,accepted_ids:[],duplicate_ids:[],rejected_ids:[]};
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const raw of packets) {
          const row = normalizeSummary(data,raw);
          const age = row ? Date.now() - Date.parse(row.minute) : Infinity;
          const state = age < -300000 || age > 120*86400000 ? 'rejected' : save('summary',row,raw.id);
          ack[state+'_ids'].push(raw.id);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return reply(res,200,ack);
    } catch (error) {
      if (error instanceof SyntaxError) return reply(res,400,{ok:false});
      if (error instanceof RangeError) return reply(res,413,{ok:false});
      console.error('public collector request failed',error.code || error.name);
      return reply(res,503,{ok:false});
    }
  }

  return {
    handler,
    prune: () => prune.run(Date.now() - 120*86400000),
    close: () => db.close(),
  };
}

if (require.main === module) {
  const env = process.env;
  const app = createPublicCollector(env.PUBLIC_TELEMETRY_DB, env.SYNC_TOKEN);
  const server = createServer({cert:readFileSync(env.TLS_CERT),key:readFileSync(env.TLS_KEY),
    requestTimeout:12000,headersTimeout:8000,minVersion:'TLSv1.2'},app.handler);
  server.maxConnections = 256;
  server.listen(Number(env.PORT || 8890),'0.0.0.0');
  setInterval(app.prune,3600000).unref();
}

module.exports = {createPublicCollector};
