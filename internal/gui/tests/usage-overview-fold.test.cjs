// Run with Node's test runner and Playwright on the module path; see README.md.
// #2378 (Usage › Overview): the Agents, Models, Accounts and Gateway keys
// lists each fold away under their heading (日常看账号维度较多，都要拉到最底下),
// by a chevron on the heading, and stay folded across a reload; a click on
// a heading leaves the heading where it is. The tokens tile's label is a
// pop-up (the app's own menu) of how the totals are counted: without the
// cache, as before, or with the cache read and written counted too, in the
// tile, the chart and every row; kept across a reload. And on the Requests
// tab the Tokens card's line (in · out · cache) wraps between its parts
// rather than cutting the cache off in a wide window's five cards (缓存
// 879…). Every language, 1100 and 420 wide (the Requests card at 1500 too);
// no backend, the API is faked.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");
const reader = require("./reader.cjs");

const assets = path.resolve(__dirname, "../assets");

// a row: tokens in and out, and the cache read beside them
const G = (id, name, input, output, cache_read, extra) => ({ id, name, icon: "generic", calls: 10, input, output, cache_read, cache_write: 0, cost: 0, ...extra });
const AGENTS = [G("codex", "Codex", 5856000, 2217000, 560000000), G("pi", "Pi", 38000, 361, 9216), G("curl", "curl", 17000, 218, 0)];
const MODELS = [G("gpt-6", "gpt-6", 5856000, 2217000, 560000000, { model: "gpt-6" }), G("glm-5", "glm-5", 55000, 579, 9216, { model: "glm-5" })];
const ACCOUNTS = [G("acct-a", "a@example.com", 4000000, 1500000, 400000000), G("acct-b", "b@example.com", 1911000, 717579, 160009216)];
const KEYS = [G("key-1", "laptop", 5911000, 2217579, 560009216)];
const sum = (k) => AGENTS.reduce((n, g) => n + g[k], 0);
const USAGE = {
  calls: 30, errors: 0, input: sum("input"), output: sum("output"), reasoning: 0, cache_read: sum("cache_read"), cache_write: 0, unpriced: 0, cost: 0, bucket: "day",
  series: [{ label: "Oct 15", time: new Date().toISOString(), calls: 30, input: sum("input"), output: sum("output"), cache_read: sum("cache_read"), cache_write: 0, cost: 0 }],
  path: "~/.config/magpie/usage.jsonl",
  agents: AGENTS, models: MODELS, accounts: ACCOUNTS, callerKeys: KEYS,
};
// the Requests tab's totals, the reporter's: 183.2万 in, 71.1万 out, 8793.3万 cache
const LEDGER = {
  period: "today", rows: [], offset: 0, total: 938, calls: 938, errors: 4, retried: 7,
  input: 1832000, output: 711000, cache_read: 87933000, cache_write: 0, cost: 12.3, unpriced: 0,
  by: {}, bucket: "hour", series: [], agents: [],
};

