let zhtTokensAt = 0, zhtTokensZone, zhtTokensRequest = 0;
let zhtTokenDays = 30;
const zhtTokenUnits = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];

function formatZHTTokens(n) {
  const unit = zhtTokenUnits.find(([size]) => n >= size);
  return unit ? (n / unit[0]).toLocaleString(undefined, { maximumFractionDigits: 2 }) + unit[1] : n.toLocaleString();
}

async function loadZHTTokens(force = false) {
  if (!intranet) return;
  const box = $("#zhtTokenUsage");
  const zone = usageZoneQ();
  if (!force && zhtTokensZone === zone && Date.now() - zhtTokensAt < 60_000) return;
  zhtTokensZone = zone;
  zhtTokensAt = Date.now();
  const request = ++zhtTokensRequest;
  box.hidden = false;
  if (!box.firstChild) box.append(el("h2", "", "CIB-智汇通-APIKEY"));
  try {
    const data = await api("usage/cib-zht" + (zone ? "?" + zone.slice(1) : ""));
    if (request === zhtTokensRequest) renderZHTTokens(box, data);
  } catch {
    if (request === zhtTokensRequest) {
      box.replaceChildren(el("h2", "", "CIB-智汇通-APIKEY"), el("p", "usage-note", t("Token usage unavailable")));
    }
  }
}

function renderZHTTokens(box, data) {
  const head = el("div", "zht-token-head");
  head.append(el("h2", "", "CIB-智汇通-APIKEY"));
  const controls = el("div", "segs");
  head.append(controls);
  const summary = el("dl", "zht-token-summary");
  for (const [key, label] of [["today", "Today"], ["week", "Last 7 days"], ["month", "Last 30 days"], ["total", "All time"]]) {
    const item = el("div", "");
    const value = el("dd", "", formatZHTTokens(data[key]));
    value.title = data[key].toLocaleString() + " Token";
    item.append(el("dt", "", t(label)), value);
    summary.append(item);
  }
  const chart = el("div", "zht-token-chart");
  const draw = () => {
    for (const button of controls.children) {
      const active = Number(button.value) === zhtTokenDays;
      button.classList.toggle("on", active);
      button.setAttribute("aria-pressed", String(active));
    }
    drawZHTTokenChart(chart, data.series.slice(-zhtTokenDays));
  };
  for (const [days, label] of [[7, "Last 7 days"], [30, "Last 30 days"]]) {
    const button = el("button", "opt", t(label));
    button.type = "button";
    button.value = days;
    button.onclick = () => { zhtTokenDays = days; draw(); };
    controls.append(button);
  }
  draw();
  box.replaceChildren(head, summary, chart, el("p", "usage-note", t("Gateway token usage recorded in this ledger, including cache tokens.")));
}

function drawZHTTokenChart(chart, series) {
  function svg(tag, attrs) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
  }
  const peak = Math.max(...series.map(day => day.tokens));
  const max = Math.max(1, peak);
  const width = 600, height = 112, pad = 4;
  const y = value => height - pad - value / max * (height - 2 * pad);
  const x = i => pad + i / (series.length - 1) * (width - 2 * pad);
  const graph = svg("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", role: "img", "aria-label": t("Daily token usage") });
  const axis = el("div", "zht-token-axis");
  for (let i = 0; i <= 2; i++) {
    const value = Math.round(max * (1 - i / 2));
    axis.append(el("span", "", formatZHTTokens(peak ? value : 0)));
    const level = y(max * (1 - i / 2));
    graph.append(svg("line", { x1: pad, x2: width - pad, y1: level, y2: level, class: "zht-token-grid" }));
  }
  graph.append(svg("polyline", { points: series.map((day, i) => `${x(i)},${y(day.tokens)}`).join(" "), class: "zht-token-line" }));
  for (const [i, day] of series.entries()) {
    const point = svg("rect", { x: x(i) - 3, y: y(day.tokens) - 3, width: 6, height: 6, class: "zht-token-point" });
    const title = svg("title", {});
    title.textContent = `${day.date} · ${day.tokens.toLocaleString()} Token`;
    point.append(title);
    graph.append(point);
  }
  const dates = el("div", "zht-token-dates");
  for (const i of [0, Math.floor(series.length / 2), series.length - 1]) dates.append(el("span", "", series[i].date.slice(5)));
  chart.replaceChildren(axis, graph, dates);
}
