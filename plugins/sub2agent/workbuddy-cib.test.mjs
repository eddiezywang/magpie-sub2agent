import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import createCib, {ID, ORIGIN, DEFAULT_MODEL, CATALOG} from '../../build/sub2agent-runtime/workbuddy-cib/index.js';

const auth = {type: 'oauth', access: 'fixture-access', refresh: 'fixture-refresh',
  uid: 'fixture-user', enterpriseId: 'fixture-enterprise', expires: Date.now() + 3600000};
const json = data => Response.json({code: 0, data});
const client = {auth: {set: async () => {throw Error('Unexpected auth write');}}};
const readWire = init => JSON.parse(new Headers(init.headers).get('content-encoding') === 'gzip' ? gunzipSync(init.body).toString() : init.body);
const reply = () => new Response('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}],"usage":{"prompt_tokens":14,"completion_tokens":3,"credit":0.01}}\n\ndata: [DONE]\n\n', {headers: {'Content-Type': 'text/event-stream'}});
const refusal = 'Illegal API invocation from an unapproved channel';

test('CIB maps Claude/Codex templates once before compression, preserving user and tool quotes', async t => {
  let wire;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {wire = readWire(init); return reply();});
  const plugin = await createCib({client});
  const loader = await plugin.auth.loader(async () => auth);
  const quote = 'Codex CLI is an open source project led by OpenAI.';
  const body = {model: DEFAULT_MODEL, stream: true, messages: [
    {role: 'developer', content: [{type: 'text', text: "x-anthropic-billing-header: test\nYou are Claude Code, Anthropic’s official CLI for Claude.\n" + quote}]},
    {role: 'user', content: quote},
    {role: 'assistant', content: quote, tool_calls: [{id: 'call-1', type: 'function', function: {name: 'read_file', arguments: JSON.stringify({quote})}}]},
    {role: 'tool', tool_call_id: 'call-1', content: quote},
    {role: 'user', content: 'x'.repeat(20000)},
  ]};
  const original = JSON.stringify(body);
  const response = await loader.fetch(ORIGIN + '/v2/chat/completions', {method: 'POST', body: original});
  assert.equal(response.status, 200); await response.text();
  assert.equal(wire.messages[0].role, 'system');
  assert.match(wire.messages[0].content[0].text, /The Codex CLI/);
  assert.doesNotMatch(wire.messages[0].content[0].text, /billing-header|official CLI|The The/);
  assert.equal(wire.messages[1].content, quote);
  assert.equal(wire.messages[2].content, 'The ' + quote);
  assert.equal(wire.messages[2].tool_calls[0].function.arguments, JSON.stringify({quote}));
  assert.equal(wire.messages[3].content, quote);
  assert.equal(JSON.stringify(body), original);
});

for (const status of [400, 413, 500]) test(`CIB channel refusal ${status} retries once with system role retained`, async t => {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    sent.push(readWire(init));
    return sent.length === 1 ? Response.json({code: 11128, msg: refusal}, {status}) : reply();
  });
  const plugin = await createCib({client});
  const loader = await plugin.auth.loader(async () => auth);
  const response = await loader.fetch(ORIGIN + '/v2/chat/completions', {method: 'POST', body: JSON.stringify({model: DEFAULT_MODEL, stream: true, messages: [
    {role: 'system', content: 'You are an AI agent powered by Example Harness.\nKeep safety rules.'},
    {role: 'user', content: 'hello'},
  ]})});
  assert.equal(response.status, 200); await response.text();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].messages[0].role, 'system');
  assert.equal(sent[1].messages[0].content, 'You are an AI agent, powered by Example Harness.\nKeep safety rules.');
  assert.deepEqual(sent[1].messages[1], sent[0].messages[1]);
});

test('CIB persistent channel failure keeps upstream evidence and never demotes system', async t => {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    sent.push(readWire(init)); return Response.json({code: 11128, msg: refusal}, {status: 413});
  });
  const loader = await (await createCib({client})).auth.loader(async () => auth);
  const response = await loader.fetch(ORIGIN + '/v2/chat/completions', {method: 'POST', body: JSON.stringify({model: DEFAULT_MODEL, messages: [
    {role: 'system', content: 'You are an AI agent powered by Example Harness.'}, {role: 'user', content: 'hello'},
  ], stream: true})});
  assert.equal(sent.length, 2);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('X-Sub2Agent-Upstream-Status'), '413');
  const error = (await response.json()).error;
  assert.equal(error.type, 'prompt_refused');
  assert.equal(error.upstream_status, 413);
  assert.ok(sent.every(body => body.messages[0].role === 'system'));
});

test('CIB genuine size refusal and malformed-system 11128 do not trigger prompt retries', async t => {
  let calls = 0, status = 413, msg = 'Request Entity Too Large';
  t.mock.method(globalThis, 'fetch', async () => {calls++; return Response.json({code: 11128, msg}, {status});});
  const loader = await (await createCib({client})).auth.loader(async () => auth);
  const send = () => loader.fetch(ORIGIN + '/v2/chat/completions', {method: 'POST', body: JSON.stringify({model: DEFAULT_MODEL, messages: [
    {role: 'system', content: 'You are an AI agent powered by Example Harness.'}, {role: 'user', content: 'hello'},
  ], stream: true})});
  let response = await send();
  assert.equal(response.status, 413); assert.match(await response.text(), /Request Entity Too Large/);
  assert.equal(calls, 1);
  status = 400; msg = 'first message is not system prompt';
  response = await send(); assert.equal(response.status, 400); await response.text();
  assert.equal(calls, 2);
});

