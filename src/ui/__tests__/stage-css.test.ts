// OWNER: ui
// Stage-layer CSS rules that jsdom cannot compute (custom properties resolved per element, inherited text stroke,
// hit testing), pinned on the stylesheet's text: the HUD band follows --hud-scale where App sets it, a hanging
// CAUGHT / LOADED sticker on a narrow row pushes the band under it, the banner's sub-line keeps the ink stroke,
// and the stage coach never takes a press (only its "Got it" button does).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the rule whose selector list is exactly `selector` (whitespace-normalised). */
function rule(selector: string): Record<string, string> {
  const blocks = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const block = blocks.find((m) => (m[1] ?? '').trim().replace(/\s+/g, ' ') === selector);
  if (block === undefined) throw new Error(`no rule "${selector}"`);
  const decls: Record<string, string> = {};
  for (const part of (block[2] ?? '').split(';')) {
    const at = part.indexOf(':');
    if (at > 0) decls[part.slice(0, at).trim()] = part.slice(at + 1).trim().replace(/\s+/g, ' ');
  }
  return decls;
}

describe('stage layer CSS', () => {
  it('declares the HUD band on the stage layer, where App sets --hud-scale, not on :root (phones: the banner sat on the cards)', () => {
    expect(rule(':root')['--band']).toBeUndefined();
    const stage = rule('.stage-layer');
    expect(stage['--band']).toBe('calc(12px + (48px + var(--band-hang)) * var(--hud-scale) + 8px)');
    expect(stage['--band-hang']).toBe('0px');
    for (const slot of ['.banner', '.net-band']) expect(rule(slot)['top']).toBe('calc(var(--band) + 12px)');
  });

  it('a narrow row hangs the waiting status under its chip and the band reaches under it while a ball waits', () => {
    expect(CSS).not.toMatch(/@container/);
    expect(rule('.row-narrow .chip.waits .status')['position']).toBe('absolute');
    expect(rule('.row-narrow .level-chip .par-pill')['display']).toBe('none');
    const hang = rule('.stage-layer.row-narrow:has(.chip.waits)')['--band-hang'];
    // The sticker hangs 6 px under the 48 px chip, ~25 px tall with a 3 px shadow: the band must clear it.
    expect(Number.parseFloat(hang ?? '0')).toBeGreaterThanOrEqual(20);
  });

  it("the banner's sub-line keeps the main line's 2 px ink stroke (white alone on --p2 is 2.2:1)", () => {
    const banner = rule('.banner');
    expect(banner['-webkit-text-stroke']).toBe('2px var(--ink)');
    expect(banner['paint-order']).toBe('stroke fill');
    const sub = rule('.banner small');
    expect(sub['-webkit-text-stroke']).toBeUndefined();
    expect(sub['paint-order']).toBeUndefined();
    expect(sub['color']).toBeUndefined();
  });

  it('the stage coach lets a pull that starts on it reach the canvas; only its "Got it" button takes presses, and not while faded', () => {
    expect(rule('.stage-layer')['pointer-events']).toBe('none');
    expect(rule('.coach-stage')['pointer-events']).toBe('none');
    expect(rule('.coach-stage:not(.coach-faded) .btn')['pointer-events']).toBe('auto');
  });
});
