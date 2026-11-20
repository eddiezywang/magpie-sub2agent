// The intranet supplier views share the Overview's lifetime and date zone.
window.supplierUsage = (() => {
  const names = { tig: "TIG", cib: "CIB ZHT API Key", "workbuddy-enterprise": "WorkBuddy Enterprise", "workbuddy-cib": "WorkBuddy CIB" };
  const channels = { zp: "Zhipu", hs: "Volcengine", tc: "Tencent" };
  const currencies = { zp: "Points", hs: "AFP", tc: "Weighted tokens" };
  const periods = [[1, "Today"], [7, "Last 7 days"], [30, "Last 30 days"]];
  const { compact, exact, whole, day, dateKey, sum, color, plot, heatmap } = supplierCharts;
  const missing = "—";
  const note = (key, vars) => el("p", "su-note", t(key, vars));
  const pointUnit = (unit) => ["points", "maas points", "upstream points", "credits", "积分", "積分"].includes(unit.toLowerCase());
  const points = (n, unit) => n == null ? missing : (pointUnit(unit) ? whole(n) : exact(n)) + " " + t(unit);
  const when = (v) => v ? new Date(v).toLocaleString(intlLang(), { dateStyle: "short", timeStyle: "short" }) : missing;
  const pct = (n) => n == null ? missing : exact(Math.round(n * 100) / 100) + "%";
  const matches = (rule, id) => rule?.endsWith("*") ? id.startsWith(rule.slice(0, -1)) : rule === id;
  const slug = (v) => v.toString().replaceAll(/[^-a-zA-Z0-9]/g, "_");
  let suppliers = [], selected, choices = {};
  let currentView = "quota", activityMode = "daily", cibDays = 30, days = 7, measure = "tokens";
  let channel = "", keyIndex = 0, sourceSide, selection = new Set();
  let stats, state, chartStop, serial = 0, last = 0, running = false, pending;
  let statsRead = 0, keyRead = 0, controller;

  function segmented(label, items, active, onPick, type = "group") {
    const group = el("div", type === "tablist" ? "su-tabs" : "su-segs");
    group.setAttribute("role", type);
    group.setAttribute("aria-label", t(label));
    const isTabs = type === "tablist";
    const buttons = [];
    for (const [value, name] of items) {
      const b = el("button", "su-choice", t(name));
      b.type = "button";
      b.dataset.suFocus = slug(label) + "-" + value;
      b.value = value;
      b.setAttribute(isTabs ? "aria-selected" : "aria-pressed", value === active);
      if (isTabs) {
        b.setAttribute("role", "tab");
        b.setAttribute("aria-controls", "supplierUsagePanel");
        b.id = "supplier-tab-" + value;
        b.tabIndex = value === active ? 0 : -1;
      }
      b.onclick = () => { if (active !== value) onPick(value, b.dataset.suFocus); };
      group.append(b);
      buttons.push(b);
    }
    if (isTabs) group.onkeydown = (e) => {
      const at = buttons.indexOf(e.target);
      if (at < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 :
        (at + buttons.length + (e.key === "ArrowRight" ? 1 : -1)) % buttons.length;
      buttons[next].click();
    };
    return group;
  }

  function kpis(items) {
    const list = el("dl", "su-kpis");
    for (const [label, value, sub] of items) {
      const item = el("div", "su-kpi");
      item.append(el("dt", "", t(label)), el("dd", "", value));
      if (sub) item.append(el("small", "", sub));
      list.append(item);
    }
    return list;
  }

  function appendChart(box, label, rows, lines, unit) {
    const chart = plot(t(label), rows, lines, t(unit), pointUnit(unit));
    chartStop = chart.stop;
    box.append(chart.node);
  }

  function quotaCard({ label, unit, used, limit, percent, start, reset, status, estimate, reference = true, coverage, exhausted = false }) {
    const progress = exhausted ? 100 : percent;
    const card = el("article", "su-window");
    const heading = el("div", "su-window-title");
    heading.append(el("h3", "", t(label)));
    if (status) heading.append(el("span", "su-state", t(status)));
    card.append(heading);
    const amount = el("div", "su-percent");
    amount.append(el("strong", "", pct(progress)));
    if (exhausted) amount.append(el("span", "", t("Quota exhausted")));
    else if (progress != null) amount.append(el("span", "", t(estimate ? "Current gateway estimate" : "Used")));
    card.append(amount);
    const rail = el("div", "su-rail");
    rail.setAttribute("aria-hidden", "true");
    if (progress != null) {
      rail.classList.toggle("su-rail-high", progress > 70);
      const fill = el("i");
      fill.style.width = Math.min(100, Math.max(0, progress)) + "%";
      rail.append(fill);
    }
    card.append(rail);
    const data = el("dl", "su-window-data");
    for (const [label, value] of [[estimate?.rolling ? "Rolling 5-hour estimate" : estimate && !estimate.complete ? "Covered estimate" : "Used",
      points(used, unit)], [reference ? "Reference limit" : "Limit", points(limit, unit)], ["Window start", start || missing], ["Reset time", reset || missing]]) {
      data.append(el("dt", "", t(label)), el("dd", "", value));
    }
    card.append(data);
    if (coverage) card.append(coverage);
    return card;
  }

  function tigQuota(panel) {
    const side = sourceSide || {}, selectedKey = side.keys?.[keyIndex];
    if (channel === "zp" && side.keys?.length) {
      const box = el("label", "su-key-pick", t("API key"));
      const picker = el("select");
      picker.setAttribute("aria-label", t("API key"));
      picker.dataset.suFocus = "supplier-key";
      side.keys.forEach((key, i) => {
        const opt = el("option", "", (key.name || "••• " + key.id) + (side.manyProviders ? " · " + key.provider : ""));
        opt.value = i;
        picker.append(opt);
      });
      picker.value = keyIndex;
      picker.onchange = () => {
        keyIndex = Number(picker.value);
        sourceSide = { ...side, key: null };
        render("supplier-key");
        readTIGKey(serial);
      };
      box.append(picker);
      panel.append(box);
    }
    if (!channel) {
      panel.append(note("TIG channels have not been identified from the saved models."));
      return;
    }
    const plan = side.catalog?.config?.plans?.[channel];
    const windows = side.key?.windows || [];
    const rules = channel === "zp" ? [["fiveHours", "5-hour allowance", "rolling_5h"], ["week", "Weekly allowance", "subscription_week"]] :
      [["", channel === "hs" ? "Monthly allowance" : "Weekly allowance", channel === "hs" ? "month" : "subscription_week"]];
    const cards = el("div", "su-window-grid");
    for (const [period, label, id] of rules) {
      const win = windows.find((w) => w.period === period), estimate = side.key?.usage?.periods?.[period];
      const limit = period === "fiveHours" ? 35000 : plan?.windows?.find((w) => w.id === id)?.limit;
      const used = estimate?.priced || estimate?.complete ? estimate.points : null;
      const percent = estimate?.complete && !estimate.rolling && limit > 0 ? used / limit * 100 : null;
      const status = { observed: "Observed in a 429 response", estimated: "Estimated window", expired: "Observation expired" }[win?.status] ||
        (side.keyError ? "Unable to read window" : selectedKey && side.key == null && channel === "zp" ? "Reading…" : "Window unknown");
      const coverage = estimate && !estimate.complete ? note("Partial ledger or rate coverage · {n} uncovered requests", { n: exact(estimate.uncovered) }) : null;
      cards.append(quotaCard({ label, unit: currencies[channel], used, limit, percent, start: when(win?.start), reset: when(win?.reset),
        status, estimate, coverage, exhausted: win?.status === "observed" }));
    }
    panel.append(cards);
  }

  const retained = (c) => stats?.total?.calls ? compact(c?.tokens ?? 0) : missing;

  function workbuddyQuota(panel) {
    const ids = suppliers.find((x) => x.id === selected)?.providers || [];
    const readings = (quotas || []).filter((q) => ids.includes(q.provider));
    const cards = el("div", "su-window-grid");
    for (const [i, q] of readings.entries()) {
      const alias = t("Account {n}", { n: i + 1 });
      const wins = (q.windows || []).filter((w) => w.limit > 0 && !w.text);
      if (!wins.length) {
        cards.append(quotaCard({ label: alias, unit: "Points", status: q.error ? "Allowance query failed" : "Allowance unavailable", reference: false }));
        continue;
      }
      for (const w of wins) {
        cards.append(quotaCard({ label: wins.length > 1 ? alias + " · " + w.name : alias,
          unit: w.unit === "credits" || !w.unit ? "Points" : w.unit,
          used: w.amount ?? 0, limit: w.limit, percent: w.used, start: when(w.startsAt),
          reset: w.resetText || when(w.resetsAt), status: q.asOf ? "Last available reading" : "Upstream allowance", reference: false }));
      }
    }
    if (readings.length) panel.append(cards);
    else if (selected === "workbuddy-cib") panel.append(note(quotaReadFailed ? "Allowance query failed" : quotas ? "Allowance unavailable" : "Reading…"));
  }

  function usagePane(panel) {
    if (selected === "tig") { tigQuota(panel); return; }
    if (selected.startsWith("workbuddy")) workbuddyQuota(panel);
    if (!stats) { panel.append(note(state || "Reading…")); return; }
    if (selected === "cib") {
      panel.append(kpis([["Today", retained(stats.today)], ["Last 7 days", retained(stats.week)], ["Last 30 days", retained(stats.month)], ["All time", retained(stats.total)]]));
      const chart = el("div", "su-chart-box");
      chart.append(segmented("Daily token usage", periods.slice(1), cibDays, (v, focus) => { cibDays = v; render(focus); }));
      const rows = stats.activity.slice(-cibDays).map((d) => ({ tick: d.date.slice(5), label: d.date, values: [dayTokens(d)] }));
      appendChart(chart, "Daily token usage", rows, true, "Token");
      panel.append(chart);
    } else {
      const local = [["Gateway Token", retained(stats.total)]];
      if (selected === "workbuddy-enterprise") local.push(["MaaS estimate", stats.total.maasCovered ? points(stats.total.maasPoints, "Points") : missing]);
      local.push(["Credits reported per request", stats.total.credited ? points(stats.total.credits, "Points") : missing]);
      panel.append(kpis(local));
      if (stats.total.calls > (stats.total.maasCovered || 0) + (stats.total.credited || 0)) panel.append(note("Some requests have no point reading."));
    }
    panel.append(note(stats.total.calls ? "Gateway token usage recorded in this ledger, including cache tokens." : "No gateway requests on record."));
  }

  function ledgerStart() { return stats?.ledgerFrom ? dateKey(new Date(stats.ledgerFrom)) : ""; }
  function dayTokens(d) { return d.tokens || (ledgerStart() && d.date >= ledgerStart() ? 0 : null); }

  function activityPane(panel) {
    const k = stats.peak;
    panel.append(kpis([["Retained Token", retained(stats.total)], ["Daily peak", k ? compact(k.tokens) : missing, k?.date],
      ["Current streak", stats.total.calls ? t("{n} days", { n: exact(stats.streak) }) : missing],
      ["Longest streak", stats.total.calls ? t("{n} days", { n: exact(stats.longest) }) : missing]]));
    const box = el("div", "su-chart-box");
    box.append(segmented("Activity", [["daily", "Daily"], ["weekly", "Weekly"], ["cumulative", "Cumulative"]], activityMode,
      (v, focus) => { activityMode = v; render(focus); }));
    if (activityMode === "daily") box.append(...heatmap(stats.activity, ledgerStart()));
    else {
      const rows = [];
      let runningTotal = 0;
      for (let i = 0; i < stats.activity.length; i += 7) {
        const week = stats.activity.slice(i, i + 7), values = week.map(dayTokens), date = week[0].date;
        const n = values.some((x) => x !== null) ? sum(values) : null;
        runningTotal += n || 0;
        rows.push({ tick: date.slice(5), label: date, values: [n == null ? null : activityMode === "cumulative" ? runningTotal : n] });
      }
      appendChart(box, activityMode === "weekly" ? "Weekly Token trend" : "Cumulative Token trend", rows, true, "Token");
    }
    panel.append(box, note("Activity uses the current gateway ledger in your time zone."));
  }

  const seriesFields = { tokens: ["tokens", "Token"], tig: ["tigAmount", ""], maas: ["maasPoints", "MaaS points"], credits: ["credits", "Upstream points"] };
  const measureOptions = () => {
    if (selected === "tig" && channel) return [["tokens", "Token"], ["tig", currencies[channel]]];
    if (selected === "workbuddy-enterprise") return [["tokens", "Token"], ["maas", "MaaS points"], ["credits", "Upstream points"]];
    if (selected === "workbuddy-cib") return [["tokens", "Token"], ["credits", "Upstream points"]];
    return [["tokens", "Token"]];
  };
  const counted = (s, field) => ({ tokens: s?.calls, tig: s?.tigCovered, credits: s?.credited, maas: s?.maasCovered })[field];

  function table(name, columns, rows, focus) {
    const detail = el("details", "su-detail");
    detail.dataset.suFocus = focus;
    detail.append(el("summary", "", t(name)));
    if (!rows.length) { detail.append(note("No matching rates available")); return detail; }
    const scroll = el("div", "su-table-scroll"), grid = el("table");
    const header = el("tr");
    for (const col of columns) {
      const cell = el("th", "", t(col)); cell.scope = "col"; header.append(cell);
    }
    const head = el("thead"), body = el("tbody");
    head.append(header);
    for (const row of rows) {
      const tr = el("tr");
      row.forEach((v, i) => {
        const cell = el(i ? "td" : "th", "", v ?? missing);
        if (!i) cell.scope = "row";
        tr.append(cell);
      });
      body.append(tr);
    }
    grid.append(head, body); scroll.append(grid); detail.append(scroll);
    return detail;
  }

  function ratesTable() {
    if (selected === "cib" || selected === "tig" && !channel) return null;
    const ids = suppliers.find((x) => x.id === selected)?.providers || [];
    const known = sourceSide?.rates?.rates || sourceSide?.catalog?.rates || [];
    const filtered = known.filter((r) => (selected !== "tig" || r.deployment === channel) &&
      (!r.provider || ids.some((id) => matches(r.provider, id))));
    const distinct = [...new Map(filtered.map((r) => [(r.model || "") + "|" + (r.service_tier || "") + "|" + (r.providerLabel || ""), r])).values()];
    const shownModel = (r) => [r.model, r.service_tier, r.providerLabel].filter(Boolean).join(" · ");
    const source = (r) => [r.source ? t(r.source) : "", r.valid_until && !r.valid_until.startsWith("0001") ? when(r.valid_until) : ""].filter(Boolean).join(" · ") || missing;
    if (selected === "tig" && channel === "zp") {
      const detail = table("Model coefficients", ["Model", "Input", "Cache read", "Output", "Source"], distinct.map((r) =>
        [shownModel(r), r.credit_rates?.input, r.credit_rates?.cache_read, r.credit_rates?.output, source(r)]), "supplier-rates");
      detail.append(note("Points per 10,000 Token. Cache writes follow the input rate."));
      const peak = sourceSide?.catalog?.peak;
      if (peak) {
        const clock = (h) => String(h).padStart(2, "0") + ":00";
        const weekday = (d) => new Date(Date.UTC(2024, 0, 7 + d, 12)).toLocaleDateString(intlLang(), { weekday: "short", timeZone: "UTC" });
        detail.append(note("Peak {days} {start}–{end} (UTC{offset}) ×{peak} · remaining hours ×{off}", {
          days: peak.weekdays.map(weekday).join(", "), start: clock(peak.start_hour), end: clock(peak.end_hour),
          offset: (peak.utc_offset_minutes >= 0 ? "+" : "") + peak.utc_offset_minutes / 60, peak: peak.peak_factor, off: peak.off_peak_factor,
        }));
      }
      return detail;
    }
    const detail = table("Model coefficients", ["Model", "Coefficient", "Source"], distinct.map((r) =>
      [shownModel(r), r.coefficient == null ? missing : exact(r.coefficient) + " ×", source(r)]), "supplier-rates");
    detail.append(note({
      "workbuddy-enterprise": "MaaS points per Token. Upstream-reported credits take precedence.",
      "workbuddy-cib": "Reference multipliers supplied with the plugin.",
      tig: channel === "hs" ? "AFP per 10,000 Token" : "Reference weighted tokens per Token",
    }[selected]));
    return detail;
  }

  function detailsPane(panel) {
    const head = el("div", "su-detail-head");
    head.append(segmented("Usage detail range", periods, days, (v, focus) => {
      days = v; stats = null; state = null; render(focus); readStats(serial);
    }));
    if (stats) head.append(el("span", "su-dates", stats.from + " – " + stats.to));
    const measures = measureOptions();
    if (measures.length > 1) head.append(segmented("Usage unit", measures, measure, (v, focus) => {
      measure = v; selection.clear(); render(focus);
    }));
    panel.append(head);
    if (!stats) { panel.append(note(state || "Reading…")); return; }
    const [field, label] = seriesFields[measure], unit = label || currencies[channel];
    const s = stats.selected || {}, n = counted(s, measure) ? s[field] || 0 : null;
    const amount = pointUnit(unit) ? whole : compact;
    const meta = [["Period total", n == null ? missing : amount(n), t(unit)],
      ["Daily average", n == null ? missing : amount(n / days), t(unit)]];
    if (measure === "tokens") meta.push(["Cache hit rate", pct(s.knownPrompt > 0 ? 100 * s.cacheRead / s.knownPrompt : null)]);
    if (selected === "tig" && channel === "zp" && s.tigTokens > 0)
      meta.push(["Off-peak share", pct(100 * (s.offPeakTokens || 0) / s.tigTokens), t("Covered Token")]);
    panel.append(kpis(meta));
    const models = stats.models.filter((model) => measure === "tokens" || counted(model, measure));
    const active = (m) => !selection.has(m.id);
    const value = (m) => m?.[field] || 0;
    const modelLabel = (m) => m.id || t("Other models");
    const legend = el("div", "su-legend"), box = el("div", "su-chart-box");
    legend.append(el("span", "su-selected-total", t("Visible model total") + " " + (n == null ? missing : amount(sum(models.filter(active).map(value))))));
    models.forEach((model, i) => {
      const b = el("button", "su-model");
      b.dataset.suFocus = "model-" + i;
      b.type = "button"; b.setAttribute("aria-pressed", active(model)); b.title = modelLabel(model);
      const dot = el("i");
      dot.style.setProperty("--su-model", color(i));
      b.append(dot, el("span", "", modelLabel(model)), el("b", "", amount(value(model))));
      b.onclick = () => { if (active(model)) selection.add(model.id); else selection.delete(model.id); render(b.dataset.suFocus); };
      legend.append(b);
    });
    box.append(legend);
    const names = models.map(modelLabel);
    const asOf = new Date(stats.asOf || Date.now());
    const rows = stats.timeline.map(({ time, models: bars }) => {
      const at = new Date(time);
      const label = days === 1 ? at.toLocaleTimeString(intlLang(), { hour: "2-digit", minute: "2-digit" }) : dateKey(at);
      const covered = measure === "tokens" ? bars.length || stats.ledgerFrom && at <= asOf && dateKey(at) >= ledgerStart() :
        bars.some((m) => counted(m, measure));
      const seen = new Map(bars.map((m) => [m.id, m]));
      const values = models.map((m) => active(m) ? value(seen.get(m.id)) : 0);
      return { tick: days === 1 ? label : label.slice(5), label, names,
        values: covered ? values.length ? values : [0] : [null] };
    });
    appendChart(box, "Usage by model", rows, false, unit);
    panel.append(box);
    if (models.length) panel.append(table("Model usage", ["Model", unit], models.map((m) => [modelLabel(m), amount(value(m))]), "supplier-model-usage"));
    if (selected === "tig" && channel && s.tigUnpriced) panel.append(note("{n} attempts could not be priced", { n: exact(s.tigUnpriced) }));
    if (ledgerStart() && stats.from < ledgerStart()) panel.append(note("The available ledger starts on {date}.", { date: ledgerStart() }));
    if (!stats.total.calls) panel.append(note("No gateway requests on record."));
    const rates = ratesTable();
    if (rates) panel.append(rates);
  }

  const root = () => document.getElementById("supplierUsage");
  const current = () => intranet && view === "usage" && usageTab === "usage" && !!root();
  const usable = (n) => running && n === serial && current();
  function render(focus) {
    const box = root();
    if (!box || !running) return;
    chartStop?.(); chartStop = null;
    const open = new Set([...box.querySelectorAll("details[open]")].map((node) => node.dataset.suFocus));
    focus ||= box.contains(document.activeElement) && document.activeElement.dataset.suFocus;
    box.hidden = !suppliers.length;
    box.replaceChildren();
    if (box.hidden) return;
    box.append(segmented("Usage suppliers", suppliers.map(({ id }) => [id, names[id]]), selected, pickSupplier, "tablist"));
    const panel = el("div", "su-panel");
    panel.id = "supplierUsagePanel";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", "supplier-tab-" + selected);
    const header = el("div", "su-header");
    header.append(el("h2", "", t(names[selected])));
    const enabled = sourceSide?.channels || [];
    if (selected === "tig" && enabled.length) header.append(segmented("TIG channels", enabled.map((v) => [v, channels[v]]), channel, (v, focus) => {
      channel = v; measure = "tokens"; selection.clear(); stats = null; render(focus);
      const n = nextRead(); readStats(n); if (v === "zp") readTIGKey(n);
    }));
    panel.append(header, segmented("Usage views", [["quota", "Usage"], ["activity", "Activity"], ["details", "Usage details"]], currentView,
      (v, focus) => { currentView = v; render(focus); }));
    if (state === "Supplier configuration query failed") panel.append(note(state));
    if (currentView === "quota") usagePane(panel);
    else if (currentView === "details") detailsPane(panel);
    else if (stats) activityPane(panel);
    else panel.append(note(state || "Reading…"));
    box.append(panel);
    for (const node of box.querySelectorAll("[data-su-focus]")) {
      if (node.tagName === "DETAILS" && open.has(node.dataset.suFocus)) node.open = true;
      if (focus && node.dataset.suFocus === focus) node.focus({ preventScroll: true });
    }
  }

  async function readStats(n) {
    const turn = ++statsRead;
    const suffix = new URLSearchParams({ days });
    const zone = usageZone();
    if (zone) suffix.set("tz", zone);
    if (selected === "tig" && channel) suffix.set("channel", channel);
    try {
      const data = await get("usage/suppliers/" + selected + "?" + suffix);
      if (!usable(n) || turn !== statsRead) return;
      if (!data || !Array.isArray(data.activity)) throw Error();
      stats = data; state = null;
    } catch {
      if (!usable(n) || turn !== statsRead) return;
      stats = null; state = "Gateway usage query failed";
    }
    render();
  }

  async function readTIGKey(n) {
    const key = sourceSide?.keys?.[keyIndex];
    if (!key) return;
    const turn = ++keyRead;
    try {
      const p = new URLSearchParams({ provider: key.provider, key: key.id });
      const data = await get("usage/suppliers/tig/key?" + p);
      if (!usable(n) || turn !== keyRead || key !== sourceSide?.keys?.[keyIndex]) return;
      if (!Array.isArray(data?.windows)) throw Error();
      sourceSide = { ...sourceSide, key: data, keyError: false };
    } catch {
      if (!usable(n) || turn !== keyRead || key !== sourceSide?.keys?.[keyIndex]) return;
      sourceSide = { ...sourceSide, key: null, keyError: true };
    }
    render();
  }

  async function readSide(n) {
    if (selected === "tig") {
      const accounting = get("accounting/tig-plans").catch(() => undefined)
        .then((catalog) => {
          if (!usable(n)) return;
          sourceSide = { ...sourceSide, catalog };
          render();
        });
      const [p, keys] = await Promise.allSettled([get("providers"), get("usage/suppliers/tig/keys")]);
      if (!usable(n)) return;
      const ids = suppliers.find((s) => s.id === selected)?.providers || [];
      const models = (p.value?.providers || []).filter((s) => ids.includes(s.id)).flatMap((s) => s.models || []);
      const seen = new Set(models.map((m) => /-(zp|hs|tc)(?:-openai)?$/i.exec(typeof m === "string" ? m : m.id)?.[1].toLowerCase()));
      const list = (Array.isArray(keys.value) ? keys.value : []).flatMap((x) => x.keys.map((k) => ({ ...k, provider: x.provider })));
      if (list.some((k) => k.windows?.some((w) => w.until))) seen.add("zp");
      if (p.status === "rejected") sourceSide?.channels?.forEach((id) => seen.add(id));
      const enabled = Object.keys(channels).filter((id) => seen.has(id));
      const prior = sourceSide?.keys?.[keyIndex];
      const matchedKey = list.findIndex((k) => prior && k.id === prior.id && k.provider === prior.provider);
      keyIndex = Math.max(0, matchedKey);
      sourceSide = { ...sourceSide, channels: enabled, keys: list, manyProviders: ids.length > 1,
        key: matchedKey < 0 ? null : sourceSide?.key, keyError: keys.status === "rejected" };
      const next = enabled.includes(channel) ? channel : enabled[0] || "";
      if (next !== channel) { channel = next; measure = "tokens"; selection.clear(); stats = null; }
      render();
      await Promise.allSettled([readStats(n), channel === "zp" && readTIGKey(n), accounting]);
    } else {
      await readStats(n);
      if (!usable(n) || !selected.startsWith("workbuddy")) return;
      try {
        const rates = await get("usage/suppliers/" + selected + "/rates");
        if (usable(n)) { sourceSide = { rates }; if (currentView === "details") render(); }
      } catch {}
    }
  }

  function pickSupplier(id, focus) {
    if (selected) choices[selected] = { channel, measure, side: sourceSide, keyIndex };
    selected = id;
    ({ channel = "", measure = "tokens", side: sourceSide, keyIndex = 0 } = choices[id] || {});
    stats = null; state = null; selection.clear(); render(focus);
    const n = nextRead();
    if (selected) readSide(n);
  }

  function nextRead() {
    controller?.abort();
    controller = new AbortController();
    return ++serial;
  }
  function get(path) { return api(path, undefined, undefined, controller?.signal); }

  async function refresh(force = false) {
    if (!current()) return;
    running = true;
    if (!force && (pending || Date.now() - last < 60_000)) return;
    const n = nextRead();
    pending = n; last = Date.now();
    try {
      const data = await get("usage/suppliers");
      if (!usable(n)) return;
      if (!Array.isArray(data)) throw Error();
      const prior = suppliers;
      suppliers = data.filter((s) => Object.hasOwn(names, s.id));
      if (!suppliers.some((s) => s.id === selected)) {
        pickSupplier(suppliers[0]?.id);
        renderQuotas(true);
      }
      else {
        if (JSON.stringify(prior) !== JSON.stringify(suppliers)) { renderQuotas(true); render(); }
        await readSide(n);
      }
    } catch {
      if (!usable(n)) return;
      stats = null; state = "Supplier configuration query failed";
      render();
    } finally {
      if (pending === n) pending = null;
    }
  }

  function stop() {
    running = false; pending = null; last = 0; serial++;
    controller?.abort();
    chartStop?.(); chartStop = null;
  }
  return {
    refresh, stop,
    hasProvider: (id) => intranet && suppliers.some((s) => s.providers.includes(id)),
    quotaChanged: () => { if (running && current() && currentView === "quota" && selected?.startsWith("workbuddy")) render(); },
  };
})();
