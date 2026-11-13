import assert from 'node:assert/strict';
import {test} from 'node:test';
import http from 'node:http';
import {once} from 'node:events';
import {loginNetwork} from './login-network.mjs';

test('login transport errors explain recovery without leaking URLs or tokens', async()=>{
  for(const [error,expected] of [
    [new DOMException('private details','TimeoutError'),/超时/],
    [Object.assign(new TypeError('https://user:secret@server?token=secret'),{cause:{code:'ECONNREFUSED'}}),/拒绝连接/],
    [Object.assign(new TypeError('secret'),{cause:{code:'ENOTFOUND'}}),/DNS/],
    [Object.assign(new TypeError('secret'),{cause:{code:'ECONNRESET'}}),/无法连接/],
  ]) await assert.rejects(loginNetwork(async()=>{throw error;},()=>undefined)('https://login.invalid'),e=>{assert.match(e.message,expected);assert.doesNotMatch(e.message,/secret|https:/);return true;});
});

test('login has a real deadline and cancellation stays cancellation',async()=>{
  const server=http.createServer((req,res)=>{if(req.url==='/body'){res.writeHead(200,{'Content-Type':'application/json'});res.flushHeaders();}}).listen(0,'127.0.0.1');
  await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(loginNetwork(fetch,()=>undefined,30)(url),/超时/);
    await assert.rejects(loginNetwork(fetch,()=>undefined,30)(url+'/body'),/超时/);
    const controller=new AbortController();
    const done=loginNetwork(fetch,()=>controller.signal)(url);
    controller.abort();
    await assert.rejects(done,{name:'AbortError'});
  } finally { server.closeAllConnections();server.close(); }
});

test('HTTP service errors are readable; business authentication responses reach the adapter',async()=>{
  for(const code of [404,500,503]) await assert.rejects(loginNetwork(async()=>new Response('private upstream body',{status:code}),()=>undefined)('http://login.invalid'),new RegExp(`HTTP ${code}`));
  const response=new Response('{"code":"expired"}',{status:401});
  const result=await loginNetwork(async()=>response,()=>undefined)('http://login.invalid');
  assert.equal(result.status,401);
  assert.deepEqual(await result.json(),{code:'expired'});
});
