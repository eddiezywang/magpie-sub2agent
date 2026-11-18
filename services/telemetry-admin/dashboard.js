'use strict';

const byId = id => document.getElementById(id);
const total = values => values.reduce((sum, value) => sum + value, 0);
const number = new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 1});
const dateFormat = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai', dateStyle: 'short'});
let snapshot;

function table(id, rows) {
  const body = byId(id);
  body.replaceChildren();
  for (const values of rows) {
    const row = body.insertRow();
    for (const value of values) row.insertCell().textContent = value;
  }
}

function draw(series) {
  const canvas = byId('trend');
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const metric = byId('metric').value;
  const values = series.map(row => row[metric]);
  const max = Math.max(1, ...values);
  const left = 54;
  const baseline = height - 26;
  const step = (width - left - 12) / values.length;
  ctx.font = '12px system-ui';
  for (const fraction of [0, 0.5, 1]) {
    const y = baseline - (baseline - 16) * fraction;
    ctx.fillStyle = '#4a6268';
    ctx.fillText(number.format(max * fraction), 0, y + 4, left - 8);
    ctx.fillStyle = '#dbe7e7';
    ctx.fillRect(left, y, width - left, 1);
  }
  for (const [index, value] of values.entries()) {
    const bar = (baseline - 16) * value / max;
    ctx.fillStyle = '#167875';
    ctx.fillRect(left + index * step, baseline - bar, Math.max(1, step * .72), bar);
  }
  ctx.fillStyle = '#4a6268';
  ctx.fillText(series[0].day.slice(5), left, height - 5);
  ctx.textAlign = 'right';
  ctx.fillText(series.at(-1).day.slice(5), width - 5, height - 5);
}

function render() {
  if (!snapshot?.generated_at) return;
  const days = Number(byId('range').value);
  const now = Date.now();
  const series = Array.from({length: days}, (_, i) => {
    const day = dateFormat.format(now - (days - i - 1) * 86400000);
    const {active = 0, requests = 0, events = {}} = snapshot.days[day] || {};
    return {day, active, requests, counts: events, events: total(Object.values(events))};
  });
  byId('active').textContent = number.format(total(series.map(row => row.active)) / days);
  for (const field of ['events', 'requests']) byId(field).textContent = number.format(total(series.map(row => row[field])));
  table('breakdown', Object.entries(snapshot.event_labels)
    .map(([key, label]) => [label, total(series.map(row => row.counts[key] || 0))])
    .sort((a, b) => b[1] - a[1]).map(([label, value]) => [label, number.format(value)]));
  table('daily', series.slice().reverse().map(row =>
    [row.day, ...['active', 'events', 'requests'].map(field => number.format(row[field]))]));
  draw(series);
}

async function refresh() {
  try {
    const response = await fetch('/api/stats');
    if (!response.ok) throw Error(response.status);
    snapshot = await response.json();
    if (snapshot.generated_at) {
      const at = new Date(snapshot.generated_at);
      const stamp = at.toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false});
      byId('sync').textContent = (Date.now() - at > 15 * 60000 ? '同步已延迟 · ' : '最近同步 · ') + stamp;
    } else byId('sync').textContent = '等待首次同步';
    render();
  } catch {
    byId('sync').textContent = '读取失败，稍后自动重试';
  }
}

byId('range').addEventListener('change', render);
byId('metric').addEventListener('change', render);
new ResizeObserver(render).observe(byId('trend'));
refresh();
setInterval(refresh, 60000);
