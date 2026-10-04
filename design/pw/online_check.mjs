// Two-browser online check against the local dev client + game server.
// Host creates a room, guest opens the invite URL (?room=CODE), host starts, both reach the intro,
// guest dismisses the intro (either seat may continue), host shoots with the keyboard, both screenshot.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5199/';
const OUT = process.argv[3] ?? 'online-out';
mkdirSync(OUT, { recursive: true });
const report = { steps: [], errors: [] };
const note = (m) => { report.steps.push(m); console.log(m); };

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const mk = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`${name} console: ${m.text()}`); });
  return page;
};
const shot = async (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const text = async (page) => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').trim();

try {
  const host = await mk('host');
  await host.goto(BASE, { waitUntil: 'load' });
  await host.waitForTimeout(1200);
  await host.locator("button:has-text('ONLINE')").first().click();
  await host.waitForTimeout(800);
  await shot(host, '01-host-online-menu');
  await host.locator("button:has-text('Create')").first().click();
  // wait for a 5-char room code in the page text
  let code = null;
  for (let i = 0; i < 40 && !code; i += 1) {
    await host.waitForTimeout(250);
    const m = (await text(host)).match(/\b([A-HJ-NP-Z2-9]{5})\b/);
    if (m) code = m[1];
  }
  await shot(host, '02-host-lobby');
  note(`room code: ${code}`);
  if (!code) throw new Error('no room code shown');

  const guest = await mk('guest');
  await guest.goto(`${BASE}?room=${code}`, { waitUntil: 'load' });
  await guest.waitForTimeout(2500);
  await shot(guest, '03-guest-lobby');
  await shot(host, '04-host-partner-here');
  const start = host.locator("button:has-text('Start')").first();
  note(`host start enabled: ${await start.isEnabled()}`);
  await start.click();
  await host.waitForTimeout(1800);
  await guest.waitForTimeout(200);
  await shot(host, '05-host-intro');
  await shot(guest, '06-guest-intro');
  note(`guest intro text: ${(await text(guest)).slice(0, 160)}`);

  // either seat may continue: the guest tees off for both
  await guest.locator("button:has-text('Tee off')").first().click();
  await guest.waitForTimeout(1800);
  await shot(host, '07-host-aiming');
  await shot(guest, '08-guest-watching');

  // host (red) aims with the keyboard; the guest should see the live arc
  await host.mouse.click(640, 300); // focus the stage
  await host.keyboard.down('ArrowUp'); await host.waitForTimeout(400); await host.keyboard.up('ArrowUp');
  await host.waitForTimeout(500);
  await shot(guest, '09-guest-sees-partner-aim');
  await host.keyboard.press('Space');
  await host.waitForTimeout(700);
  await shot(guest, '10-guest-sees-flight');
  await host.waitForTimeout(4500);
  await shot(host, '11-host-after');
  await shot(guest, '12-guest-after');
  note(`guest hud after: ${(await text(guest)).slice(0, 220)}`);
} catch (e) {
  report.errors.push(`script: ${e.message}`);
  console.log('ERROR', e.message);
} finally {
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(`errors=${report.errors.length}`, report.errors.slice(0, 6));