function server(lang, zht) {
  return async (route) => {
    const url = new URL(route.request().url());
    const json = (data) => route.fulfill({ json: data });
    // zh and zh-TW in 万 and 亿, as the reporter reads them (183.2万 in · 8793.3万 cache)
    const theme = zht?.theme || "light";
    const settings = { lang, theme, chineseUnits: lang.startsWith("zh") };
    if (url.pathname === "/boot.js") return route.fulfill({ contentType: "text/javascript", body: `window.bootPrefs = {lang:"${lang}",theme:"${theme}",web:false,intranet:${!!zht}};` });
    if (url.pathname === "/wails/runtime.js") return route.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
    if (url.pathname === "/api/state") return json({ agents: [], profiles: [], settings, fx: { rate: 7.2, at: new Date().toISOString() } });
    if (url.pathname === "/api/agents/connections") return json({ agents: [], checks: {} });
    if (url.pathname === "/api/settings") return json(settings);
    if (zht?.routes && Object.hasOwn(zht.routes, url.pathname)) {
      const reply = zht.routes[url.pathname];
      return typeof reply === "function" ? reply(route, url) : json(reply);
    }
    if (url.pathname === "/api/usage/quotas") return json([]);
    if (url.pathname === "/api/usage/requests") return json(LEDGER);
    if (url.pathname === "/api/usage/suppliers" && zht) {
      return json(zht.suppliers || [{ id: "cib", providers: ["cib-zht-apikey"] }]);
    }
    if (url.pathname === "/api/usage/suppliers/cib" && zht) return json(zht);
    if (url.pathname === "/api/usage") return json(USAGE);
    if (url.pathname === "/api/providers") return json({ providers: [], presets: [], excluded: [], models: [], gateway: { running: false } });
    if (url.pathname === "/api/sessions") return json({ sessions: [], dirs: [] });
    if (url.pathname === "/api/sessions/stats") return json({ from: "", to: "", days: [], agents: {} });
    if (url.pathname === "/api/groups") return json({ groups: [], models: [] });
    if (url.pathname.startsWith("/api/")) return json({});
    const file = path.join(assets, url.pathname === "/" ? "index.html" : url.pathname);
    const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)];
    try {
      let body = await fs.readFile(file);
      if (url.pathname === "/" && zht) body = body.toString().replace("</head>", '<link rel="stylesheet" href="intranet-retro.css"></head>');
      await route.fulfill({ body, contentType });
    } catch { await route.fulfill({ status: 404, body: "" }); }
  };
}

// the words the reader sees: the headings' titles, the tile's label, the menu
const L = {
  en: { foldAcc: "Fold the accounts away", showAcc: "Show the accounts", tokens: "tokens", withCache: "tokens with cache", without: "Without cache", with: "With cache", head: "Token totals" },
  zh: { foldAcc: "收起账号", showAcc: "展开账号", tokens: "token", withCache: "token（含缓存）", without: "不含缓存", with: "含缓存", head: "token 汇总" },
  "zh-TW": { foldAcc: "收起帳號", showAcc: "展開帳號", tokens: "token", withCache: "token（含快取）", without: "不含快取", with: "含快取", head: "token 總計" },
  ja: { foldAcc: "アカウントを折りたたむ", showAcc: "アカウントを表示", tokens: "トークン", withCache: "トークン（キャッシュ込み）", without: "キャッシュなし", with: "キャッシュ込み", head: "トークンの合計" },
  de: { foldAcc: "Konten einklappen", showAcc: "Konten anzeigen", tokens: "Token", withCache: "Token mit Cache", without: "Ohne Cache", with: "Mit Cache", head: "Token-Summen" },
};

const goUsage = async (p) => {
  const nav = p.locator('[data-view="usage"]:visible').first();
  if (await nav.count()) await nav.click();
  else await p.evaluate(() => show("usage"));
};

test("CIB token usage shows K/M/B totals and switches daily line ranges", async (t) => {
  const browser = await chromium.launch({ channel: "chromium" });
  t.after(() => browser.close());
  const data = {
    today: { tokens: 1250 }, week: { tokens: 2_400_000 }, month: { tokens: 81_000_000 },
    total: { tokens: 1_300_000_000, calls: 100 }, ledgerFrom: "2026-10-31T12:00:00Z",
    activity: Array.from({ length: 30 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, tokens: i * 1000 })),
  };
  for (const width of [1100, 420]) {
    const p = await browser.newPage({ viewport: { width, height: 720 }, locale: "zh-CN" });
    const errors = [];
    p.on("pageerror", error => errors.push(error.message));
    await p.route("**/*", server("zh", data));
    await p.goto("http://magpie.test/");
    await goUsage(p);
    const panel = p.locator("#supplierUsage");
    await panel.locator("polyline").waitFor();
    assert.deepEqual(await panel.locator("dd").allTextContents(), ["1.25K", "2.4M", "81M", "1.3B"]);
    assert.equal(await panel.locator(".su-pixel").count(), 30);
    assert.equal(await panel.locator(".su-chart-hit title").last().textContent(), "2026-11-30 · 29,000 Token");
    const week = panel.locator('button[value="7"]');
    await week.click();
    assert.equal(await week.getAttribute("aria-pressed"), "true");
    await panel.locator(".su-pixel").nth(6).waitFor();
    assert.equal(await panel.locator(".su-pixel").count(), 7);
    await panel.locator('button[value="30"]').click();
    await panel.locator(".su-pixel").nth(29).waitFor();
    assert.equal(await panel.locator(".su-pixel").count(), 30);
    assert.equal(await panel.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.deepEqual(errors, []);
    if (process.env.CIB_SCREENSHOT && width === 1100) await panel.screenshot({ path: process.env.CIB_SCREENSHOT });
    await p.close();
  }
});

