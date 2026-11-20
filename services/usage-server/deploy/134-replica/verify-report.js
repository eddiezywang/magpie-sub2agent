'use strict';
// Signed-report verification: prints only status codes and sha256 hashes.
// Usage: node verify-report.js <keyfile> <baseurl> <date>
const crypto = require('crypto'), fs = require('fs'), http = require('http');
const key = fs.readFileSync(process.argv[2], 'utf8').trim();
const base = new URL(process.argv[3]);
const date = process.argv[4];

function signedGet(pathWithQuery) {
  return new Promise((resolve) => {
    const ts = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const content = 'sub2agent-billing-v1\nGET\n' + pathWithQuery + '\n' + ts + '\n' + nonce;
    const sig = crypto.createHmac('sha256', Buffer.from(key, 'hex')).update(content).digest('hex');
    http.get({
      host: base.hostname, port: base.port, path: pathWithQuery,
      headers: { 'x-sub2agent-timestamp': ts, 'x-sub2agent-nonce': nonce, 'x-sub2agent-signature': sig },
    }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ code: res.statusCode, body: b }));
    });
  });
}
function plainGet(path) {
  return new Promise((resolve) => {
    http.get({ host: base.hostname, port: base.port, path }, (res) => resolve(res.statusCode));
  });
}

(async () => {
  console.log('UNSIGNED_USERS_STATUS=' + (await plainGet('/users')));
  const u = await signedGet('/users');
  console.log('SIGNED_USERS_STATUS=' + u.code);
  if (u.code !== 200) process.exit(1);
  const j = JSON.parse(u.body);
  const list = Array.isArray(j) ? j : (j.users || j.rows || []);
  const first = list[0];
  const uname = typeof first === 'string' ? first : (first.username || first.name || first.user);
  const cu = crypto.createHash('sha256').update(String(uname)).digest('hex').slice(0, 12);
  const rep = await signedGet('/reports/' + encodeURIComponent(uname) + '/daily.json?date=' + date);
  console.log('USER_HASH=' + cu);
  console.log('REPORT_STATUS=' + rep.code);
  if (rep.code === 200) console.log('REPORT_SHA256=' + crypto.createHash('sha256').update(rep.body).digest('hex'));
  const svg = await signedGet('/reports/' + encodeURIComponent(uname) + '/daily.svg?date=' + date);
  console.log('SVG_STATUS=' + svg.code);
})();
