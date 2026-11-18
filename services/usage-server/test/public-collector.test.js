'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createPublicCollector } = require('../src/public-collector');
const { SCHEMA, counters } = require('../src/summary-store');

test('public collector durably acknowledges and deduplicates packets, and restricts mirror reads', async () => {
  const directory = mkdtempSync(join(tmpdir(),'sub2agent-public-'));
  const file = join(directory,'inbox.sqlite');
  const token = 'fixture-mirror-token';
  let collector = createPublicCollector(file,token);
  const server = createServer((req,res) => collector.handler(req,res));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (path,payload) => fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  try {
    const capability = await (await fetch(base+'/healthz')).json();
    assert.deepEqual(capability.usage_schemas,[SCHEMA]);
    const now = new Date();
    now.setUTCSeconds(0,0);
    const group = Object.fromEntries(counters.map(field => [field,0]));
    Object.assign(group,{agent:'codex',provider:'fixture',model:'fixture',model_source:'served',
      service_tier:'',context_tier:'unclassified',rules_revision:'',attempts:1,requests:1,success:1,input_tokens:20});
    const report = {schema:SCHEMA,install_id:'install',username:'fixture-user',summaries:[{id:'same',minute:now.toISOString(),groups:[group]}]};
    assert.deepEqual((await (await post('/usage/events',report)).json()).accepted_ids,['same']);
    collector.close();
    collector = createPublicCollector(file,token);
    assert.deepEqual((await (await post('/usage/events',report)).json()).duplicate_ids,['same']);
    group.input_tokens = 21;
    assert.deepEqual((await (await post('/usage/events',report)).json()).rejected_ids,['same']);
    const event={install_id:'install',username:'fixture-user',id:'legacy',event:'desktop_app_start',
      timestamp:now.toISOString(),argv:[],private:'must not leave source'};
    assert.equal((await post('/events',event)).status,200);
    assert.equal((await post('/events',event)).status,200);
    assert.equal((await fetch(base+'/mirror')).status,401);
    const headers={Authorization:'Bearer '+token};
    const result=await (await fetch(base+'/mirror',{headers})).json();
    assert.equal(result.rows.length,2);
    assert.equal(JSON.parse(result.rows[1].payload).private,undefined);
    assert.deepEqual((await (await fetch(base+'/mirror?after='+result.rows[1].seq,{headers})).json()).rows,[]);
  } finally {
    await new Promise(resolve => server.close(resolve));
    collector.close();
    rmSync(directory,{recursive:true,force:true});
  }
});
