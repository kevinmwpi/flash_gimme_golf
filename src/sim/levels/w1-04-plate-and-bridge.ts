// OWNER: levels
/**
 * World 1, hole 4 — PLATE & BRIDGE (LEVELS.md "Level 4"). A 720 px chasm (wider than any shot at
 * 6.5: vacuum range 681 + radius 12 = 693) bridged while plate A (near lip dish), plate B (the
 * landing bowl across the gap) or the bridge DECK is held: one bridge rect with
 * `switchIds: ['near', 'far', 'deck']` (OR). A plate is pressed by any ball on it, rolling,
 * bouncing or resting, and comes up the tick no ball is on it (BUILD_DECISIONS D11, physics.ts
 * switchPresser), so a lone ball on plate A keeps the bridge only while it is on A. A ends 50 px
 * short of the lip at 520 (the 50 px ramp 470-520 also keeps a plate-A rest off the lip), so the
 * planks are gone long before that ball is over the chasm (scripts/solver `lone-plate-never-crosses`).
 * The DECK plate spans the bridge exactly: a ball on the planks holds the bridge itself, so a lone
 * deck ball can ROLL off either end and the planks stay under it to the lip; a lob that rises more
 * than PLATE_HOLD_HEIGHT_PX above the planks lifts off the deck, the planks vanish and it crosses
 * only if it carries to a lip (`deck-lone-roll-keeps-bridge`, `deck-lone-lob-lifts-off`). A ball
 * resting AT a lip stands on the terrain, not the planks, so it never holds the bridge (the
 * ground-source rule, `deck-lip`). Until D11 the deck was inset 24 px from both lips and held only
 * by a resting ball; under D11 that inset dropped the planks under a rolling deck ball 22-24 px
 * short of the lip (120 of 1,120 lone rolls fell, levels README "D11"), so the deck now runs lip to
 * lip. Red shoots first and holds first. A sunk ball holds plate B's switch from the cup (D2).
 * Teaches the bridge (typed as a second 'switch' level, see README).
 *
 * A back bunker 1910-1960 runs from 50 px behind the cup to the level edge: without it the edge
 * (WALL_RESTITUTION 0.45, 100 px behind the cup) banked 33 of 53 human-grid hole-outs from 1600
 * back into the cup; with it 30 of those approaches stop in the sand and the green gets putted
 * (rests within 90 px of the cup 23 -> 40 of 162).
 *
 * Intended line (par 7; LEVELS.md said 8, see README "Pars"): red chips onto plate A -> blue takes a full swing across, resting on the
 * deck or in the far bowl -> red crosses from plate A -> whoever is on the deck rolls off it ->
 * both putt out.
 */
import type { Level } from '../types';
import { SWITCH_COLOUR, compileLevel, terrainPiece } from './authoring';

const GAP_X1 = 520;
const GAP_X2 = 1240;

export const level: Level = compileLevel({
  id: 'w1-04-plate-and-bridge',
  name: 'Plate & Bridge',
  world: 1,
  order: 4,
  par: 7,
  hint: 'A ball on plate A holds the bridge up. Both chip onto plate A, then cross one at a time with a full swing; the bridge deck also holds itself while a ball is on it.',
  aha: 'The bridge only exists while someone is on a plate, so one of us stays behind on plate A while the other crosses, and the landing plate across the chasm (or the bridge deck itself) lets the first crosser hold it for the partner: we swap roles instead of racing.',
  watchOut:
    'Overshoot plate A and the ball drops into the chasm: +1 and back to the tee flat. A ball on the DECK holds the bridge while it stays on the planks, so roll off it: a high lob lifts off the deck and the planks vanish unless a ball holds A or B. The ball on plate B waits for the partner (a ball in the cup holds the bridge too).',
  mechanicsIntroduced: ['bridge'],
  firstPlayer: 0,
  cupHoldsSwitch: 'far',
  width: 1960,
  wind: 0,
  terrain: {
    pieces: [
      terrainPiece(
        [
          [0, 624],
          [120, 616],
          [220, 630], // tee flat 220-320
          [320, 630],
          [350, 620],
          [400, 640], // plate A dish 350-520: flat 400-470, far ramp climbs to the lip at 520
          [470, 640],
          [GAP_X1, 620],
        ],
        720,
      ),
      terrainPiece(
        [
          [GAP_X2, 620],
          [1256, 620],
          [1272, 628], // landing bowl 1272-1540 carries plate B (the natural roll-out zone)
          [1540, 628],
          [1560, 620],
          [1700, 616],
          [1760, 590],
          [1800, 584], // green 1800-1920, cup at 1860
          [1920, 584],
          [1960, 590],
        ],
        720,
      ),
    ],
    gaps: [{ x1: GAP_X1, x2: GAP_X2 }],
  },
  props: [
    { kind: 'bridge', id: 'bridge', gap: { x1: GAP_X1, x2: GAP_X2 }, switchIds: ['near', 'far', 'deck'], label: 'BRIDGE' },
    { kind: 'sand', id: 'back-bunker', x1: 1910, x2: 1960 },
  ],
  switches: [
    { id: 'near', centerX: 435, w: 70, colour: SWITCH_COLOUR, label: 'A' }, // 400-470 on the dish floor
    { id: 'far', centerX: 1406, w: 268, colour: SWITCH_COLOUR, label: 'B' }, // 1272-1540, the whole landing bowl
    { id: 'deck', centerX: (GAP_X1 + GAP_X2) / 2, w: GAP_X2 - GAP_X1, colour: SWITCH_COLOUR, label: 'DECK', onRectId: 'bridge' }, // lip to lip (D11)
  ],
  holeX: 1860,
  startXs: [245, 295], // both on the tee flat 220-320; LEVELS.md says 250 / 290, MIN_TEE_SEPARATION (50) wins
});
