// OWNER: levels
/**
 * World 1, hole 2 — TWO DOORS (LEVELS.md "Level 2"). One 420 px wall at x 900-940 carrying a
 * DOOR at its foot (opened by the DOOR plate in a dish on the tee side, the wall face being the
 * dish's far rim) and a WINDOW above it (opened by the WINDOW plate in the dish right behind the
 * wall, where a ball that rolls through the door stops). Teaches the HELD plate + blocker gate.
 * Red shoots first and holds first. A sunk ball holds the WINDOW from the cup (D2).
 *
 * Intended line (par 7): red parks on the DOOR plate -> blue rolls through the open door and
 * settles on the WINDOW plate -> red lobs through the window -> both approach the raised green.
 *
 * A back bunker 1740-1800 runs from 60 px behind the cup to the level edge: without it the edge
 * (WALL_RESTITUTION 0.45, 120 px behind the cup) banked 47 of 72 human-grid hole-outs from the hump at
 * 1395 back into the cup; with it 36 of those approaches stop in the sand to be pitched back and the
 * green gets putted (rests within 90 px of the cup 3 -> 17 of 162).
 */
import type { Level } from '../types';
import { SWITCH_COLOUR, compileLevel, terrainPiece } from './authoring';

const FLOOR = 620;
const WALL_X = 920;
const WALL_TOP = 200; // 420 px above the floor: no shot at 6.5 clears it
const WINDOW_TOP = 350;
const DOOR_TOP = 520;
const DOOR_FOOT = 640; // floor + WALL_EMBED_PX

export const level: Level = compileLevel({
  id: 'w1-02-two-doors',
  name: 'Two Doors',
  world: 1,
  order: 2,
  par: 7,
  hint: 'A plate works only while a ball is RESTING on it. Park on the DOOR plate for your partner, then they open the WINDOW for you from the far side.',
  aha: 'A plate is held, not pressed: the door shuts the moment you leave, so the crosser goes first while the holder waits, and the holder follows later through the window the crosser holds open.',
  watchOut:
    'The DOOR shuts the moment its plate is empty, so the holder stays put while the partner rolls through. The first ball through should settle on the WINDOW plate (a ball in the cup holds the WINDOW too). If you must shoot while holding, tap straight up at low power.',
  mechanicsIntroduced: ['switch'],
  firstPlayer: 0,
  cupHoldsSwitch: 'window',
  width: 1800,
  wind: 0,
  terrain: {
    pieces: [
      terrainPiece(
        [
          [0, FLOOR],
          [360, FLOOR],
          [460, 606], // gentle hump (14 px) between the tee and the DOOR dish
          [560, FLOOR],
          [690, FLOOR],
          [740, 640], // DOOR plate dish 690-900; far rim = the wall face at 900
          [850, 640],
          [900, FLOOR],
          [940, FLOOR],
          [990, 640], // WINDOW plate dish 940-1230, starts right behind the wall
          [1180, 640],
          [1230, FLOOR],
          [1320, FLOOR],
          [1400, 600], // hump (20 px) before the green
          [1480, FLOOR],
          [1540, FLOOR],
          [1600, 600],
          [1800, 600], // raised green 1600-1800, cup at 1680 (one full shot from the WINDOW plate)
        ],
        720,
      ),
    ],
    gaps: [],
  },
  props: [
    { kind: 'blocker', id: 'wall-cap', centerX: WALL_X, h: WINDOW_TOP - WALL_TOP, bottom: WINDOW_TOP },
    { kind: 'blocker', id: 'window-gate', centerX: WALL_X, h: DOOR_TOP - WINDOW_TOP, bottom: DOOR_TOP, switchId: 'window', activeWhen: false, label: 'WINDOW' },
    { kind: 'blocker', id: 'door-gate', centerX: WALL_X, h: DOOR_FOOT - DOOR_TOP, bottom: DOOR_FOOT, switchId: 'door', activeWhen: false, label: 'DOOR' },
    { kind: 'sand', id: 'back-bunker', x1: 1740, x2: 1800 },
  ],
  switches: [
    { id: 'door', centerX: 795, w: 110, colour: SWITCH_COLOUR, label: 'DOOR' }, // 740-850 on the dish floor
    { id: 'window', centerX: 1085, w: 190, colour: SWITCH_COLOUR, label: 'WINDOW' }, // 990-1180
  ],
  holeX: 1680,
  startXs: [100, 150],
});
