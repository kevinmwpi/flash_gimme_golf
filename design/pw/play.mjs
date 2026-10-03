// Drive the game in headless Edge from a JSON step list and capture screenshots + console/page errors.
//
// Usage: node play.mjs <url> <steps.json> <outDir> [viewportW=1280] [viewportH=720]
//
// steps.json is an array of step objects, executed in order. Supported keys (one per step):
//   {"goto": "http://..."}                      navigate (networkidle)
//   {"click": "<playwright selector>"}          e.g. "text=Solo", "button:has-text('Start')", "#id"
//   {"clickXY": [x, y]}                         click at page coordinates (CSS px)
//   {"press": "Space"}                          keyboard press (Playwright key names)
//   {"hold": ["ArrowUp", 600]}                  hold a key for N ms
//   {"type": "ABCDE"}                           type text into the focused element
//   {"fill": ["<selector>", "text"]}            fill an input
//   {"drag": [x1, y1, x2, y2, steps?]}          mouse drag with the primary button (default 12 intermediate moves)
//   {"wait": 500}                               wait N ms
//   {"waitFor": "<selector>"}                   wait for selector (10 s timeout)
//   {"shot": "name"}                            screenshot -> <outDir>/<name>.png
//   {"eval": "<js expression>"}                 evaluate in page; result recorded in the report
//   {"viewport": [w, h]}                        resize viewport
//   {"touch": true}                             (set at start only) emulate a touch device with hasTouch
//   {"log": "message"}                          annotate the report
// The report (<outDir>/report.json) lists each step, eval results, console errors and page errors.
import { chromium, devices } from 'playwright-core';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [url, stepsFile, outDir, vw = '1280', vh = '720'] = process.argv.slice(2);
if (!url || !stepsFile || !outDir) {
  console.error('usage: node play.mjs <url> <steps.json> <outDir> [w] [h]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));
const touch = steps.some((s) => s.touch === true);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: Number(vw), height: Number(vh) },
  hasTouch: touch,
  isMobile: false,
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const report = { url, steps: [], consoleErrors: [], pageErrors: [], consoleWarnings: [] };
page.on('pageerror', (e) => report.pageErrors.push(String(e.message || e)));
page.on('console', (m) => {
  if (m.type() === 'error') report.consoleErrors.push(m.text());
  if (m.type() === 'warning') report.consoleWarnings.push(m.text());
});

const rec = (step, extra = {}) => report.steps.push({ ...step, ...extra });
try {
  await page.goto(url, { waitUntil: 'networkidle' });
  for (const step of steps) {
    try {
      if (step.goto) await page.goto(step.goto, { waitUntil: 'networkidle' });
      else if (step.click) await page.locator(step.click).first().click({ timeout: 8000 });
      else if (step.clickXY) await page.mouse.click(step.clickXY[0], step.clickXY[1]);
      else if (step.press) await page.keyboard.press(step.press);
      else if (step.hold) { await page.keyboard.down(step.hold[0]); await page.waitForTimeout(step.hold[1]); await page.keyboard.up(step.hold[0]); }
      else if (step.type) await page.keyboard.type(step.type);
      else if (step.fill) await page.locator(step.fill[0]).first().fill(step.fill[1]);
      else if (step.drag) {
        const [x1, y1, x2, y2, n = 12] = step.drag;
        await page.mouse.move(x1, y1); await page.mouse.down();
        for (let i = 1; i <= n; i += 1) { await page.mouse.move(x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n); await page.waitForTimeout(16); }
        await page.mouse.up();
      }
      else if (step.wait) await page.waitForTimeout(step.wait);
      else if (step.waitFor) await page.locator(step.waitFor).first().waitFor({ timeout: 10000 });
      else if (step.shot) { const file = path.join(outDir, step.shot + '.png'); await page.screenshot({ path: file }); rec(step, { file }); continue; }
      else if (step.eval) { const result = await page.evaluate(step.eval); rec(step, { result }); continue; }
      else if (step.viewport) await page.setViewportSize({ width: step.viewport[0], height: step.viewport[1] });
      else if (step.touch !== undefined || step.log) { rec(step); continue; }
      rec(step, { ok: true });
    } catch (e) {
      rec(step, { error: String(e.message || e) });
      const file = path.join(outDir, `error-step-${report.steps.length}.png`);
      try { await page.screenshot({ path: file }); } catch { /* ignore */ }
    }
  }
} finally {
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
const failed = report.steps.filter((s) => s.error).length;
console.log(`steps=${report.steps.length} failed=${failed} consoleErrors=${report.consoleErrors.length} pageErrors=${report.pageErrors.length} -> ${path.join(outDir, 'report.json')}`);
if (report.pageErrors.length) console.log('pageErrors:', JSON.stringify(report.pageErrors.slice(0, 5)));
if (report.consoleErrors.length) console.log('consoleErrors:', JSON.stringify(report.consoleErrors.slice(0, 5)));
