// OWNER: levels
/**
 * World 2, hole 5 — SPRING STEP (worlds-2-3 LEVELS.md "Level 5", Appendix A verbatim). The tees face a
 * 380 px cliff that no hand shot can climb (a hand shot rises at most 341 px). The SPRING at its foot
 * throws any ball that touches it up onto the plateau, but it sits behind a 420 px wall at x 650-690
 * whose DOOR is held by the DOOR plate (in the dish whose far rim is the wall face) OR by TOP (the plate
 * in the bowl on the plateau where the spring's throw comes down). Teaches the SPRING; red shoots first
 * and holds first. A sunk ball holds TOP from the cup (D2), so the first ball home keeps the door open.
 *
 * Intended line (par 7): red parks on the DOOR plate -> blue rolls through the open door onto the
 * spring and lands on TOP, which holds the door from above -> red leaves its plate, rolls through and
 * rides up -> both chip 180 px down to the terrace green and putt.
 *
 * Measured against the real sim (levels README "Launcher re-verification"): the spring throws a ball
 * onto TOP from every pad x (0.5 px steps) for every +-3 % launch change, exactly one launch each, for
 * both colours; with nobody on DOOR or TOP the shut door stops every human-grid shot from both tees.
 */
import type { Level } from '../types';
import { SWITCH_COLOUR, compileLevel, terrainPiece } from './authoring';

const FLOOR = 620;
const WALL_X = 670; // the wall spans 650-690
const WALL_TOP = 200; // 420 px above the floor
const DOOR_TOP = 520;
const DOOR_FOOT = 640; // floor + WALL_EMBED_PX

export const level: Level = compileLevel({
  id: 'w2-05-spring-step',
  name: 'Spring Step',
  world: 2,
  order: 5,
  par: 7,
  hint: 'The SPRING throws any ball that touches it up the cliff, but it sits behind the DOOR. Park on the DOOR plate for your partner: they land on TOP, which holds the door open for you.',
  aha: 'The spring does the climbing and the plates do the teamwork: I hold the DOOR from below, you land on TOP and hold it from above, and the same spring carries me up after you.',
  watchOut:
    'The wall is too tall to lob over: park one ball on the DOOR plate and roll the other through the open door onto the SPRING. The ball that lands on TOP holds the door from above, so it should wait there until the DOOR holder has ridden up too (a ball in the cup holds TOP as well).',
  mechanicsIntroduced: ['spring'],
  firstPlayer: 0,
  cupHoldsSwitch: 'top',
  width: 1800,
  wind: 0,
  terrain: {
    pieces: [
      terrainPiece(
        [
          [0, FLOOR],
          [440, FLOOR],
          [490, 640], // DOOR plate dish 440-650; its far rim meets the wall face at 650
          [600, 640],
          [650, FLOOR],
          [1080, FLOOR], // the spring pad (862-918) sits on this flat
          [1081, 240], // the 380 px cliff
          [1200, 240],
          [1250, 264], // TOP bowl 1200-1410: where the spring's throw comes down
          [1370, 264],
          [1410, 240],
          [1460, 240],
          [1461, 440], // 200 px drop to the terrace
          [1800, 440], // terrace green, cup at 1690, back bunker 1750-1800
        ],
        720,
      ),
    ],
    gaps: [],
  },
  props: [
    { kind: 'blocker', id: 'wall-cap', centerX: WALL_X, h: DOOR_TOP - WALL_TOP, bottom: DOOR_TOP },
    { kind: 'blocker', id: 'door-gate', centerX: WALL_X, h: DOOR_FOOT - DOOR_TOP, bottom: DOOR_FOOT, switchIds: ['door', 'top'], activeWhen: false, label: 'DOOR' },
    { kind: 'spring', id: 'spring', centerX: 890, w: 56, launch: { x: 150, y: -800 }, label: 'SPRING' },
    { kind: 'sand', id: 'back-bunker', x1: 1750, x2: 1800 },
  ],
  switches: [
    { id: 'door', centerX: 545, w: 110, colour: SWITCH_COLOUR, label: 'DOOR' }, // 490-600 on the dish floor
    { id: 'top', centerX: 1310, w: 120, colour: SWITCH_COLOUR, label: 'TOP' }, // 1250-1370 on the bowl floor
  ],
  holeX: 1690,
  startXs: [100, 150],
});
