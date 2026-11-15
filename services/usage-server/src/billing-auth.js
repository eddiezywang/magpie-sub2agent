'use strict';
const crypto = require('node:crypto');

// Verify the method, exact request target, time and random nonce. Nonces are
// accepted once per process and expiry window; a full cache rejects new calls.
function billingVerifier(secret, now = () => Date.now()) {
  const seen = new Map(), windowMs = 5 * 60 * 1000, maxEntries = 50000;
  return function verify(req) {
    if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret)) return false;
    const ts=String(req.headers['x-sub2agent-timestamp']||'');
    const nonce=String(req.headers['x-sub2agent-nonce']||'');
    const sig=String(req.headers['x-sub2agent-signature']||'');
    if(!/^\d{13}$/.test(ts)||!/^[0-9a-f]{32}$/.test(nonce)||!/^[0-9a-f]{64}$/.test(sig)) return false;
    const current=now(), timestamp=Number(ts);
    if(!Number.isSafeInteger(timestamp)||Math.abs(current-timestamp)>windowMs) return false;
    const content=`sub2agent-billing-v1\n${req.method}\n${req.url}\n${ts}\n${nonce}`;
    const expected=crypto.createHmac('sha256',Buffer.from(secret,'hex')).update(content).digest();
    const actual=Buffer.from(sig,'hex');
    if(!crypto.timingSafeEqual(expected,actual)) return false;
    for(const [id,expiry] of seen) if(expiry<current) seen.delete(id);
    if(seen.has(nonce)||seen.size>=maxEntries) return false;
    seen.set(nonce,Math.max(current,timestamp)+windowMs);
    return true;
  };
}
module.exports={billingVerifier};
