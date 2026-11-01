// OWNER: levels
/**
 * World 2, hole 6 — BOOBY TRAP (worlds-2-3 LEVELS.md "Level 6", Appendix A verbatim; the lead's
 * LevelDef conversion in CONTRACT §6). The plate that opens the DOOR sits in the bowl of a 160 px PERCH
 * BEHIND the tees, with a backboard rising 120 px behind the bowl (the design's backstop that makes the
 * leftward lob fair). A short lob rolls down into the TRAP dish at the perch's foot: the steel jaws
 * (350-450 x 560-640) catch a ball that comes to REST there, its turns go to its partner (the WAITING
 * rule), and it is freed where it sits while a ball rests on FREE (the dish 80-170 px right of the
 * tees) or on FAR (behind the door), or a ball is in the cup. Teaches the TRAP as a hazard that
 * punishes a missed precision shot; red shoots first. The cup holds FAR (D2).
 *
 * Intended line (par 6): red lobs LEFT onto the perch (PERCH opens the DOOR) -> blue rolls through the
 * door into the FAR dish (FAR holds the door and also opens the trap) -> red drops off the perch and
 * rolls through -> both putt out about 400 px. With one rescue: red falls short and is caught -> blue
 * rolls onto FREE -> red, freed where it sits, lobs back up almost vertically -> as above.
 *
 * The 420 px wall stands at 980-1020 (cap 200-520 over the DOOR 520-640). Measured against the real
 * sim (levels README): with nobody on PERCH or FAR the shut door stops every human-grid shot from both
 * tees, and a ball dropped into the trap dish comes to rest inside the jaws.
 */
import type { Level } from '../types';
import { SWITCH_COLOUR, compileLevel, terrainPiece } from './authoring';

const FLOOR = 620;
const WALL_X = 1000; // the wall spans 980-1020
const WALL_TOP = 200; // 420 px above the floor
const DOOR_TOP = 520;
const DOOR_FOOT = 640; // floor + WALL_EMBED_PX

export const level: Level = compileLevel({
  id: 'w2-06-booby-trap',
  name: 'Booby Trap',
  world: 2,
  order: 6,
  par: 6,
  hint: 'Lob onto the PERCH behind you: a ball resting in its bowl opens the DOOR. Fall short and the TRAP at its foot holds you until your partner rests on FREE.',
  aha: 'A trap pauses you, it does not end you: if I am caught under the perch, you roll onto FREE and I get another try, and once I am up there my perch holds the door while you go through.',
  watchOut:
    'Fall short of the PERCH and the TRAP at its foot catches you: your turns go to your partner until a ball rests on FREE or FAR, or one is in the cup. Once freed, lob back up from the trap almost straight up. If nobody can shoot, the ball that moved last goes back to where it last stood free, +1.',
  mechanicsIntroduced: ['trap'],
  firstPlayer: 0,
  cupHoldsSwitch: 'far',
  width: 1700,
  wind: 0,
  terrain: {
    pieces: [
      terrainPiece(
        [
          [0, FLOOR],
          [160, FLOOR],
          [161, 460], // the 160 px perch 160-340
          [170, 460],
          [200, 484], // PERCH bowl 170-330, floor 200-300
          [300, 484],
          [330, 460],
          [340, 460],
          [341, FLOOR],
          [360, FLOOR],
          [390, 640], // trap dish 360-460 at the perch's foot (jaws 350-450 x 560-640)
          [430, 640],
          [460, FLOOR],
          [640, FLOOR], // tees at 540 / 590
          [670, 636], // FREE dish 640-790
          [760, 636],
          [790, FLOOR],
          [1040, FLOOR],
          [1090, 640], // FAR dish 1040-1290, right behind the wall at 980-1020
          [1240, 640],
          [1290, FLOOR],
          [1360, FLOOR],
          [1420, 604], // hump (16 px)
          [1470, FLOOR],
          [1500, FLOOR],
          [1540, 600],
          [1700, 600], // green 1540-1700, cup at 1600, back bunker 1650-1700
        ],
        720,
      ),
    ],
    gaps: [],
  },
  props: [
    { kind: 'blocker', id: 'backboard', centerX: 172, w: 20, h: 140, bottom: 480 }, // x 162-182, 120 px above the perch
    { kind: 'trap', id: 'snare', x: 350, y: 560, w: 100, h: 80, releaseIds: ['free', 'far'], label: 'TRAP' },
    { kind: 'blocker', id: 'wall-cap', centerX: WALL_X, h: DOOR_TOP - WALL_TOP, bottom: DOOR_TOP },
    { kind: 'blocker', id: 'door-gate', centerX: WALL_X, h: DOOR_FOOT - DOOR_TOP, bottom: DOOR_FOOT, switchIds: ['perch', 'far'], activeWhen: false, label: 'DOOR' },
    { kind: 'sand', id: 'back-bunker', x1: 1650, x2: 1700 },
  ],
  switches: [
    { id: 'perch', centerX: 250, w: 100, colour: SWITCH_COLOUR, label: 'PERCH' }, // 200-300 on the bowl floor
    { id: 'free', centerX: 715, w: 90, colour: SWITCH_COLOUR, label: 'FREE' }, // 670-760
    { id: 'far', centerX: 1165, w: 150, colour: SWITCH_COLOUR, label: 'FAR' }, // 1090-1240
  ],
  holeX: 1600,
  startXs: [540, 590],
});