test("configured supplier tabs use independent TIG windows, WorkBuddy readings and gateway views", async (t) => {
  const browser = await chromium.launch({ channel: "chromium" });
  t.after(() => browser.close());
  const ids = { tig: "aiep-coding-plan", enterprise: "sub2agent-workbuddy", cib: "sub2agent-workbuddy-cib" };
  const time = "2026-11-19T00:00:00+08:00";
  const stats = {
    from: "2026-11-13", to: "2026-11-19", asOf: "2026-11-19T13:00:00+08:00",
    ledgerFrom: "2026-11-16T00:00:00+08:00", total: { calls: 3, tokens: 12_000, maasCovered: 1, maasPoints: 4, credited: 1, credits: 2 },
    selected: { calls: 3, tokens: 12_000, tigTokens: 10_000, offPeakTokens: 5_000, tigCovered: 2, tigAmount: 4, cacheRead: 500, knownPrompt: 1000 },
    peak: { date: "2026-11-19", tokens: 12000 }, streak: 1, longest: 1,
    activity: Array.from({ length: 14 }, (_, i) => ({ date: `2026-11-${String(i + 6).padStart(2, "0")}`, tokens: i === 13 ? 12000 : 0 })),
    models: [{ id: "glm-5.3-zp", tokens: 10000, calls: 1 }, { id: "glm-5.3-flash-zp", tokens: 2000, calls: 1 }],
    timeline: [{ time, models: [{ id: "glm-5.3-zp", tokens: 10000 }, { id: "glm-5.3-flash-zp", tokens: 2000 }] }],
  };
  const catalog = {
    config: { plans: { zp: { windows: [{ id: "rolling_5h", limit: 35000 }, { id: "subscription_week", limit: 155000 }] } } },
    rates: [{ provider: ids.tig + "*", deployment: "zp", model: "glm-5.3-zp", credit_rates: { input: 6.9, cache_read: 1.7, output: 24 }, source: "Zhipu Coding Plan" }],
  };
  for (const [width, theme] of [[1230, "light"], [420, "dark"]]) {
    const page = await browser.newPage({ viewport: { width, height: 820 }, timezoneId: "Asia/Shanghai", colorScheme: theme });
    await page.clock.setFixedTime(new Date(stats.asOf));
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const reportReads = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/accounting/report" && url.searchParams.get("period") === "tig-plans") reportReads.push(url.pathname);
    });
    const config = {
      theme, suppliers: [
        { id: "tig", providers: [ids.tig] }, { id: "workbuddy-enterprise", providers: [ids.enterprise] },
        { id: "workbuddy-cib", providers: [ids.cib] },
      ],
      routes: {
        "/api/providers": { providers: [{ id: ids.tig, models: [{ id: "glm-5.3-zp" }, { id: "glm-5.3-tc" }] }], presets: [] },
        "/api/usage/suppliers/tig": stats,
        "/api/usage/suppliers/workbuddy-enterprise": stats,
        "/api/usage/suppliers/workbuddy-cib": stats,
        "/api/accounting/tig-plans": catalog,
        "/api/usage/suppliers/tig/keys": [{ provider: ids.tig, keys: [{ id: "fingerprint-one", name: "Desk" }, { id: "fingerprint-two", name: "Team" }] }],
        "/api/usage/suppliers/tig/key": (route, url) => route.fulfill({ json: url.searchParams.get("key") === "fingerprint-one" ? {
          windows: [{ period: "fiveHours", status: "unknown" }, { period: "week", status: "unknown" }],
          usage: { periods: {
            fiveHours: { complete: true, rolling: true, points: 24500, priced: 1 },
            week: { complete: false, rolling: true, points: 15500, priced: 1, uncovered: 2 },
          } },
        } : { windows: [{ period: "fiveHours", status: "observed", reset: "2026-11-19T16:00:00+08:00" }, { period: "week", status: "expired" }],
          usage: { periods: { fiveHours: { complete: false, rolling: true, points: 200, priced: 1, uncovered: 2 }, week: { rolling: true, points: 0, priced: 0, uncovered: 2 } } } } }),
        "/api/usage/quotas": [
          { provider: ids.cib, user: "account-one-fixture", windows: [{ name: "Credits", used: 0, limit: 2000, resetText: "2026-12-02 00:00:00" }] },
          { provider: ids.cib, user: "account-two-fixture", windows: [{ name: "Credits", amount: 2500.1358, used: 71, limit: 3521, resetText: "2026-12-03 00:00:00" }] },
        ],
        "/api/usage/suppliers/workbuddy-cib/rates": { rates: [{ model: "glm-5.3", coefficient: .79, source: "Reference from provider catalog" }] },
      },
    };
    await page.route("**/*", server("zh", config));
    await page.goto("http://magpie.test/");
    await page.evaluate(() => {
      const showStatus = window.status;
      window.status = (message, kind, duration) => {
        if (kind === "err") console.error(new Error(message).stack);
        return showStatus(message, kind, duration);
      };
    });
    const runtimeAlerts = [];
    page.on("console", (message) => { if (message.type() === "error" && message.text().includes("window.status")) runtimeAlerts.push(message.text()); });
    await goUsage(page);
    const panel = page.locator("#supplierUsage");
    await panel.getByText("70%", { exact: true }).waitFor();
    const shortWindow = panel.locator(".su-window").filter({ has: page.getByRole("heading", { name: "5 小时额度" }) });
    const weekWindow = panel.locator(".su-window").filter({ has: page.getByRole("heading", { name: "周额度" }) });
    const gauge = (window) => window.locator(".su-rail i");
    const fillStyle = (fill) => fill.evaluate((el) => ({ width: el.style.width, color: getComputedStyle(el).backgroundColor }));
    const themeColor = (name) => page.evaluate((name) => {
      const swatch = document.createElement("span");
      swatch.style.color = `var(${name})`;
      document.body.append(swatch);
      const color = getComputedStyle(swatch).color;
      swatch.remove();
      return color;
    }, name);
    const blue = await themeColor("--accent");
    const red = await themeColor("--red");
    assert.notEqual(blue, red);
    assert.deepEqual(await fillStyle(gauge(shortWindow)), { width: "70%", color: blue });
    assert.match(await shortWindow.innerText(), /滚动 5 小时估算\s+24,500\s+积分/);
    await weekWindow.getByText("10%", { exact: true }).waitFor();
    assert.deepEqual(await fillStyle(gauge(weekWindow)), { width: "10%", color: blue });
    assert.match(await weekWindow.innerText(), /滚动 7 天估算\s+15,500\s+积分/);
    assert.match(await weekWindow.innerText(), /2 次请求未覆盖/);
    assert.deepEqual(await panel.getByRole("tab").allTextContents(), ["TIG", "WorkBuddy 企业", "WorkBuddy CIB"]);
    assert.match(await panel.innerText(), /35,000\s+积分/);
    assert.match(await panel.innerText(), /周额度/);
    if (process.env.SUPPLIER_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SUPPLIER_SCREENSHOTS, `supplier-usage-${theme}.png`), animations: "disabled" });
    await panel.locator("select").selectOption("1");
    await shortWindow.getByText("429 已确认").waitFor();
    await shortWindow.getByText("100%", { exact: true }).waitFor();
    await shortWindow.getByText("额度已用尽", { exact: true }).waitFor();
    assert.deepEqual(await fillStyle(gauge(shortWindow)), { width: "100%", color: red });
    assert.equal(await gauge(weekWindow).count(), 0);
    assert.match(await shortWindow.innerText(), /滚动 5 小时估算\s+200\s+积分/);
    assert.equal(await panel.getByText("70%", { exact: true }).count(), 0);
    assert.match(await panel.innerText(), /窗口观测已过期/);
    assert.equal(await panel.getByText("服务器用量估算（按用户名）", { exact: true }).count(), 0);

    await panel.locator('button[value="activity"]').click();
    await panel.locator(".su-heat-cell").first().waitFor();
    assert.ok(await panel.locator('.su-heatmap [data-level="unknown"]').count());
    assert.ok(await panel.locator('.su-heatmap [data-level="0"]').count());
    assert.doesNotMatch(await panel.innerText(), /使用时长/);
    if (process.env.SUPPLIER_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SUPPLIER_SCREENSHOTS, `supplier-activity-${theme}.png`), animations: "disabled" });
    await panel.locator('button[value="weekly"]').click();
    await panel.locator(".su-pixel").waitFor();
    await panel.locator('button[value="cumulative"]').click();
    await panel.locator(".su-pixel").waitFor();

    await panel.locator('button[value="details"]').click();
    await panel.locator(".su-kpi dd").first().waitFor();
    assert.equal(await panel.locator(".su-kpi dd").first().textContent(), "12K");
    assert.match(await panel.locator(".su-selected-total").innerText(), /12K/);
    await panel.locator(".su-model").first().click();
    assert.match(await panel.locator(".su-selected-total").innerText(), /2K/);
    await panel.getByText("模型系数", { exact: true }).click();
    await panel.getByText("6.9", { exact: true }).waitFor();
    if (process.env.SUPPLIER_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SUPPLIER_SCREENSHOTS, `supplier-details-${theme}.png`), animations: "disabled" });

    await panel.getByRole("tab", { name: "WorkBuddy CIB" }).click();
    await panel.locator('button[value="quota"]').click();
    await panel.getByText("2026-12-02 00:00:00", { exact: true }).waitFor();
    await panel.getByText("2026-12-03 00:00:00", { exact: true }).waitFor();
    await panel.getByText("2,500 积分", { exact: true }).waitFor();
    await panel.getByText("0%", { exact: true }).waitFor();
    const secondAccount = panel.locator(".su-window").filter({ has: page.getByRole("heading", { name: "账号 2" }) });
    await secondAccount.getByText("71%", { exact: true }).waitFor();
    assert.deepEqual(await fillStyle(gauge(secondAccount)), { width: "71%", color: red });
    assert.doesNotMatch(await panel.innerText(), /account-one-fixture/);
    assert.equal(await page.locator("#subscriptionUsage").isHidden(), true);
    await panel.getByRole("tab", { name: "WorkBuddy 企业" }).click();
    await panel.getByText("4 积分", { exact: true }).waitFor();
    await panel.getByText("2 积分", { exact: true }).waitFor();
    assert.equal(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
    assert.deepEqual(errors, []);
    assert.deepEqual(runtimeAlerts, []);
    assert.deepEqual(reportReads, []);
    await page.close();
  }
});

