// Run with Node's test runner and Playwright on the module path; see README.md.
// A base URL typed in a custom provider's editor is saved as typed and opens
// as typed, for each API (JNDliuliuM on X: 点击保存之后再重新打开看，还是会被
// 添加上/v1beta). The Save sends the URL as typed, and the editor opened
// again shows what the saved provider has. Chromium and WebKit.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");

const assets = path.resolve(__dirname, "../assets");

function serve(posts, providers, { lang = "en", intranet = false, detect } = {}) {
  const state = { agents: [], profiles: [], settings: { lang, theme: "light" } };
  return async (route) => {
    const url = new URL(route.request().url());
    const json = (data) => route.fulfill({ json: data });
    if (url.pathname === "/boot.js") return route.fulfill({ contentType: "text/javascript", body: `window.bootPrefs = {lang:${JSON.stringify(lang)},theme:"light",web:true,intranet:${intranet}};` });
    if (url.pathname === "/wails/runtime.js") return route.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
    if (url.pathname === "/api/state") return json(state);
    if (url.pathname === "/api/providers") return json({ providers, presets: [], excluded: [], gateway: { running: true, window: true } });
    if (url.pathname === "/api/groups") return json({ groups: [] });
    if (url.pathname === "/api/provider/detect" && detect) return json(detect(route.request().postDataJSON()));
    if (url.pathname === "/api/provider/save") {
      const body = route.request().postDataJSON();
      posts.push(body);
      // the server keeps what it is sent
      const at = providers.findIndex((p) => p.id === body.id);
      if (at >= 0) {
        const models = providers[at].models.map((m) => ({ ...m, on: body.models.includes(m.id) }));
        providers[at] = { ...providers[at], models, chat: body.chat || "", responses: body.responses || "",
          anthropic: body.anthropic || "", gemini: body.gemini || "", baseAPI: body.baseAPI };
      }
      return json({ providers, presets: [], excluded: [], gateway: { running: true, window: true } });
    }
    if (url.pathname.startsWith("/api/")) return json({});
    const file = path.join(assets, url.pathname === "/" ? "index.html" : url.pathname);
    await route.fulfill({ body: await fs.readFile(file), contentType: { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)] });
  };
}

const CASES = [
  { api: "gemini", field: "gemini", typed: "https://relay.example.com" },
  { api: "gemini", field: "gemini", typed: "https://relay.example.com/v1" },
  { api: "openai", field: "chat", typed: "https://relay.example.com" },
  { api: "openai", field: "chat", typed: "https://relay.example.com/api" },
  { api: "responses", field: "responses", typed: "https://relay.example.com" },
  { api: "anthropic", field: "anthropic", typed: "https://relay.example.com/claude" },
];

for (const engine of (process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"])) {
  test(`${engine}: Sub2Agent saves model picks without rechecking a saved endpoint`, async (t) => {
    const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chromium" }));
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1050, height: 950 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(6000);
    const posts = [], probes = [], errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const base = "http://relay.example.test/public";
    const changed = "http://new-relay.example.test/public";
    const picks = ["glm-5.3-hs[1m]", "glm-5.3-flash-zp"];
    const providers = [{
      id: "relay", name: "TIG 测试网关", icon: "generic", anthropic: base, baseAPI: "anthropic",
      models: picks.map((id, i) => ({ id, name: id, on: i === 0 })),
      agents: [], fallback: [], headers: {}, ready: true,
      key: { set: true, masked: "sk-…1234" }, keyList: [],
    }];
    let healthy = false;
    await page.route("**/*", serve(posts, providers, {
      lang: "zh", intranet: true,
      detect: (body) => {
        probes.push(body.base);
        return { results: [{ protocol: "anthropic", ok: healthy, base: body.base, status: healthy ? 200 : 429 }] };
      },
    }));
    await page.goto("http://magpie.test/?view=providers");
    const ed = page.locator(".editor");
    const open = () => page.locator('#providers .row[data-id="relay"]').click();
    const save = ed.locator(":scope > .bar").getByRole("button", { name: "保存", exact: true });
    await open();
    await ed.locator(".mchips-rest").click();
    await ed.locator(".mchip", { hasText: picks[1] }).click();
    await ed.locator(".mchip", { hasText: picks[0] }).click();
    const first = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/provider/save", { timeout: 5000 });
    await save.click();
    assert.ok((await first).ok());
    assert.deepEqual(probes, []);
    assert.equal(posts[0].anthropic, base);
    assert.deepEqual(posts[0].models, [picks[1]]);
    await ed.waitFor({ state: "detached" });
    await open();
    await ed.locator(".mchip.on", { hasText: picks[1] }).waitFor();
    if (process.env.ARTIFACT_DIR) {
      await fs.mkdir(process.env.ARTIFACT_DIR, { recursive: true });
      await ed.screenshot({ animations: "disabled", path: path.join(process.env.ARTIFACT_DIR, `${engine}-provider-models-saved.png`) });
    }
    await ed.locator(".base-url").fill(changed);
    await save.click();
    await page.getByText(/无法识别可用协议/).waitFor();
    assert.deepEqual(probes, [changed]);
    assert.equal(posts.length, 1);
    healthy = true;
    const second = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/provider/save");
    await save.click();
    assert.ok((await second).ok());
    assert.equal(posts[1].anthropic, changed);
    assert.deepEqual(errors, []);
  });

  test(`${engine}: a typed base URL is saved and reopened as typed`, async (t) => {
    const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chromium" }));
    const page = await (await browser.newContext({ viewport: { width: 900, height: 760 }, reducedMotion: "reduce" })).newPage();
    t.after(() => browser.close());
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(60000);
    const errors = [], posts = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const models = [{ id: "m", name: "m", on: true }];
    const providers = CASES.map((c, i) => ({
      id: "p" + i, name: "P" + i, icon: "generic", chat: "", responses: "", anthropic: "", gemini: "",
      baseAPI: c.api === "openai" ? "" : c.api, models, agents: [], fallback: [], headers: {}, key: { set: true, masked: "sk-…1234" }, keyList: [], ready: true,
      [c.field]: "https://old.example.com/x",
    }));
    await page.route("**/*", serve(posts, providers));
    await page.goto("http://magpie.test/?view=providers");
    const ed = page.locator(".editor");
    const open = async (id) => {
      if (await ed.count()) {
        await ed.locator(":scope > .bar").getByRole("button", { name: "Cancel", exact: true }).click();
        await ed.waitFor({ state: "detached" });
      }
      await page.locator(`#providers .row[data-id="${id}"]`).click();
      await ed.locator(".base-url").waitFor();
    };
    for (const [i, c] of CASES.entries()) {
      await open("p" + i);
      await ed.locator(".base-url").fill(c.typed);
      const n = posts.length;
      await ed.locator(":scope > .bar").getByRole("button", { name: "Save", exact: true }).click();
      for (let k = 0; k < 60 && posts.length === n; k++) await page.waitForTimeout(50);
      assert.equal(posts.length, n + 1, "saved " + c.typed);
      assert.equal(posts[n][c.field], c.typed, `${c.api} sent as typed`);
      await ed.waitFor({ state: "detached" });
      await open("p" + i);
      assert.equal(await ed.locator(".base-url").inputValue(), c.typed, `${c.api} reopens as typed`);
    }
    assert.deepEqual(errors, []);
  });
}
