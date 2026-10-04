// OWNER: levels
/**
 * World 1, hole 4 — PLATE & BRIDGE (LEVELS.md "Level 4"). A 720 px chasm (wider than any shot at
 * 6.5: vacuum range 681 + radius 12 = 693) bridged while plate A (near lip dish), plate B (the
 * landing bowl across the gap) or the bridge DECK is held: one bridge rect with
 * `switchIds: ['near', 'far', 'deck']` (OR). The DECK plate is inset 24 px from both lips so a
 * ball resting at a lip never holds the bridge. A plate is HELD by a resting (asleep) ball and
 * released the tick its holder moves (physics.ts switchPresser), so a lone ball on plate A drops
 * the bridge the moment it is struck and is over the chasm when it reaches the lip at 520; the
 * 50 px ramp 470-520 keeps a plate-A rest off the lip. A lone ball on the DECK is in the same
 * position: the deck holds the bridge only while that ball is parked, so when it moves with nobody
 * else holding, the planks vanish under it and it must FLY all the way to the far lip (from the
 * deck centre a 45 deg lob at power 80+; from the far third most lobs); a roll along the deck
 * always drops it (scripts/solver.ts `deck-lone-roll-falls`). Red shoots first and holds first.
 * A sunk ball holds plate B's switch from the cup (D2). Teaches the bridge (typed as a second
 * 'switch' level, see README).
 *
 * A back bunker 1910-1960 runs from 50 px behind the cup to the level edge: without it the edge
 * (WALL_RESTITUTION 0.45, 100 px behind the cup) banked 33 of 53 human-grid hole-outs from 1600
 * back into the cup; with it 30 of those approaches stop in the sand and the green gets putted
 * (rests within 90 px of the cup 23 -> 40 of 162).
 *
 * Intended line (par 7; LEVELS.md said 8, see README "Pars"): red chips onto plate A -> blue takes a full swing across, resting on the
 * deck or in the far bowl -> red crosses from plate A -> whoever is on the deck flies off ->
 * both putt out.
 */
import type { Level } from '../types';
import { SWITCH_COLOUR, compileLevel, terrainPiece } from './authoring';

const GAP_X1 = 520;
const GAP_X2 = 1240;
const DECK_INSET = 24;

export const level: Level = compileLevel({
  id: 'w1-04-plate-and-bridge',
  name: 'Plate & Bridge',
  world: 1,
  order: 4,
  par: 7,
  hint: 'A resting ball on plate A holds the bridge up. Both chip onto plate A, then cross one at a time with a full swing; the bridge deck also holds itself while a ball rests on it.',
  aha: 'The bridge only exists while someone is resting on a plate, so one of us stays behind on plate A while the other crosses, and the landing plate across the chasm (or the bridge deck itself) lets the first crosser hold it for the partner: we swap roles instead of racing.',
  watchOut:
    'Overshoot plate A and the ball drops into the chasm: +1 and back to the tee flat. A ball parked on the DECK holds the bridge only while it sits still: when nobody else holds A, B or the DECK, it must FLY all the way to the far side, never roll, or the planks vanish under it. The ball on plate B waits for the partner (a ball in the cup holds the bridge too).',
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
    { id: 'deck', centerX: (GAP_X1 + GAP_X2) / 2, w: GAP_X2 - GAP_X1 - 2 * DECK_INSET, colour: SWITCH_COLOUR, label: 'DECK', onRectId: 'bridge' },
  ],
  holeX: 1860,
  startXs: [245, 295], // both on the tee flat 220-320; LEVELS.md says 250 / 290, MIN_TEE_SEPARATION (50) wins
});
