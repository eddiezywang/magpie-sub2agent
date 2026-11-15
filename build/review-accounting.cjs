// Read-only Playwright verification of the running portable distribution.
// node build/review-accounting.cjs <portable-data-directory> <screenshot-directory>
const {chromium} = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const [data, output] = process.argv.slice(2);
  assert.ok(data && output, 'provide data and screenshot directories');
  const {key} = JSON.parse(await fs.readFile(path.join(data, 'web-page.json'), 'utf8'));
  await fs.mkdir(output, {recursive:true});
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:8990/?k=' + encodeURIComponent(key) + '&view=plugins');
    await page.getByRole('tab', {name:'内置',exact:true}).click();
    const row = page.locator('.feat-row[data-id="accounting"]');
    await row.waitFor();
    assert.equal(await page.locator('.feat-set[data-of="accounting"]').count(), 0);
    assert.equal(await row.getByRole('switch', {name:'埋点上报',exact:true}).isVisible(), true);
    assert.doesNotMatch(await row.innerText(), /172\.21\.|v3|按分钟|旧版/);
    assert.equal(await page.locator('#side button[data-view="sessions"]').isVisible(), true);
    for (const theme of ['light','dark']) {
      // Local visual preview only: no settings writes and no reporting toggles.
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await row.scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(output, `05-accounting-${theme}.png`),fullPage:true});
    }
    assert.deepEqual(errors, []);
    const status = JSON.parse(await fs.readFile(path.join(data, 'accounting-status.json'), 'utf8'));
    console.log(JSON.stringify({pageErrors:errors,reporting:{legacyEnabled:status.legacy_enabled,usageEnabled:status.usage_enabled,pending:status.pending,queueFailures:status.queue_failures}},null,2));
  } finally { await browser.close(); }
})().catch(err => { console.error(err.message); process.exitCode = 1; });
