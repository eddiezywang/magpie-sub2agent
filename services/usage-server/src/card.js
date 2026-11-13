'use strict';

// Receipt card: an SVG port of magpie-community/plugins day-card's canvas
// slip (MIT, Copyright (c) 2026 magpie-community contributors), whose design
// is in turn inspired by nowdex.app. See page/app.js slip()/draw() and
// page/view.js card() in that repository.
//
// The geometry, typography and spacing below follow that slip line for line:
//   PW=440 paper, PAD=30 margin, TOOTH=5 torn FOOT only (the top is square),
//   JetBrains Mono 400/700/800 with 12.5px rows, 30px title, 52px total,
//   dashed [5,4] rules inset 11, labels left / values right, 76px backdrop
//   padding and a soft paper shadow. Canvas measureText becomes a monospace
//   width estimate (0.6em per Latin glyph, 1em per CJK glyph); the same
//   estimate drives fit()'s ellipsis, sized()'s shrink and spaced()'s gaps.
//
// Logos: the original draws each agent/model's bundled brand mark; when the
// host has none it falls back to a filled dot of radius size*0.22. Our data
// has no logos, so every row uses that same fallback dot.

const fs = require('node:fs');
const path = require('node:path');
const { iconMarkup } = require('./icons');
const { streak, average, versus, hitRate, tokensOf } = require('./magpie-day');

const INK = '#1f1d20';
const MUTED = '#76736e';
const PAPER = '#f7f4ed';
const DASH = '#a8a49c';
const MONO = "'JetBrains Mono','Noto Sans CJK SC','Microsoft YaHei',monospace";
const CJK = "'Noto Sans CJK SC','Microsoft YaHei',sans-serif";
const MONO_ADVANCE = 0.6; // JetBrains Mono: 600 units / 1000 em

const PW = 440;
const PAD = 30;
const TOOTH = 5;
const L = PAD;
const R = PW - PAD;
const INNER = R - L;
const BACKDROP_PAD = 76; // day-card B.norm() default pad
const SCALE = 2; // crisper PNG, like the canvas's devicePixelRatio 2–3

const ASSETS = path.resolve(__dirname, '..', 'assets');
let lakeDataURL = null;
try {
  const jpg = fs.readFileSync(path.join(ASSETS, 'lake.jpg'));
  lakeDataURL = `data:image/jpeg;base64,${jpg.toString('base64')}`;
} catch {
  lakeDataURL = null; // teal pattern stands in
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const cjkRe = /[⺀-鿿　-〿＀-￯]/;
const isCJK = (ch) => cjkRe.test(ch);

// The original's measureText: monospace Latin, full-width CJK.
function measure(s, px) {
  let w = 0;
  for (const ch of String(s)) w += px * (isCJK(ch) ? 1 : MONO_ADVANCE);
  return w;
}

// fit(ctx, s, width): ellipsize a label to the room left of a right value.
function fit(s, px, width) {
  const str = String(s ?? '');
  if (measure(str, px) <= width) return str;
  const chars = [...str];
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(chars.slice(0, mid).join('') + '…', px) <= width) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join('') + '…';
}

// sized(ctx, weight, px, s, width): the largest size up to px that fits.
function sized(px, s, width) {
  const w = measure(s, px);
  return w > width ? Math.max(10, Math.floor((px * width) / w)) : px;
}

// A string with Latin runs in JetBrains Mono and CJK runs in the CJK font.
// The original relies on the browser's per-glyph fallback; resvg needs the
// split made explicit so both fonts are found.
function runs(s) {
  const out = [];
  let buf = '';
  let kind = null;
  for (const ch of String(s)) {
    const k = isCJK(ch) ? 'cjk' : 'mono';
    if (k !== kind && buf) {
      out.push({ kind, s: buf });
      buf = '';
    }
    kind = k;
    buf += ch;
  }
  if (buf) out.push({ kind, s: buf });
  return out;
}

function text(x, y, content, { px = 12.5, weight = 400, fill = INK, anchor = 'start', filter = '' } = {}) {
  const filterAttr = filter ? ` filter="${filter}"` : '';
  const pieces = runs(content)
    .map(
      (r) =>
        `<tspan font-family="${r.kind === 'cjk' ? CJK : MONO}" xml:space="preserve">${escapeXml(r.s)}</tspan>`
    )
    .join('');
  return `<text x="${x}" y="${y}" font-size="${px}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${filterAttr}>${pieces}</text>`;
}

