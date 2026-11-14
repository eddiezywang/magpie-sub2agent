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
