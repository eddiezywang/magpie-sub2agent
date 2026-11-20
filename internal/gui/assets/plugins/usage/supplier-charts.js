// Pixel charts for the current gateway ledger. Missing observations stay
// absent from plots, while measured zeroes remain on the baseline.
const supplierCharts = (() => {
  const ns = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs, value) => {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (value != null) node.textContent = value;
    return node;
  };
  const exact = (n) => new Intl.NumberFormat(intlLang(), { maximumFractionDigits: 4 }).format(n);
  const whole = (n) => new Intl.NumberFormat(intlLang(), { maximumFractionDigits: 0 }).format(n);
  const compact = (n) => {
    if (n == null) return "—";
    for (const [base, mark] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
      if (Math.abs(n) >= base) return new Intl.NumberFormat(intlLang(), { maximumFractionDigits: 2 }).format(n / base) + mark;
    }
    return exact(n);
  };
  const sum = (a) => a.reduce((total, n) => total + (n || 0), 0);
  const dateKey = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
  const color = (i) => "var(--su-series-" + (i % 8) + ")";
  const unitDate = (date, opts) => new Intl.DateTimeFormat(intlLang(), opts).format(date);
  const day = (date) => new Date(date + "T00:00:00");

  function plot(label, rows, lines, unit, wholePoints = false) {
    const canvas = svg("svg", { class: "su-chart", role: "img", "aria-label": label });
    const draw = () => {
      const w = canvas.clientWidth;
      if (!w) return;
      const h = canvas.clientHeight, left = 48, right = w - 10, top = 12, base = h - 25;
      const slots = (right - left) / Math.max(1, rows.length);
      const max = Math.max(0, ...rows.map((row) => sum(row.values)));
      const power = 10 ** Math.floor(Math.log10((max || 4) / 4));
      const gridStep = [1, 2, 2.5, 5, 10].find((n) => n * power >= max / 4) * power;
      const step = wholePoints ? Math.ceil(gridStep) : gridStep;
      const valueText = wholePoints ? whole : exact;
      const y = (n) => base - (base - top) * n / (4 * step);
      const x = (i) => left + slots * (i + .5);
      canvas.setAttribute("viewBox", `0 0 ${w} ${h}`);
      canvas.replaceChildren();
      for (let i = 0; i <= 4; i++) {
        const value = i * step, at = y(value);
        canvas.append(svg("line", { x1: left, x2: right, y1: at, y2: at, class: "su-gridline" }),
          svg("text", { x: left - 8, y: at, "text-anchor": "end", "dominant-baseline": "middle" }, wholePoints ? whole(value) : compact(value)));
      }
      const interval = Math.ceil(rows.length / Math.max(2, Math.floor((right - left) / 54)));
      let points = [];
      const drawLine = () => {
        if (points.length > 1) canvas.append(svg("polyline", { points: points.join(" "), class: "su-trend" }));
        points = [];
      };
      for (const [i, row] of rows.entries()) {
        if (i === rows.length - 1 || i % interval === 0 && i + interval / 2 < rows.length - 1)
          canvas.append(svg("text", { x: Math.max(left, Math.min(x(i), right - 13)), y: h - 10, "text-anchor": "middle" }, row.tick));
        if (row.values.every((n) => n == null)) { drawLine(); continue; }
        const total = sum(row.values);
        if (lines) {
          points.push(x(i) + "," + y(total));
          canvas.append(svg("rect", { x: x(i) - 2, y: y(total) - 2, width: 4, height: 4, class: "su-pixel" }));
        } else {
          let bottom = 0;
          const width = Math.min(40, slots * .7);
          for (const [j, n] of row.values.entries()) {
            if (!n) continue;
            const rect = svg("rect", { x: x(i) - width / 2, y: y(bottom + n),
              width, height: y(bottom) - y(bottom + n), fill: color(j) });
            if (row.names?.[j]) rect.append(svg("title", {}, row.names[j] + " · " + valueText(n) + " " + unit));
            canvas.append(rect);
            bottom += n;
          }
        }
        const hit = svg("rect", { x: x(i) - slots / 2, y: top, width: slots, height: base - top + 4, fill: "transparent", class: "su-chart-hit" });
        hit.append(svg("title", {}, row.label + " · " + valueText(total) + " " + unit));
        canvas.append(hit);
      }
      drawLine();
    };
    // The widget owns one chart at a time and disconnects it on every render.
    const size = new ResizeObserver(draw);
    size.observe(canvas);
    return { node: canvas, stop: () => size.disconnect() };
  }

  function heatmap(days, first) {
    const scroll = el("div", "su-heat-scroll");
    const body = el("div", "su-heatmap");
    body.setAttribute("role", "img");
    body.setAttribute("aria-label", t("Daily usage over the last 53 weeks"));
    const width = Math.max(1, Math.ceil(days.length / 7));
    body.style.setProperty("--su-weeks", width);
    const month = el("div", "su-heat-months");
    month.style.setProperty("--su-weeks", width);
    const max = Math.max(1, ...days.map((d) => d.tokens));
    let monthAt = -4;
    for (const [i, d] of days.entries()) {
      const date = day(d.date), week = Math.floor(i / 7);
      if ((i === 0 || date.getDate() === 1) && week >= monthAt + 3) {
        const caption = el("span", "", unitDate(date, { month: "short" }));
        caption.style.gridColumn = week + 1;
        month.append(caption);
        monthAt = week;
      }
      const cell = el("span", "su-heat-cell");
      cell.dataset.level = d.tokens ? Math.max(1, Math.ceil(4 * Math.sqrt(d.tokens / max))) : first && d.date >= first ? 0 : "unknown";
      cell.title = d.date + " · " + (cell.dataset.level === "unknown" ? t("Outside retained history") : exact(d.tokens) + " Token");
      body.append(cell);
    }
    scroll.append(month, body);
    const key = el("div", "su-heat-key");
    key.append(el("span", "", t("Outside retained history")), Object.assign(el("i", "su-heat-cell"), { title: t("Outside retained history") }));
    key.lastElementChild.dataset.level = "unknown";
    for (let i = 0; i <= 4; i++) {
      const cell = el("i", "su-heat-cell");
      cell.dataset.level = i;
      key.append(cell);
    }
    key.append(el("span", "", t("More")));
    return [scroll, key];
  }

  return { plot, heatmap, exact, whole, compact, sum, color, dateKey, day };
})();
