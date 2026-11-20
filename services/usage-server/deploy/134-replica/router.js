'use strict';
// Public front for the 134 billing replica on one SG-open port (5173).
//   /sync, /seed, /receiver-healthz -> sync receiver (127.0.0.1:5174)
//   everything else                 -> usage/billing server (127.0.0.1:17890)
const http = require('node:http');

const PUBLIC_PORT = Number(process.env.ROUTER_PORT || 5173);
const RECEIVER = { host: '127.0.0.1', port: 5174 };
const BILLING = { host: '127.0.0.1', port: 17890 };

function proxy(req, res, target) {
  const upstream = http.request(
    { host: target.host, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: `${target.host}:${target.port}` } },
    (ur) => {
      res.writeHead(ur.statusCode, ur.headers);
      ur.pipe(res);
    },
  );
  upstream.setTimeout(0); // ponytail: no per-request timeout; the 3GB seed upload can take longer than node's 300s default
  upstream.on('error', (e) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'upstream unavailable: ' + e.code }));
    } else {
      res.end();
    }
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/sync' || p === '/seed' || p === '/push-chunk' || p === '/push-complete' || p === '/push-status' || p === '/receiver-healthz') return proxy(req, res, RECEIVER);
  return proxy(req, res, BILLING);
});
server.requestTimeout = 0;
server.headersTimeout = 60000;
server.listen(PUBLIC_PORT, '0.0.0.0', () =>
  console.log(new Date().toISOString(), `usage-router on :${PUBLIC_PORT} (receiver /sync,/seed; billing elsewhere)`),
);