// spaced(ctx, s, cx, y, em, max): letters spaced, centred on cx, drawn a
// character at a time (as the canvas does).
function spaced(s, cx, y, em, max, px, weight = 400, fill = INK) {
  const chars = [...String(s)];
  const bare = chars.reduce((n, ch) => n + measure(ch, px), 0);
  const gap = Math.max(0, Math.min(em, (max - bare) / Math.max(1, chars.length - 1)));
  const w = bare + gap * (chars.length - 1);
  let x = cx - w / 2;
  const out = [];
  for (const ch of chars) {
    out.push(text(x, y, ch, { px, weight, fill }));
    x += measure(ch, px) + gap;
  }
  return out.join('');
}

function row(label, value, y, { weight = 400, px = 12.5, colour = INK } = {}) {
  const vw = measure(value, px);
  return (
    text(R, y, value, { px, weight, fill: colour, anchor: 'end' }) +
    text(L, y, fit(label, px, INNER - vw - 14), { px, weight, fill: colour })
  );
}

function rule(y) {
  // Canvas rule(): lineWidth 1 at y+0.5, dashed [5,4], inset 11 on both sides.
  return `<line x1="${L + 11}" y1="${y + 0.5}" x2="${R - 11}" y2="${y + 0.5}" stroke="${DASH}" stroke-width="1" stroke-dasharray="5 4"/>`;
}

// drawIcon(): the bundled mark when the name has one, else the original's
// fallback filled dot (radius size*0.22).
function drawIcon(name, x, y, size) {
  const markup = iconMarkup(name, x, y, size);
  if (markup) return markup;
  return `<circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size * 0.22}" fill="${INK}"/>`;
}

function count(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2) + 'M';
  if (a >= 1e5) return (v / 1e3).toFixed(0) + 'K';
  return Math.round(v).toLocaleString('en-US');
}

function money(usd) {
  const n = Number(usd) || 0;
  if (n === 0) return '$0.00';
  if (n < 0.01) return '<$0.01';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function percent(r) {
  if (r == null) return '–';
  const p = Number(r) * 100;
  return (p > 0 && p < 1 ? p.toFixed(1) : Math.round(p)) + '%';
}

function multiple(r) {
  const v = Number(r);
  if (!Number.isFinite(v) || v <= 0) return '–';
  if (v < 0.1) return '<0.1×';
  return (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1)) + '×';
}

// proxy active-window milliseconds → "6.2h" / "48m" / "<1m"
function duration(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v <= 0) return '';
  const minutes = v / 60_000;
  if (minutes < 1) return '<1m';
  if (minutes < 90) return `${Math.round(minutes)}m`;
  return `${(v / 3_600_000).toFixed(1)}h`;
}

