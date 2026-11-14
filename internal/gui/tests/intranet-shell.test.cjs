// Run against the extracted intranet asset pack (MAGPIE_ASSETS). Omitted
// plugin pages must not interrupt the core shell's initialization.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const { agentRow } = require('./reader.cjs');

test('intranet Agents initializes without removed plugin pages', async (t) => {
  assert.ok(process.env.MAGPIE_ASSETS, 'extract the intranet assets.zip first');
  const browser = process.env.BROWSER === 'webkit'
    ? await webkit.launch()
    : await chromium.launch({ channel: process.env.MAGPIE_TEST_BROWSER || 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const json = data => route.fulfill({ json: data });
    if (url.pathname === '/boot.js') return route.fulfill({contentType: 'text/javascript', body: 'window.bootPrefs={lang:"en",theme:"light",web:true,intranet:true,featuresOff:["library","search","otel","tools","warmups"]};'});
    if (url.pathname === '/api/state') return json({agents:[agentRow('codex','Codex')],profiles:[],settings:{lang:'en',theme:'light',version:'0.1.3913-sub2agent.3'}});
    if (url.pathname === '/api/settings') return json({lang:'en',theme:'light',version:'0.1.3913-sub2agent.3'});
    if (url.pathname === '/api/providers') return json({providers:[],presets:[{id:'remote-magpie',name:'Remote sub2agent',icon:'magpie',kind:'remote',endpoint:'http://192.168.1.20:3425',note:"another computer's magpie, shared on its network"}],excluded:[],gateway:{running:true,window:true}});
    if (url.pathname === '/api/plugins') return json({plugins:[]});
    if (url.pathname === '/api/update') return json({state:'latest',current:'0.1.3913-sub2agent.3'});
    if (url.pathname === '/api/gateway/trace') {
      if (url.searchParams.has('wait')) return;
      const now = new Date().toISOString();
      return json({mine:true,now,seq:1,totals:{requests:1,rerouted:0,errors:0},routes:[{
        id:1,seq:1,time:now,agent:'codex',model:'test-model',provider:'test',done:false,
        order:[{id:'test#key',provider:'test',name:'Test vendor',kind:'key',model:'test-model'}],
        tries:[{id:'test#key',model:'test-model',start:now,done:false}],
      }]});
    }
    if (url.pathname === '/api/gateway/history') return json({days:[],routes:[]});
    if (url.pathname.startsWith('/api/')) return json({});
    try {
      const file = path.join(process.env.MAGPIE_ASSETS, url.pathname === '/' ? 'index.html' : url.pathname);
      return route.fulfill({body:await fs.readFile(file),contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)]});
    } catch { return route.fulfill({status:404,body:''}); }
  });
  await page.goto('http://intranet.test/?view=agents');
  await page.locator('.row.agent[data-id="codex"]').waitFor();
  await page.waitForTimeout(400); // the header's delayed animation used to assume a bird
  assert.equal(await page.title(), 'Sub2Agent');
  assert.equal(await page.locator('#view-library').count(), 0);
  assert.equal(await page.locator('#view-sessions').count(), 1);
  assert.equal(await page.locator('#side button[data-view="sessions"]').isVisible(), true);
  await page.evaluate(() => applyFeatures([{id:'sessions',on:true}]));
  assert.equal(await page.locator('#side button[data-view="sessions"]').isVisible(), true, 'feature refresh retains Sessions');
  assert.deepEqual(errors, []);
  await t.test('shared switches stay visible and operable without Library CSS', async () => {
    await page.evaluate(() => {
      const sw = magpie.ui.toggle(false, 'Reporting test switch', () => {});
      Object.assign(sw.style, {position:'fixed',top:'100px',left:'300px',zIndex:9999});
      document.body.append(sw);
    });
    const toggle = page.getByRole('switch', {name:'Reporting test switch'});
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      const state = await toggle.evaluate(e => {
        const style = getComputedStyle(e), thumb = getComputedStyle(e.firstElementChild);
        return {background:style.backgroundColor,position:thumb.position,radius:parseFloat(style.borderRadius),width:e.getBoundingClientRect().width};
      });
      assert.notEqual(state.background, 'rgba(0, 0, 0, 0)', theme + ': switch track is invisible');
      assert.equal(state.position, 'absolute', theme + ': switch thumb is missing its layout');
      assert.ok(state.radius >= 8 && state.width >= 28, theme + ': switch track has no shape');
    }
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await toggle.evaluate(e => e.remove());
  });
  await page.evaluate(() => show('settings'));
  await page.getByText('Share on local network', {exact:true}).waitFor();
  assert.equal(await page.locator('#webPageHead:visible, #webPageList:visible').count(), 0,
    'browser management settings stay hidden in the intranet distribution');
  const version = page.locator('#internalSettings [data-setting=version]');
  await version.getByText('0.1.3913-sub2agent.3').waitFor();
  assert.ok(await version.getByRole('button', {name:'Check'}).isVisible());
  await page.evaluate(() => show('providers'));
  await page.getByText('Remote sub2agent', {exact:true}).first().waitFor();
  assert.deepEqual(errors, []);
  await page.evaluate(() => show('routing'));
  await page.locator('.rt-sky .pkt').waitFor({state:'attached'});
  await t.test('routing has a visible Sub2Agent mark', async () => {
    assert.equal(await page.locator('.rt-hub svg image').count(), 1);
    assert.equal(await page.locator('.rt-hub svg image').getAttribute('href'), 'icons/magpie.svg');
    assert.equal(await page.locator('.rt-hub svg use[href="#bird"]').count(), 0);
  });
  await t.test('routing animates packets without magpie carriers', async () => {
    assert.equal(await page.locator('.rt-flier').count(), 0);
  });
  await t.test('loading uses neutral skeletons without a bird', async () => {
    await page.evaluate(async () => {
      const s = document.createElement('div');
      s.className = 'skeleton'; s.style.cssText = 'position:fixed;top:100px;left:300px;width:200px;height:20px';
      document.body.append(s);
      skelBird();
    });
    assert.equal(await page.locator('.sk-bird').count(), 0);
    assert.equal(await page.locator('.skeleton').last().evaluate(e => getComputedStyle(e).animationName), 'skeleton-shift');
  });
});
