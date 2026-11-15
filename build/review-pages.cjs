// NODE_PATH may point to an existing Playwright installation. No desktop control.
// Usage: node build/review-pages.cjs <portable-data-directory> <output-directory>
const {chromium} = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const [data, output] = process.argv.slice(2);
  assert.ok(data && output, 'provide data and screenshot directories');
  const {key} = JSON.parse(await fs.readFile(path.join(data, 'web-page.json'), 'utf8'));
  await fs.mkdir(output, {recursive:true});
  const browser = await chromium.launch({channel:'chrome', headless:true});
  const report = [];
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Test the app's generated login link without opening a user's browser.
    await page.route('**/api/open', r => r.fulfill({json:{}}));
    await page.goto('http://127.0.0.1:8990/?k=' + encodeURIComponent(key));
    for (const view of (process.argv.includes('--auth-only') ? [] : ['agents','sessions','providers','routing','groups','gateway','usage','plugins','settings'])) {
      errors.length = 0;
      await page.goto('http://127.0.0.1:8990/?view=' + view);
      await page.waitForTimeout(6000);
      assert.equal(await page.title(), 'Sub2Agent');
      assert.equal(await page.locator('#side button[data-view="sessions"]').isVisible(), true, view + ': Sessions retained');
      const more = page.getByRole('button',{name:/显示全部.*Agent/});
      if (view === 'agents' && await more.count()) await more.click();
      if (view === 'plugins') await page.waitForTimeout(20000);
      await page.screenshot({path:path.join(output,view+'.png'),fullPage:true});
      report.push({view,errors:[...errors]});
      assert.deepEqual(errors, [], view);
    }
    await page.goto('http://127.0.0.1:8990/?view=providers');
    await page.getByText('WorkBuddy 企业',{exact:true}).waitFor();
    for (const [name,file] of [['CodeBuddy','codebuddy'],['WorkBuddy 企业','workbuddy'],['Trae 企业','trae']]) {
      await page.getByRole('button',{name,exact:true}).click();
      const linked = await page.locator('.signlink').waitFor({timeout:20000}).then(() => true, () => false);
      if (!linked) assert.ok(await page.getByText('登录未完成',{exact:true}).isVisible(), name + ': neither link nor actionable error');
      await page.waitForTimeout(600);
      // Mask session-specific URLs and codes before any image leaves the machine.
      await page.screenshot({path:path.join(output,file+'-add.png'),fullPage:true,
        animations:'disabled',maskColor:'#dfe3eb',mask:[page.locator('.signlink'),page.locator('.devcode')]});
      await page.getByRole('button',{name:'取消',exact:true}).click();
      await page.locator('.signlink').waitFor({state:'hidden'});
      report.push({view:file+'-add',linkGenerated:linked,cancelled:true});
    }
    assert.equal(await page.evaluate(async () => {
      const p = await (await fetch('/api/providers')).json();
      return p.plugins.every(x => !x.signedIn && !(x.accounts || []).length);
    }), true, 'cancelled flows leave no accounts');
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
})().catch(e => {console.error(e.message); process.exitCode=1;});
