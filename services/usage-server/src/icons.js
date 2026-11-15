'use strict';

// Receipt icon renderer, ported from magpie day-card app.js drawIcon(): a
// mono mark (a bundled SVG without "-color") fills with the ink; a colour
// mark prints in greys from its own darkest to its lightest (here two-tone
// ink↔paper by luminance, like the canvas's near-white-stays-light rule);
// pictures print as images. Unknown or missing names draw nothing — the
// caller falls back to the original's plain dot.

const fs = require('node:fs');
const path = require('node:path');

const INK = '#1f1d20';
const PAPER = '#f7f4ed';

const ICON_DIR = process.env.USAGE_SERVER_ICON_DIR || path.resolve(__dirname, '..', 'assets', 'icons');
const cache = new Map();

function luminance([r, g, b]) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

// smoothstep((lum - 0.65) / 0.2), then ink↔paper — the canvas's rule that
// only near-white stays light and everything else prints solid.
function twoTone(color) {
  const l = luminance(color);
  const t = clamp01((l - 0.65) / 0.2);
  const s = t * t * (3 - 2 * t);
  const mix = (a, b) => Math.round(a + (b - a) * s);
  return `rgb(${mix(31, 247)},${mix(29, 244)},${mix(32, 237)})`;
}

const NAMED = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
};

function parseColor(value) {
  const v = String(value).trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) {
    return m[1].split('').map((h) => parseInt(h + h, 16));
  }
  m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).slice(0, 3).map((x) => Number(x));
    if (parts.every((x) => Number.isFinite(x))) return parts;
  }
  return NAMED[v] || null;
}

function recolorAttr(value, mono) {
  if (/^(none|inherit|transparent|url\()/i.test(value)) return value;
  if (mono || value.toLowerCase() === 'currentcolor') return INK;
  const color = parseColor(value);
  return color ? twoTone(color) : value;
}

function recolor(inner, mono) {
  return inner
    // gradient fills carry the brand's colours through the two-tone map —
    // the canvas path flattened them by pixel luminance, so the middle tone
    // (the brand colour) simply prints as ink here
    .replace(/(fill|stroke)="url\([^"]*\)"/gi, (m, attr) => `${attr}="${INK}"`)
    .replace(/(fill|stroke)="([^"]*)"/gi, (m, attr, value) => `${attr}="${recolorAttr(value, mono)}"`)
    .replace(/(stop-color)="([^"]*)"/gi, (m, attr, value) => `${attr}="${recolorAttr(value, mono)}"`)
    .replace(/(fill|stroke)(\s*:\s*)([^;"'}]+)/gi, (m, attr, sep, value) => `${attr}${sep}${recolorAttr(value.trim(), mono)}`);
}

function loadIcon(name) {
  if (!name || /[/:\\]/.test(name)) return null;
  let icon = cache.get(name);
  if (icon !== undefined) return icon;
  icon = null;
  for (const ext of ['.svg', '.png']) {
    try {
      const file = path.join(ICON_DIR, name + ext);
      const bytes = fs.readFileSync(file);
      if (bytes.length > 256 << 10) continue; // maxPageIcon, like the original
      if (ext === '.svg') {
        const source = bytes.toString('utf8');
        const vb = /viewBox="([^"]+)"/.exec(source);
        if (!vb) continue;
        const open = /<svg[^>]*>/i.exec(source);
        if (!open) continue;
        const inner = source
          .slice(open.index + open[0].length)
          .replace(/<\/svg\s*>\s*$/i, '')
          .replace(/<title[\s\S]*?<\/title>/gi, '');
        const pixel = /shape-rendering="crispEdges"/.test(open[0]);
        icon = {
          kind: 'svg',
          viewBox: vb[1],
          pixel,
          mono: !pixel && !/-color$/i.test(name),
          inner: pixel ? inner : recolor(inner, !/-color$/i.test(name)),
        };
      } else {
        icon = { kind: 'png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
      }
      break;
    } catch {
      // try the next extension
    }
  }
  cache.set(name, icon);
  return icon;
}

/** SVG markup for icon `name` at (x, y, size), or '' when there is none. */
function iconMarkup(name, x, y, size) {
  const icon = loadIcon(name);
  if (!icon) return '';
  if (icon.kind === 'png') {
    return `<image x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" filter="url(#iconInk)" href="${icon.dataUrl}"/>`;
  }
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${icon.viewBox}"${icon.pixel ? ' shape-rendering="crispEdges"' : ''} preserveAspectRatio="xMidYMid meet" fill="${icon.mono ? INK : PAPER}" overflow="visible">${icon.inner}</svg>`;
}

module.exports = { iconMarkup };