test("supplier usage ignores late replies and hides when configuration is empty", async (t) => {
  const browser = await chromium.launch({ channel: "chromium" });
  t.after(() => browser.close());
  const page = await browser.newPage();
  let release, configReads = 0;
  let configured = [{ id: "cib", providers: ["cib-zht-apikey"] },
    { id: "workbuddy-cib", providers: ["sub2agent-workbuddy-cib"] }];
  const delayed = new Promise((resolve) => { release = resolve; });
  const routes = {
    "/api/usage/suppliers": (route) => { configReads++; return route.fulfill({ json: configured }); },
    "/api/usage/suppliers/cib": async (route) => {
      await delayed;
      await route.fulfill({ json: { total: { calls: 1, tokens: 12345 }, activity: [] } }).catch(() => {});
    },
    "/api/usage/suppliers/workbuddy-cib": (route) => route.fulfill({ status: 503, body: "fixture offline" }),
    "/api/usage/quotas": [{ provider: "sub2agent-workbuddy-cib", error: "fixture expired" }],
  };
  t.after(release);
  await page.route("**/*", server("en", { routes }));
  await page.goto("http://magpie.test/");
  const requested = page.waitForRequest((req) => new URL(req.url()).pathname === "/api/usage/suppliers/cib");
  await goUsage(page);
  await requested;
  const panel = page.locator("#supplierUsage");
  await panel.getByRole("tab", { name: "WorkBuddy CIB" }).click();
  await panel.getByText("Gateway usage query failed", { exact: true }).waitFor();
  await panel.getByText("Allowance query failed", { exact: true }).waitFor();
  release();
  await panel.locator('button[value="activity"]').click();
  await panel.getByText("Gateway usage query failed", { exact: true }).waitFor();
  assert.doesNotMatch(await panel.innerText(), /12.35K/);

  await page.evaluate(() => show("agents"));
  const prior = configReads;
  await page.evaluate(() => supplierUsage.refresh(true));
  assert.equal(configReads, prior);
  configured = [];
  await goUsage(page);
  await page.waitForFunction(() => document.querySelector("#supplierUsage").hidden);
  await page.locator("#stats .kpi").first().waitFor();
});

