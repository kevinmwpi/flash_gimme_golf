// OWNER: levels
/**
 * World 2, hole 8 — COLOUR LIFT (worlds-2-3 LEVELS.md "Level 8", Appendix A; the WINDOW and DOOR
 * rects are renamed `window-gate` / `door-gate` because rect and switch ids are disjoint, D10.8). The
 * World 2 exam: it introduces nothing and combines the spring, the colour fields and doors. Wall 1
 * (200-240) is a floor-level BLUE field (440-640) under a WINDOW (320-440, held by the WINDOW plate)
 * under a permanent cap (200-320). Behind it a hopper slopes down to one SPRING (702-758) that throws
 * every ball at wall 2 (1200-1240) on a plateau 320 px up: a RED field from y -220 (off the top of the
 * screen, so blue can never lob over it) down to y 200, over a DOOR (200-320, held by the DOOR plate).
 * Blue bounces off the red field back onto the WINDOW plate; red flies through it onto the DOOR plate.
 * Blue shoots first. The cup holds DOOR (D2).
 *
 * Intended line (par 8): blue lobs through its own field into the hopper, rides the spring, bounces off
 * the red wall and lands on WINDOW -> red lobs through the open window from a few steps back (blue
 * stall-taps if red misses), rides the spring through the red wall onto DOOR -> blue rolls through the
 * open door -> both chip down to the terrace green and putt.
 *
 * Measured against the real sim (levels README "Launcher re-verification"): from every pad x (0.5 px
 * steps) and every +-3 % launch change the spring sorts the colours: blue rests on WINDOW and red rests
 * on DOOR, with exactly one launch each.
 */
import type { Level } from '../types';
import { SWITCH_COLOUR, compileLevel, terrainPiece } from './authoring';

const WALL1_X = 220; // wall 1 spans 200-240
const WALL2_X = 1220; // wall 2 spans 1200-1240

export const level: Level = compileLevel({
  id: 'w2-08-colour-lift',
  name: 'Colour Lift',
  world: 2,
  order: 8,
  par: 8,
  hint: 'Blue lobs through its own field into the SPRING pit and bounces back onto the WINDOW plate. Red then lobs through the open WINDOW and flies through the red wall onto the DOOR plate.',
  aha: 'One spring, two colours: the red wall up top bounces blue back onto the plate that opens the WINDOW for red, and lets red fly through onto the plate that opens the DOOR for blue.',
  watchOut:
    'Blue bouncing back off the red wall is the plan: it lands on the WINDOW plate. Red lobs through the open WINDOW from a few steps back; if red misses, blue taps straight up at low power to keep holding. Red landing on the DOOR plate opens the door for blue (a ball in the cup holds the DOOR too).',
  mechanicsIntroduced: [],
  firstPlayer: 1,
  cupHoldsSwitch: 'door',
  width: 1960,
  wind: 0,
  terrain: {
    pieces: [
      terrainPiece(
        [
          [0, 620], // tees at 80 / 130
          [240, 620],
          [241, 560], // hopper rim right behind wall 1
          [702, 620], // slopes 0.13 down to the spring pad 702-758
          [758, 620],
          [940, 560],
          [1000, 560],
          [1001, 300], // 320 px cliff up to the plateau
          [1020, 300],
          [1050, 320], // WINDOW bowl 1020-1180 (sand)
          [1150, 320],
          [1180, 300],
          [1260, 300], // wall 2 stands at 1200-1240 on this flat
          [1390, 300],
          [1420, 320], // DOOR bowl 1390-1630 (sand)
          [1600, 320],
          [1630, 300],
          [1680, 300],
          [1681, 460], // 160 px drop to the terrace
          [1960, 460], // terrace green, cup at 1840, back bunker 1910-1960
        ],
        720,
      ),
    ],
    gaps: [],
  },
  props: [
    { kind: 'blocker', id: 'wall-cap', centerX: WALL1_X, h: 120, bottom: 320 },
    { kind: 'blocker', id: 'window-gate', centerX: WALL1_X, h: 120, bottom: 440, switchIds: ['window'], activeWhen: false, label: 'WINDOW' },
    { kind: 'colourGate', id: 'blue-field', centerX: WALL1_X, h: 200, bottom: 640, colour: 'blue' },
    { kind: 'spring', id: 'spring', centerX: 730, w: 56, launch: { x: 380, y: -780 }, label: 'SPRING' },
    { kind: 'sand', id: 'window-sand', x1: 1040, x2: 1160 },
    { kind: 'colourGate', id: 'red-field', centerX: WALL2_X, h: 420, bottom: 200, colour: 'red' },
    { kind: 'blocker', id: 'door-gate', centerX: WALL2_X, h: 120, bottom: 320, switchIds: ['door'], activeWhen: false, label: 'DOOR' },
    { kind: 'sand', id: 'door-sand', x1: 1410, x2: 1610 },
    { kind: 'sand', id: 'back-bunker', x1: 1910, x2: 1960 },
  ],
  switches: [
    { id: 'window', centerX: 1100, w: 100, colour: SWITCH_COLOUR, label: 'WINDOW' }, // 1050-1150 on the bowl floor
    { id: 'door', centerX: 1510, w: 180, colour: SWITCH_COLOUR, label: 'DOOR' }, // 1420-1600 on the bowl floor
  ],
  holeX: 1840,
  startXs: [80, 130],
});