test('CIB fixed catalog and default do not discover or probe models', async t => {
  t.mock.method(globalThis, 'fetch', async () => {throw Error('Unexpected network');});
  const plugin = await createCib({client});
  const config = {};
  await plugin.config(config);
  assert.equal(DEFAULT_MODEL, 'glm-5.3-flash');
  assert.equal(config.provider[ID].api, ORIGIN + '/v2');
  assert.equal(config.provider[ID].icon, 'workbuddy-cib');
  assert.equal(Object.keys(config.provider[ID].models)[0], DEFAULT_MODEL);
  const models = await plugin.provider.models({id: ID, models: {}}, {auth});
  assert.deepEqual(Object.keys(models), CATALOG.map(([id]) => id));
  assert.ok(models['deepseek-v4.1-flash']);
  assert.ok(!models.hy4free && !models['deepseek-v4']);
  assert.equal(models[DEFAULT_MODEL].free, false);
  assert.equal(plugin.auth.methods.length, 1);
  assert.equal(plugin.auth.checkin, undefined);
});

test('CIB browser callback keeps enterprise credentials for host persistence', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const u = new URL(url); calls.push(u.pathname);
    assert.equal(u.origin, ORIGIN);
    if (u.pathname.endsWith('/state')) {
      assert.equal(u.searchParams.get('platform'), 'workbuddycib');
      return json({state: 'fixture-state', authUrl: ORIGIN + '/login'});
    }
    if (u.pathname.endsWith('/token')) return json({accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresIn: 3600});
    if (u.pathname.endsWith('/account')) return json({uid: 'fixture-user', enterpriseId: 'fixture-enterprise', enterpriseName: 'Fixture', nickname: 'User'});
    throw Error('Unexpected route');
  });
  const plugin = await createCib({client});
  const login = await plugin.auth.methods[0].authorize();
  assert.equal(new URL(login.url).searchParams.get('version'), '5.11.0');
  const result = await login.callback();
  assert.equal(result.type, 'success');
  assert.equal(result.access, auth.access);
  assert.equal(result.refresh, auth.refresh);
  assert.equal(result.uid, auth.uid);
  assert.equal(result.enterpriseId, auth.enterpriseId);
  assert.equal(calls.length, 3);
});

test('CIB balance uses enterprise meter and preserves unknown instead of zero', async t => {
  let valid = true;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, ORIGIN + '/v2/billing/meter/get-enterprise-user-usage');
    assert.equal(init.method, 'POST');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('x-enterprise-id'), auth.enterpriseId);
    assert.equal(headers.get('x-tenant-id'), auth.enterpriseId);
    return json(valid ? {credit: 123.05, limitNum: 2000, cycleResetTime: '2026-12-02 00:00:00'} : {});
  });
  const plugin = await createCib({client});
  const usage = await plugin.auth.usage(async () => auth);
  assert.equal(usage.windows[0].amount, 123.05);
  assert.equal(usage.windows[0].limit, 2000);
  assert.match(usage.windows[0].display, /1876.95/);
  assert.equal(usage.windows[0].resetText, '2026-12-02 00:00:00');
  assert.equal(usage.windows[0].resetsAt, undefined);
  assert.equal(usage.windows[0].span, undefined);
  valid = false;
  const unknown = await plugin.auth.usage(async () => auth);
  assert.match(unknown.error, /未知/);
  assert.equal(unknown.windows, undefined);
});

test('CIB reuses signed community streaming transport and keeps explicit models', async t => {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), ORIGIN + '/v2/chat/completions');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Bearer fixture-access');
    assert.equal(headers.get('x-domain'), 'webankcib.copilot.qq.com');
    assert.equal(headers.get('x-enterprise-id'), auth.enterpriseId);
    sent.push(JSON.parse(headers.get('content-encoding') === 'gzip' ? gunzipSync(init.body).toString() : init.body).model);
    return new Response('data: {"choices":[{"delta":{"content":"OK"}}],"usage":{"prompt_tokens":14,"completion_tokens":3,"credit":0.01}}\n\ndata: [DONE]\n\n', {headers: {'Content-Type': 'text/event-stream'}});
  });
  const plugin = await createCib({client});
  const loader = await plugin.auth.loader(async () => auth);
  for (const model of ['default-model', 'hy4']) {
    const response = await loader.fetch(ORIGIN + '/v2/chat/completions', {method: 'POST', body: JSON.stringify({model, messages: [{role: 'user', content: 'hello'}], stream: true})});
    assert.equal(response.status, 200);
    assert.match(await response.text(), /"credit":0.01/);
  }
  assert.deepEqual(sent, [DEFAULT_MODEL, 'hy4']);
});

test('CIB meter renews refused credentials once in its own provider namespace', async t => {
  let stored = {...auth}, reads = 0, writes = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const headers = new Headers(init.headers);
    if (url.endsWith('/token/refresh')) {
      assert.equal(headers.get('x-refresh-token'), auth.refresh);
      return json({accessToken: 'fixture-renewed', refreshToken: 'fixture-rotated', expiresIn: 3600});
    }
    assert.equal(url, ORIGIN + '/v2/billing/meter/get-enterprise-user-usage');
    if (++reads === 1) return Response.json({code: 401, msg: 'expired'}, {status: 401});
    assert.equal(headers.get('authorization'), 'Bearer fixture-renewed');
    return json({credit: 123.05, limitNum: 2000});
  });
  const plugin = await createCib({client: {auth: {set: async ({path, body}) => {
    assert.equal(path.id, ID); stored = body; writes++;
  }}}});
  const usage = await plugin.auth.usage(async () => stored);
  assert.equal(usage.signIn, 'renewed');
  assert.equal(usage.windows[0].amount, 123.05);
  assert.equal(stored.refresh, 'fixture-rotated');
  assert.equal(writes, 1);
  assert.equal(reads, 2);
});
