// OWNER: levels
/**
 * World 3, hole 10 — SKY BRIDGE (worlds-2-3 LEVELS.md "Level 10", Appendix A with the one change the
 * level rules force, below). Introduces nothing: cannon, spring and bridge combined. Two spires 220 px
 * up face each other over a 720 px chasm (860-1580). Behind the tees a cold CANNON sits in a drum
 * (breech 76-124 at y 600); in front of them a SPRING (442-498) throws a ball onto plate A in the near
 * spire's bowl. A, B (the far spire's bowl) and the DECK (on the bridge, inset 24 px from both lips)
 * each hold the BRIDGE and light the cannon, so one landing on A raises the bridge AND fires a LOADED
 * ball 1,600 px onto B: the cannon never fires without a bridge underneath. Blue shoots first. The cup
 * holds B (D2).
 *
 * Intended line (par 7): blue chips LEFT into the cold cannon and waits, LOADED -> red rides the spring
 * onto A: the bridge appears, the cannon lights and fires blue onto B -> blue putts out (the cup keeps
 * B held) -> red crosses the bridge from A and putts. Second route: both ride the spring onto A and
 * cross one at a time (World 1's Plate & Bridge pattern; a lone ball on the DECK must fly off it).
 *
 * Deviation from Appendix A (BUILD_DECISIONS D10.12): the back bunker there was 1930-1960 (30 px, under
 * the 40 px minimum) and plate B's right edge (1750) sat exactly GIMME_RADIUS + NEAR_CUP_RADIUS = 130 px
 * from the cup at 1880, where the rule needs more. A 40 px bunker reaching the level edge must start at
 * 1920 and the cup must stay more than GIMME_RADIUS in front of it, so the cup moves 5 px along the
 * green to 1875 (rim y 390 unchanged, so the overview rule keeps its 0.75 px), and plate B and its bowl
 * flat lose 10 px on the right (1630-1740; the bowl's right ramp 1740-1770 keeps its 30 px run, the
 * sand 1602-1768). The cannon -> B flight rests at x 1672-1720 for every breech x and every +-3 %
 * launch on the Appendix bowl, 20 px short of the new edge; re-measured on this geometry (levels README
 * "Launcher re-verification"), every case still rests on B with exactly one launch.
 */
import type { Level } from '../types';
import { SWITCH_COLOUR, compileLevel, terrainPiece } from './authoring';

const GAP_X1 = 860;
const GAP_X2 = 1580;
const DECK_INSET = 24;
const B_FLOOR_X1 = 1630;
const B_FLOOR_X2 = 1740; // Appendix A: 1750 (see the header)

export const level: Level = compileLevel({
  id: 'w3-10-sky-bridge',
  name: 'Sky Bridge',
  world: 3,
  order: 10,
  par: 7,
  hint: 'Blue: chip back into the CANNON and wait. Red: ride the SPRING onto A, and the BRIDGE and the cannon both go live.',
  aha: 'My landing on A does three things at once: it raises the bridge, lights the cannon and fires my partner across, so the cannon never fires without a bridge underneath.',
  watchOut:
    'A cold CANNON is safe: a ball resting in it just waits, LOADED, and fires the moment a ball rests on A, B or the DECK, which also raises the bridge. Without the cannon, ride the SPRING onto A and cross one at a time. A ball parked on the DECK holds the bridge only while it sits still, so it must fly off it, never roll, or it drops into the chasm (+1).',
  mechanicsIntroduced: [],
  firstPlayer: 1,
  cupHoldsSwitch: 'b',
  width: 1960,
  wind: 0,
  terrain: {
    pieces: [
      terrainPiece(
        [
          [0, 620],
          [40, 620],
          [41, 580], // cannon drum 41-160, top 580
          [56, 580],
          [76, 600], // breech floor 76-124 at y 600
          [124, 600],
          [144, 580],
          [160, 580],
          [161, 620],
          [600, 620], // tee flat: tees 280 / 330, spring pad 442-498
          [601, 400], // spire A, 220 px up
          [640, 400],
          [670, 416], // A bowl 640-820 (sand), plate A 670-790
          [790, 416],
          [820, 400],
          [GAP_X1, 400],
        ],
        720,
      ),
      terrainPiece(
        [
          [GAP_X2, 400], // spire B
          [1600, 400],
          [B_FLOOR_X1, 416], // B bowl 1600-1770 (sand), plate B on its floor
          [B_FLOOR_X2, 416],
          [1770, 400],
          [1810, 400],
          [1830, 390],
          [1960, 390], // green 1830-1960, cup at 1875, back bunker 1920-1960
        ],
        720,
      ),
    ],
    gaps: [{ x1: GAP_X1, x2: GAP_X2 }],
  },
  props: [
    { kind: 'cannon', id: 'cannon', centerX: 100, w: 48, launch: { x: 520, y: -760 }, fireIds: ['a', 'b', 'deck'], label: 'CANNON' },
    { kind: 'spring', id: 'spring', centerX: 470, w: 56, launch: { x: 120, y: -690 }, label: 'SPRING' },
    { kind: 'bridge', id: 'bridge', gap: { x1: GAP_X1, x2: GAP_X2 }, switchIds: ['a', 'b', 'deck'], label: 'BRIDGE' },
    { kind: 'sand', id: 'a-sand', x1: 642, x2: 818 },
    { kind: 'sand', id: 'b-sand', x1: 1602, x2: 1768 },
    { kind: 'sand', id: 'back-bunker', x1: 1920, x2: 1960 },
  ],
  switches: [
    { id: 'a', centerX: 730, w: 120, colour: SWITCH_COLOUR, label: 'A' }, // 670-790 on the bowl floor
    { id: 'b', centerX: (B_FLOOR_X1 + B_FLOOR_X2) / 2, w: B_FLOOR_X2 - B_FLOOR_X1, colour: SWITCH_COLOUR, label: 'B' }, // the whole bowl floor
    { id: 'deck', centerX: (GAP_X1 + GAP_X2) / 2, w: GAP_X2 - GAP_X1 - 2 * DECK_INSET, colour: SWITCH_COLOUR, label: 'DECK', onRectId: 'bridge' },
  ],
  holeX: 1875,
  startXs: [280, 330],
});
