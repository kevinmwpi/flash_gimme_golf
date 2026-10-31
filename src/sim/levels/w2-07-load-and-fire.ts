// OWNER: levels
/**
 * World 2, hole 7 — LOAD & FIRE (worlds-2-3 LEVELS.md "Level 7", Appendix A verbatim). A 559 px chasm
 * (961-1520) to a plateau 220 px up: no hand shot crosses it, but a CANNON on an 80 px mount (841-960)
 * does, and only the partner can fire it. The breech is a 40 px flush pad (890-930) on the floor of a
 * sand funnel (841-889 / 931-960). While a ball RESTS on either FIRE plate (the dish near the tees, or
 * the landing bowl across the chasm) the cannon is LIT and any ball entering the breech is fired along
 * (400, -700); while it is COLD a ball can rest in the breech, LOADED, and it fires the tick a FIRE
 * plate is held (the WAITING rule hands its turns to the partner meanwhile). Teaches the CANNON; red
 * shoots first. The cup holds the far FIRE plate (D2), so the first ball home keeps the cannon lit.
 *
 * Intended line (par 8): red moves up to the approach (x 650-830) -> blue rests on FIRE -> red lobs
 * into the funnel, is fired across and lands on the far FIRE plate (or, in the other order, red waits
 * LOADED and blue's landing on FIRE fires it) -> blue leaves FIRE (the far plate keeps the cannon lit)
 * and lobs in -> both putt out.
 *
 * Measured against the real sim (levels README "Launcher re-verification"): from every breech x
 * (0.5 px steps) and every +-3 % launch change, a ball fired on entry or fired LOADED rests on the far
 * FIRE plate with exactly one launch; with the cannon cold no human-grid shot from the approach rests
 * beyond the chasm.
 */
import type { Level } from '../types';
import { SWITCH_COLOUR, compileLevel, terrainPiece } from './authoring';

const GAP_X1 = 961;
const GAP_X2 = 1520;

export const level: Level = compileLevel({
  id: 'w2-07-load-and-fire',
  name: 'Load & Fire',
  world: 2,
  order: 7,
  par: 8,
  hint: 'Lob into the CANNON and it waits: it fires only while a ball RESTS on a FIRE plate. Whoever lands across rests on the far FIRE plate to fire the other.',
  aha: 'I cannot fire myself: I sit in the cannon, you rest on FIRE, and the FIRE plate I land on across the chasm fires you in turn (a ball in the cup does too).',
  watchOut:
    'The CANNON never fires by itself: a ball resting inside waits, LOADED, until a ball rests on a FIRE plate. Move up close to the mount before you lob in; overshoot it and you drop into the chasm (+1, back to where you last stood). Whoever lands across rests on the far FIRE plate to fire the other (a ball in the cup does too).',
  mechanicsIntroduced: ['cannon'],
  firstPlayer: 0,
  cupHoldsSwitch: 'fire-far',
  width: 1960,
  wind: 0,
  terrain: {
    pieces: [
      terrainPiece(
        [
          [0, 620],
          [450, 620],
          [500, 640], // FIRE plate dish 450-650 near the tees
          [600, 640],
          [650, 620],
          [840, 620], // the approach: lob into the funnel from here
          [841, 540], // 80 px mount 841-960
          [890, 565], // sand funnel down to the breech 890-930
          [930, 565],
          [960, 540],
          [GAP_X1, 620],
        ],
        720,
      ),
      terrainPiece(
        [
          [GAP_X2, 400], // the plateau, 220 px above the near floor
          [1540, 400],
          [1560, 410], // landing bowl 1540-1740 (sand) carrying the far FIRE plate
          [1720, 410],
          [1740, 400],
          [1960, 400], // green, cup at 1870, back bunker 1920-1960
        ],
        720,
      ),
    ],
    gaps: [{ x1: GAP_X1, x2: GAP_X2 }],
  },
  props: [
    { kind: 'sand', id: 'funnel-l', x1: 841, x2: 889 },
    { kind: 'cannon', id: 'cannon', centerX: 910, w: 40, launch: { x: 400, y: -700 }, fireIds: ['fire', 'fire-far'], label: 'CANNON' },
    { kind: 'sand', id: 'funnel-r', x1: 931, x2: 960 },
    { kind: 'sand', id: 'landing', x1: 1540, x2: 1740 },
    { kind: 'sand', id: 'back-bunker', x1: 1920, x2: 1960 },
  ],
  switches: [
    { id: 'fire', centerX: 550, w: 100, colour: SWITCH_COLOUR, label: 'FIRE' }, // 500-600 on the dish floor
    { id: 'fire-far', centerX: 1640, w: 160, colour: SWITCH_COLOUR, label: 'FIRE' }, // 1560-1720 in the landing bowl
  ],
  holeX: 1870,
  startXs: [100, 150],
});