function cnDate(iso) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日` : '';
}

function cnDateTime(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${cnDate(iso)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const upper = (s) => String(s ?? '?').toLocaleUpperCase();

// ---- the receipt's content, from our report JSON (view.js card()) ----
function receipt(report) {
  // magpie view.card(day) reads the "usage:day" feed; fall back to our
  // legacy report fields only for old cached reports without it.
  const day = report.day || null;
  const totals = report.totals || {};
  const stats = report.stats || {};
  const period = report.period || {};
  const weekly = period.type === 'weekly';
  const calls = day ? day.calls : totals.requests;
  const errors = day ? day.errors : totals.error;
  const cost = day ? day.cost : totals.cost_usd;
  const unpriced = day ? day.unpriced : totals.unpriced_requests;
  const billing = report.billing;
  const valuation=report.valuation;
  const costText=value=>valuation ? '¥'+((Number(value)||0)*valuation.usd_to_cny).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}) : money(value);
  const amounts = Object.entries(billing?.amounts_by_currency || {});
  const pending = valuation?.unpriced_attempts ?? billing?.unpriced_attempts ?? unpriced ?? 0;
  const unitName = unit => unit === 'POINTS' ? '积分' : unit === 'PLAN_TOKENS' ? '计划折算 token' : 'USD';
  const amountText = ([unit, n]) => unit === 'USD' ? money(n) : `${count(n)} ${unitName(unit)}`;
  const noDollarBreakdown = !valuation && !!billing && (amounts.length !== 1 || amounts[0][0] !== 'USD');

  const dateLabel = day
    ? (weekly && day.from && day.date ? `${cnDate(day.from)} – ${cnDate(day.date)}` : cnDate(day.date))
    : (weekly && period.start && period.end
        ? `${cnDate(period.start)} – ${cnDate(period.end)}`
        : cnDate(period.end || period.generated_at));

  const legacyGroups = Array.isArray(report.by_agent_model) ? report.by_agent_model : [];
  // view.card() sorts the retained feed entries by cost (then tokens) before
  // applying its 8-agent / 5-model display limits.
  const costOf = (v) => Number(v?.cost ?? v?.cost_usd) || 0;
  const tokensOf = (v) => Number(v?.tokens) ||
    (Number(v?.input_tokens) || 0) + (Number(v?.output_tokens) || 0) +
    (Number(v?.cache_read_tokens) || 0) + (Number(v?.cache_write_tokens) || 0);
  const byCost = (a, b) => costOf(b) - costOf(a) || tokensOf(b) - tokensOf(a);
  const source = day ? [...day.agents].sort(byCost) : legacyGroups;
  const shown = source.slice(0, 8).map((g) => {
    const models = day ? [...(g.models || [])].sort(byCost).slice(0, 5) : (g.models || []).slice(0, 5);
    const hidden = Math.max(0, (g.models || []).length - 5) + (day ? (g.moreModels || 0) : 0);
    const agentId = day ? (g.id || '') : g.agent;
    return {
      name: upper(agentId === '' || agentId === 'unknown' ? '未标明 AGENT' : (day ? g.name : agentId)),
      icon: day ? (g.icon === 'generic' ? '' : g.icon) : (g.icon || ''),
      value: noDollarBreakdown ? '—' : costText(day ? g.cost : g.cost_usd),
      models: models.map((m) => ({
        name: upper(day ? m.model : m.model),
        icon: day ? (m.icon || '') : (m.icon || ''),
        value: noDollarBreakdown ? '—' : !day && m.priced === false ? '未配价' : costText(day ? m.cost : m.cost_usd),
      })),
      more: hidden ? `还有 ${hidden} 个` : '',
    };
  });
  const moreAgents = day
    ? Math.max(0, source.length - 8) + (day.moreAgents || 0)
    : Math.max(0, legacyGroups.length - 8);

  // view.js streak/average/versus operate on day.days; keep the server-side
  // stats as a fallback for reports produced before the feed existed.
  const streakDays = day ? streak(day.days, day.date, day.today) : (stats.streak_days ?? 0);
  const vsRatio = day ? versus(day, average(day.days, day.date)) : stats.vs_daily_avg;
  const statRows = [
    { label: '连续使用', value: `${streakDays} 天` },
    { label: '请求数', value: count(calls) },
  ];
  const active = duration(stats.active_ms);
  if (active) statRows.push({ label: '使用时长', value: active });
  if (errors > 0) statRows.push({ label: '错误', value: count(errors) });
  if(valuation)for(const [unit,amount] of amounts)if(unit!=='USD')statRows.push({label:unitName(unit),value:count(amount)});
  if (weekly) {
    const had = day
      ? day.days.filter((d) => d.date >= day.from && d.date <= day.date && d.calls > 0).length
      : (stats.active_days ?? 0);
    statRows.push({ label: '活跃天数', value: `${had} / 7` });
    statRows.push({ label: '活跃日均', value: noDollarBreakdown ? '—' : costText(day ? (had ? cost / had : 0) : stats.avg_active_day) });
  } else {
    statRows.push({ label: '对比日均', value: multiple(vsRatio) });
  }

  const dayTokens = day ? tokensOf(day) : totals.total_tokens;
  const hit = day ? hitRate(day) : totals.cache_hit_rate;
  return {
    title: weekly ? '每周 AI 账单' : '每日 AI 账单',
    tagline: '经 sub2agent 路由',
    head: [
      { label: '用户', value: report.user?.name || report.user?.id || '未标明用户' },
      { label: weekly ? '区间' : '日期', value: dateLabel },
      { label: '开具', value: cnDateTime(period.generated_at) },
    ],
    totalLabel: valuation ? 'API 价格折算 · 人民币' : billing ? '用量折算' : 'API 总费用',
    total: valuation ? pending>0 && !cost ? '待定价' : costText(cost) : billing ? amounts.length === 1 ? amountText(amounts[0]) : amounts.length > 1 ? '分项统计' : pending > 0 ? '待定价' : '无已计价用量' : money(cost),
    totalNote: valuation ? '模型目录价折算 · 非实际扣款'+(pending>0?' · 部分待定价':'') : billing ? (amounts.map(amountText).join(' · ') || '未定价不代表免费') + (pending > 0 ? ' · 含待定价用量' : '') : '按 API 价格折算 · 非发票',
    stats: statRows,
    agentHead: ['AGENT / 模型', '费用'],
    agents: shown,
    moreAgents: moreAgents ? `还有 ${moreAgents} 个` : '',
    tokens: [
      { label: 'TOKEN 总量', value: count(dayTokens) },
      { label: '输入', value: count(day ? day.input : totals.input_tokens) },
      { label: '输出', value: count(day ? day.output : totals.output_tokens) },
      { label: '缓存命中率', value: percent(hit) },
    ],
    note: pending > 0 ? `${pending} 次${billing ? '调用尝试待定价' : '请求没有价格'}` : '',
    empty: (calls ?? 0) === 0 ? (weekly ? '这段时间没有调用。' : '这一天没有调用。') : '',
    footer: [
      ['用量账单由 ', 'sub2agent', ' 生成'],
      ['仅采集 token 数值与模型名 · 不含对话内容'],
    ],
    credit: valuation ? `汇率 ${valuation.usd_to_cny} · ${valuation.as_of} · 非结算凭证` : '用量统计仅供参考 · 非结算凭证',
  };
}

// ---- the slip: the original's y arithmetic, line for line (app.js:216) ----
function slip(c) {
  const parts = [];
  let y = 0;

  // title and tagline
  y += 54;
  parts.push(text(PW / 2, y, c.title, { px: sized(30, c.title, INNER), weight: 800, anchor: 'middle', filter: 'url(#glow)' }));
  y += 25;
  parts.push(text(PW / 2, y, c.tagline, { px: 11.5, anchor: 'middle' }));

  // the day, and when this was drawn
  y += 27;
  c.head.forEach((h, i) => {
    if (i) y += 22;
    parts.push(row(h.label, h.value, y));
  });
  y += 15;
  parts.push(rule(y));

  // the day's cost
  y += 25;
  parts.push(spaced(c.totalLabel, PW / 2, y, 3.2, INNER, 12.5));
  y += 57;
  parts.push(text(PW / 2, y, c.total, { px: sized(52, c.total, INNER), weight: 800, anchor: 'middle', filter: 'url(#glow)' }));
  y += 23;
  parts.push(spaced(c.totalNote, PW / 2, y, 1.6, INNER, sized(10.5, c.totalNote, INNER)));
  y += 16;
  parts.push(rule(y));

  // streak, requests, errors, against an average day
  y += 25;
  c.stats.forEach((s, i) => {
    if (i) y += 21;
    parts.push(row(s.label, s.value, y));
  });
  y += 15;
  parts.push(rule(y));

  // each agent and its models, by cost
  y += 25;
  parts.push(row(c.agentHead[0], c.agentHead[1], y, { colour: MUTED }));
  if (c.empty) {
    y += 27;
    parts.push(text(L, y, c.empty, { px: 12.5, fill: MUTED }));
  }
  for (const a of c.agents) {
    y += 27;
    parts.push(drawIcon(a.icon, L, y - 15, 18));
    parts.push(text(R, y, a.value, { px: 14.5, weight: 700, anchor: 'end' }));
    parts.push(text(L + 26, y, fit(a.name, 14.5, INNER - 26 - measure(a.value, 14.5) - 14), { px: 14.5, weight: 700 }));
    y += 1;
    for (const m of a.models) {
      y += 27;
      parts.push(drawIcon(m.icon, L + 26, y - 10.5, 12));
      parts.push(text(R, y, m.value, { px: 12.5, anchor: 'end' }));
      parts.push(text(L + 44, y, fit(m.name, 12.5, INNER - 44 - measure(m.value, 12.5) - 14), { px: 12.5 }));
    }
    if (a.more) {
      y += 24;
      parts.push(text(L + 44, y, a.more, { px: 11.5, fill: MUTED }));
    }
    y += 3;
  }
  if (c.moreAgents) {
    y += 24;
    parts.push(text(L + 26, y, c.moreAgents, { px: 11.5, fill: MUTED }));
  }
  y += 17;
  parts.push(rule(y));

  // the tokens
  y += 25;
  c.tokens.forEach((s, i) => {
    if (i) y += 21;
    parts.push(row(s.label, s.value, y));
  });
  if (c.note) {
    y += 21;
    parts.push(row(c.note, '', y, { colour: MUTED, px: 11 }));
  }
  y += 18;
  parts.push(rule(y));

  // the footer, one word of it bold
  y += 22;
  for (const line of c.footer) {
    const pieces = line
      .map((s, i) => ({ s, weight: i === 1 ? 700 : 400 }))
      .filter((p) => p.s);
    const width = pieces.reduce((n, p) => n + measure(p.s, 10.5), 0);
    let x = PW / 2 - width / 2;
    for (const p of pieces) {
      parts.push(text(x, y, p.s, { px: 10.5, weight: p.weight }));
      x += measure(p.s, 10.5);
    }
    y += 20;
  }

  // whose design the receipt follows
  if (c.credit) {
    parts.push(text(PW / 2, y, c.credit, { px: 9.5, fill: MUTED, anchor: 'middle' }));
    y += 18;
  }
  return { body: parts.join('\n  '), height: Math.ceil(y + 4) };
}

function paperPath(ph) {
  const teeth = Math.round(PW / (TOOTH * 2));
  const tw = PW / teeth;
  const pts = [`0,0`, `${PW},0`, `${PW},${ph - TOOTH}`];
  for (let i = teeth - 1; i >= 0; i -= 1) {
    pts.push(`${(i * tw + tw / 2).toFixed(2)},${ph}`);
    pts.push(`${(i * tw).toFixed(2)},${ph - TOOTH}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${PAPER}" filter="url(#paperShadow)"/>`;
}

