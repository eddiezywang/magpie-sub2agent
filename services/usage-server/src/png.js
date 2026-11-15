'use strict';

// Optional SVG→PNG conversion. @resvg/resvg-js is an optionalDependency: when
// it is not installed the server serves SVG only and reports png_unavailable.
// The bundled JetBrains Mono faces (assets/fonts, OFL) draw the receipt's Latin
// and digits; a CJK face from USAGE_SERVER_FONT_FILE draws the Chinese labels.
// System fonts are not loaded so renders are deterministic across machines.

const fs = require('node:fs');
const path = require('node:path');

let resvg = null;
try {
  // eslint-disable-next-line global-require
  resvg = require('@resvg/resvg-js');
} catch {
  resvg = null;
}

function pngAvailable() {
  return resvg != null;
}

function bundledFonts() {
  const dir = path.resolve(__dirname, '..', 'assets', 'fonts');
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => /\.(ttf|otf|ttc)$/i.test(name))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function renderPng(svg, { fontFile, defaultFontFamily = 'JetBrains Mono' } = {}) {
  if (!resvg) return null;
  const fontFiles = bundledFonts();
  if (fontFile) fontFiles.push(fontFile);
  const options = {
    fitTo: { mode: 'original' },
    background: 'rgba(247,244,237,1)',
    font: { loadSystemFonts: false, defaultFontFamily, fontFiles },
  };
  const renderer = new resvg.Resvg(svg, options);
  return Buffer.from(renderer.render().asPng());
}

module.exports = { renderPng, pngAvailable };
