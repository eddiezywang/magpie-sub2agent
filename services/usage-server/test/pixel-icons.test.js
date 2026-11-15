'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('pixel receipt marks retain the brand palette and crisp rendering', () => {
  const source = path.resolve(__dirname, '../src/icons.js');
  const dir = path.resolve(__dirname, '../../../build/intranet/pixel-icons');
  const svg = execFileSync(process.execPath, ['-e',
    `process.stdout.write(require(${JSON.stringify(source)}).iconMarkup('codex-color',0,0,24))`,
  ], { env: { ...process.env, USAGE_SERVER_ICON_DIR: dir }, encoding: 'utf8' });
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /#4673d8/);
  assert.match(svg, /#1c1a24/);
  assert.doesNotMatch(svg, /rgb\(/);
});

test('classic receipt keeps its lake and logo as it grows for more models', () => {
  const { renderReportCardSvg } = require('../src/card');
  const base = { user: { name: 'fixture-user' }, period: { type: 'daily' }, totals: { requests: 1 }, by_agent_model: [] };
  const short = renderReportCardSvg(base);
  const long = renderReportCardSvg({ ...base, by_agent_model: [
    { agent: 'codex', icon: 'codex-color', models: Array.from({ length: 5 }, (_, i) => ({ model: `fixture-${i}`, icon: 'openai' })) },
    { agent: 'claude', icon: 'claudecode-color', models: Array.from({ length: 5 }, (_, i) => ({ model: `fixture-${i}`, icon: 'claude-color' })) },
  ] });
  const height = svg => Number(svg.match(/viewBox="0 0 \d+ (\d+)"/)[1]);
  assert.ok(height(long) > height(short));
  assert.match(long, /data:image\/jpeg;base64,/);
  assert.match(long, /data:image\/png;base64,/);
  assert.match(long, /Sub2Agent/);
  assert.match(long, /shape-rendering="crispEdges"/);
});
