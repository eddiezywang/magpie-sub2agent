'use strict';
// Usage-data sync receiver v2 — chunked transfer (corporate proxy caps large POSTs).
// POST /push-chunk?stream=NAME&i=N    append part N (<= 2MB) of stream NAME
// POST /push-complete?stream=NAME&type=sync|seed   body: {"sha256":"...","total":123}
//   type=sync -> extract, atomically move files into /var/lib/usage-server
//   type=seed -> extract to /var/lib/usage-migrate/seed-<ts> (installed by install-134.sh)
// GET  /healthz, GET /receiver-healthz
// Auth: Authorization: Bearer <USAGE_SYNC_TOKEN>.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const PORT = Number(process.env.USAGE_SYNC_PORT || 5174);
const TOKEN = process.env.USAGE_SYNC_TOKEN || '';
const DATA_DIR = '/var/lib/usage-server';
const MIGRATE_DIR = '/var/lib/usage-migrate';
const PART_BASE = '/tmp/usage-push';
const MAX_PART_BYTES = 2 * 1024 * 1024;

function sh(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, (err, stdout, stderr) => resolve({ err, stdout: String(stdout), stderr: String(stderr) }));
  });
}

function saveBody(req, dest, cap) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    let size = 0, dead = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > cap) { dead = true; req.destroy(); out.destroy(); fs.unlink(dest, () => {}); reject(new Error('part too large')); }
    });
    req.on('error', () => { if (!dead) { out.destroy(); fs.unlink(dest, () => {}); reject(new Error('read error')); } });
    req.on('end', () => { if (!dead) out.end(() => resolve(size)); });
    req.pipe(out);
  });
}

function readJsonBody(req, cap = 8192) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > cap) { req.destroy(); reject(new Error('body too large')); } });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(new Error('bad json')); } });
  });
}

function moveFilesIntoPlace(staging, target) {
  const script =
    'set -e; cd "$1"; find . -type f | while read -r f; do d="$2/${f#.}"; mkdir -p "$(dirname "$d")"; mv -f "$f" "$d"; done';
  return sh('bash', ['-c', script, 'move', staging, target]);
}

function respond(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const auth = String(req.headers.authorization || '');

  if ((url.pathname === '/healthz' || url.pathname === '/receiver-healthz') && req.method === 'GET') {
    return respond(res, 200, { ok: true, service: 'usage-sync-receiver' });
  }

  const stream = url.searchParams.get('stream') || '';
  if (!/^[A-Za-z0-9-]{1,64}$/.test(stream)) {
    return respond(res, 400, { ok: false, error: 'bad stream name' });
  }
  if (TOKEN === '' || auth !== `Bearer ${TOKEN}`) {
    console.log(new Date().toISOString(), 'rejected: bad token');
    return respond(res, 401, { ok: false, error: 'unauthorized' });
  }
  const dir = path.join(PART_BASE, stream);

  try {
    if (url.pathname === '/push-status' && req.method === 'GET') {
      if (!fs.existsSync(dir)) return respond(res, 200, { ok: true, have: [] });
      const have = fs.readdirSync(dir)
        .filter((n) => n.startsWith('part-'))
        .map((n) => parseInt(n.slice(5), 10))
        .sort((a, b) => a - b);
      return respond(res, 200, { ok: true, have });
    }

    if (url.pathname === '/push-chunk' && req.method === 'POST') {
      const i = Number(url.searchParams.get('i'));
      if (!Number.isInteger(i) || i < 0 || i > 100000) throw new Error('bad part index');
      fs.mkdirSync(dir, { recursive: true });
      const size = await saveBody(req, path.join(dir, 'part-' + String(i).padStart(6, '0')), MAX_PART_BYTES);
      return respond(res, 200, { ok: true, part: i, bytes: size });
    }

    if (url.pathname === '/push-complete' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const type = url.searchParams.get('type');
      if (type !== 'sync' && type !== 'seed') throw new Error('bad type');
      if (!fs.existsSync(dir)) throw new Error('unknown stream');
      const parts = fs.readdirSync(dir).filter((n) => n.startsWith('part-')).sort();
      if (parts.length === 0) throw new Error('no parts');

      const final = path.join(dir, 'final.tgz');
      const hash = crypto.createHash('sha256');
      let total = 0;
      const out = fs.createWriteStream(final);
      await new Promise((resolve, reject) => {
        out.on('error', reject);
        let k = 0;
        const next = () => {
          if (k >= parts.length) { out.end(resolve); return; }
          const rs = fs.createReadStream(path.join(dir, parts[k++]));
          rs.on('data', (c) => { hash.update(c); total += c.length; });
          rs.on('error', reject);
          rs.pipe(out, { end: false });
          rs.on('end', next);
        };
        next();
      });
      if (total !== body.total) throw new Error(`size mismatch: got ${total} want ${body.total}`);
      if (hash.digest('hex') !== body.sha256) throw new Error('sha256 mismatch');

      const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
      if (type === 'seed') {
        const dest = path.join(MIGRATE_DIR, `seed-${stamp}`);
        fs.mkdirSync(dest, { recursive: true });
        const r = await sh('tar', ['-xzf', final, '-C', dest]);
        if (r.err) throw new Error('tar extract failed: ' + r.stderr);
        console.log(new Date().toISOString(), `seed stored: ${dest} (${total} bytes, sha ok)`);
        fs.rmSync(dir, { recursive: true, force: true });
        return respond(res, 200, { ok: true, stored: dest, bytes: total });
      }
      const staging = path.join(DATA_DIR, `.incoming-${stamp}`);
      fs.mkdirSync(staging, { recursive: true });
      const r = await sh('tar', ['-xzf', final, '-C', staging]);
      if (r.err) throw new Error('tar extract failed: ' + r.stderr);
      const m = await moveFilesIntoPlace(staging, DATA_DIR);
      if (m.err) throw new Error('move failed: ' + m.stderr);
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(new Date().toISOString(), `sync applied: ${total} bytes (sha ok)`);
      return respond(res, 200, { ok: true, bytes: total });
    }

    return respond(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    console.log(new Date().toISOString(), `failed: ${e.message}`);
    return respond(res, 500, { ok: false, error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () =>
  console.log(new Date().toISOString(), `usage-sync-receiver listening on 127.0.0.1:${PORT}`),
);
