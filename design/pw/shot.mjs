// Usage: node shot.mjs <input.html|input.svg|http://url> <out.png> [width=1280] [height=720] [waitMs=300]
// Renders with headless Edge via playwright-core. For .svg inputs the file is wrapped in an HTML page.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [input, out, w = '1280', h = '720', waitMs = '300'] = process.argv.slice(2);
if (!input || !out) {
  console.error('usage: node shot.mjs <input.html|input.svg|url> <out.png> [w] [h] [waitMs]');
  process.exit(2);
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
try {
  if (/^https?:\/\//.test(input)) {
    await page.goto(input, { waitUntil: 'networkidle' });
  } else if (input.toLowerCase().endsWith('.svg')) {
    const svg = readFileSync(input, 'utf8');
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${svg}</body></html>`);
  } else {
    await page.goto(pathToFileURL(path.resolve(input)).href, { waitUntil: 'load' });
  }
  await page.waitForTimeout(Number(waitMs));
  await page.screenshot({ path: out });
  console.log('wrote', out, errors.length ? 'errors: ' + JSON.stringify(errors) : 'no page errors');
} finally {
  await browser.close();
}
