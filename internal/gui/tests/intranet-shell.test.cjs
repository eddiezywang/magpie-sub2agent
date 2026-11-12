// Run against the extracted intranet asset pack (MAGPIE_ASSETS). Omitted
// plugin pages must not interrupt the core shell's initialization.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { agentRow } = require('./reader.cjs');

test('intranet Agents initializes without removed plugin pages', async (t) => {
  assert.ok(process.env.MAGPIE_ASSETS, 'extract the intranet assets.zip first');
  const browser = await chromium.launch({ channel: process.env.MAGPIE_TEST_BROWSER || 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const json = data => route.fulfill({ json: data });
    if (url.pathname === '/boot.js') return route.fulfill({contentType: 'text/javascript', body: 'window.bootPrefs={lang:"en",theme:"light",web:true,intranet:true,featuresOff:["library","sessions","search","otel","tools","warmups"]};'});
    if (url.pathname === '/api/state') return json({agents:[agentRow('codex','Codex')],profiles:[],settings:{lang:'en',theme:'light'}});
    if (url.pathname === '/api/providers') return json({providers:[],presets:[],excluded:[],gateway:{running:true,window:true}});
    if (url.pathname === '/api/plugins') return json({plugins:[]});
    if (url.pathname.startsWith('/api/')) return json({});
    try {
      const file = path.join(process.env.MAGPIE_ASSETS, url.pathname === '/' ? 'index.html' : url.pathname);
      return route.fulfill({body:await fs.readFile(file),contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)]});
    } catch { return route.fulfill({status:404,body:''}); }
  });
  await page.goto('http://intranet.test/?view=agents');
  await page.locator('.row.agent[data-id="codex"]').waitFor();
  assert.equal(await page.locator('#view-library').count(), 0);
  assert.deepEqual(errors, []);
});