function renderReportCardSvg(report) {
  if (!report || (!report.totals && !report.day)) throw new Error('renderReportCardSvg requires a report object');
  const c = receipt(report);
  const s = slip(c);
  const ph = s.height + TOOTH;
  const W = PW + BACKDROP_PAD * 2;
  const H = ph + BACKDROP_PAD * 2;
  const bg = lakeDataURL
    ? `<image x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" href="${lakeDataURL}"/>`
    : `<rect width="${W}" height="${H}" fill="url(#teal)"/><rect width="${W}" height="${H}" fill="url(#tealSheen)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}">
  <defs>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="3" stdDeviation="7" flood-color="#1f1d20" flood-opacity="0.16"/>
    </filter>
    <filter id="paperShadow" x="-30%" y="-20%" width="160%" height="160%">
      <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#00140c" flood-opacity="0.5"/>
    </filter>
    <filter id="iconInk" x="-10%" y="-10%" width="120%" height="120%">
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer>
        <feFuncR type="linear" slope="0.42" intercept="0.1"/>
        <feFuncG type="linear" slope="0.42" intercept="0.1"/>
        <feFuncB type="linear" slope="0.42" intercept="0.1"/>
      </feComponentTransfer>
    </filter>
    <linearGradient id="teal" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="#1dd8d1"/><stop offset="1" stop-color="#92ecc6"/>
    </linearGradient>
    <linearGradient id="tealSheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.14"/>
    </linearGradient>
  </defs>
  ${bg}
  <g transform="translate(${BACKDROP_PAD},${BACKDROP_PAD})">
  ${paperPath(ph)}
  ${s.body}
  </g>
</svg>
`;
}

module.exports = { renderReportCardSvg };