for (const engine of (process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"])) {
  test(engine + ": the Overview's lists fold, the totals count the cache on request, the Requests card's cache is whole", async (t) => {
    assert(["chromium", "webkit"].includes(engine), "BROWSER must be chromium or webkit");
    const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: "chromium" }));
    t.after(() => browser.close());
    for (const lang of Object.keys(L)) {
      const w = L[lang];
      for (const width of [1100, 420]) {
        await t.test(`${lang} ${width}: folds and the cache`, async () => {
          const errors = [];
          const ctx = await browser.newContext({ viewport: { width, height: 700 }, reducedMotion: "reduce" });
          t.after(() => ctx.close());
          const open = async () => {
            const p = await ctx.newPage();
            p.setDefaultTimeout(5000);
            p.setDefaultNavigationTimeout(60000);
            p.on("pageerror", (e) => errors.push(e.message));
            await p.route("**/*", server(lang));
            await p.goto("http://magpie.test/");
            await goUsage(p);
            // drawn, folded or not: a reload may find Accounts folded away
            await p.locator("#usageAccounts .row.stat").first().waitFor({ state: "attached" });
            return p;
          };
          let p = await open();
          const fold = (id) => p.locator(`#usagePane .row-head .fold[data-fold="${id}"]`);
          const shown = (sel) => p.locator(sel).evaluate((e) => !!e.offsetParent);
          const top = (loc) => loc.evaluate((e) => e.getBoundingClientRect().top);

          // every list's heading is a fold with its chevron, open at first
          for (const id of ["agents", "models", "accounts", "keys"]) {
            assert.equal(await fold(id).getAttribute("aria-expanded"), "true", id + " starts open");
            assert.equal(await fold(id).locator("svg").count(), 1, id + " has its chevron");
          }
          assert.equal(await fold("accounts").getAttribute("title"), w.foldAcc);
          // no coloured stripe on a heading
          assert.equal(await fold("accounts").evaluate((e) => getComputedStyle(e).borderLeftWidth), "0px");

          // Accounts folds where the reader has it, and the heading stays put
          await reader.inView(p, fold("accounts"));
          const was = await top(fold("accounts"));
          await fold("accounts").click();
          await p.waitForTimeout(150);
          assert.equal(await fold("accounts").getAttribute("aria-expanded"), "false");
          assert.equal(await fold("accounts").getAttribute("title"), w.showAcc);
          assert.equal(await shown("#usageAccounts"), false, "the accounts are folded away");
          assert(Math.abs((await top(fold("accounts"))) - was) <= 1, "folding moved the heading");
          assert.equal(await shown("#usageKeys"), true, "the keys below are still open");

          // Agents and Models fold too: Accounts' heading comes up the page
          await reader.inView(p, fold("agents"));
          const at = await top(fold("agents"));
          await fold("agents").click();
          await p.waitForTimeout(150);
          assert(Math.abs((await top(fold("agents"))) - at) <= 1, "folding Agents moved its heading");
          assert.equal(await shown("#usageAgents"), false);
          await reader.inView(p, fold("models"));
          await fold("models").click();
          await p.waitForTimeout(150);
          assert.equal(await shown("#usageModels"), false);

          // a reload keeps what was folded
          await p.close();
          p = await open();
          assert.equal(await fold("agents").getAttribute("aria-expanded"), "false", "Agents stays folded");
          assert.equal(await fold("models").getAttribute("aria-expanded"), "false", "Models stays folded");
          assert.equal(await fold("accounts").getAttribute("aria-expanded"), "false", "Accounts stays folded");
          assert.equal(await shown("#usageAgents"), false);
          assert.equal(await shown("#usageAccounts"), false);
          assert.equal(await shown("#usageKeys"), true);
          // Accounts opened again, the others still folded: it is near the top
          await reader.inView(p, fold("accounts"));
          await fold("accounts").click();
          await p.waitForTimeout(150);
          assert.equal(await shown("#usageAccounts"), true);
          assert.equal(await p.locator("#usageAccounts .row.stat").count(), 2);
          assert.equal(await shown("#usageAgents"), false);

          // the tokens tile: in and out, as before
          const tile = p.locator("#stats .kpi").first();
          const pick = tile.locator(".kpi-pick");
          const fmt = (n) => p.evaluate((n) => fmtN(n), n);
          const io = USAGE.input + USAGE.output, all = io + USAGE.cache_read;
          assert.equal((await tile.locator("b").textContent()).trim(), await fmt(io));
          assert.equal((await pick.textContent()).trim(), w.tokens);
          assert.equal(await p.locator("#usagePane select").count(), 0, "no native select");
          // the pop-up takes the label's room and the line under it reads as
          // the next tile's does: not the label's small capitals
          const looks = await p.locator("#stats .kpi").evaluateAll((ks) => ks.slice(0, 2).map((k) => {
            const s = k.querySelector("small"), part = s.querySelector("span") || s, cs = getComputedStyle(part);
            // the label's words: in the pop-up, its span
            const label = (k.querySelector(".kpi-pick > span") || k.querySelector(":scope > span")).getBoundingClientRect();
            return { at: Math.round(label.top - k.getBoundingClientRect().top), gap: Math.round(s.getBoundingClientRect().top - label.bottom), case: cs.textTransform, weight: cs.fontWeight, size: cs.fontSize };
          }));
          assert.deepEqual(looks[0], looks[1], "the tokens tile's label and line sit and read as the next tile's");
          // the pop-up is the app's own menu
          await reader.inView(p, pick);
          const vt = await p.locator("#view-usage").evaluate((v) => v.scrollTop);
          await pick.click();
          const menu = p.locator(".proto-menu:visible");
          await menu.waitFor();
          assert.equal((await menu.locator(".pm-head").textContent()).trim(), w.head);
          assert.deepEqual(await menu.locator(".pm-name").allTextContents(), [w.without, w.with]);
          await menu.locator(".pm-item").nth(1).click();
          await p.waitForTimeout(150);
          assert.equal(await p.locator("#view-usage").evaluate((v) => v.scrollTop), vt, "the pick moved the page");
          // with the cache: the tile, its label and line, the rows
          assert.equal((await tile.locator("b").textContent()).trim(), await fmt(all));
          assert.equal((await tile.locator(".kpi-pick").textContent()).trim(), w.withCache);
          assert.equal(await tile.locator("small.parts > span").count(), 3, "in, out and the cache");
          const acct = p.locator('#usageAccounts .row.stat[data-id="acct-a"] .num b');
          assert.equal((await acct.textContent()).trim(), await fmt(4000000 + 1500000 + 400000000));
          // kept across a reload
          await p.close();
          p = await open();
          assert.equal((await p.locator("#stats .kpi b").first().textContent()).trim(), await fmt(all), "the choice is kept");
          // back to without
          const pick2 = p.locator("#stats .kpi .kpi-pick");
          await reader.inView(p, pick2);
          await pick2.click();
          await p.locator(".proto-menu:visible .pm-item").first().click();
          await p.waitForTimeout(150);
          assert.equal((await p.locator("#stats .kpi b").first().textContent()).trim(), await fmt(io));
          assert.equal((await p.locator('#usageAccounts .row.stat[data-id="acct-a"] .num b').textContent()).trim(), await fmt(5500000));
          // nothing in a tile cut or spilling out of the window
          const spill = await p.locator("#stats .kpi").evaluateAll((ks) => ks.filter((k) => k.scrollWidth > k.clientWidth + 1).map((k) => k.innerText.replace(/\s+/g, " ") + " " + k.scrollWidth + "/" + k.clientWidth));
          assert.deepEqual(spill, [], "a tile spills");
          assert.deepEqual(errors, []);
          await p.close();
        });
      }
      for (const width of [1500, 1100, 420]) {
        await t.test(`${lang} ${width}: the Requests card's cache in full`, async () => {
          const errors = [];
          const ctx = await browser.newContext({ viewport: { width, height: 760 }, reducedMotion: "reduce" });
          t.after(() => ctx.close());
          const p = await ctx.newPage();
          p.setDefaultTimeout(5000);
          p.setDefaultNavigationTimeout(60000);
          p.on("pageerror", (e) => errors.push(e.message));
          await p.route("**/*", server(lang));
          await p.goto("http://magpie.test/");
          await goUsage(p);
          await p.locator(":is(#usageTab .opt, .nav-s):visible").nth(1).click();
          await p.locator("#ledKpi .blk").first().waitFor();
          await p.waitForTimeout(200);
          const fit = await p.locator("#ledKpi .blk").first().evaluate((b) => {
            const sub = b.querySelector(".sub");
            const box = b.getBoundingClientRect(), pad = parseFloat(getComputedStyle(b).paddingRight);
            const parts = [...sub.children].map((s) => ({ text: s.textContent, right: s.getBoundingClientRect().right, w: s.scrollWidth, cw: s.getBoundingClientRect().width }));
            return { text: sub.textContent, clipped: sub.scrollWidth > sub.clientWidth + 1, parts: parts.length, out: parts.filter((x) => x.right > box.right - pad + 1).map((x) => x.text) };
          });
          assert.equal(fit.parts, 3, "in, out and the cache: " + fit.text);
          assert.equal(fit.clipped, false, "the line is cut: " + fit.text);
          assert.deepEqual(fit.out, [], "a part runs past the card");
          assert.match(fit.text, new RegExp((await p.evaluate(() => fmtN(87933000))).replace(/[.]/g, "\\.")), "the cache's whole count is there");
          assert.deepEqual(errors, []);
          await p.close();
        });
      }
    }
  });
}
