// OWNER: levels
/**
 * World 3, hole 9 — BAIT (worlds-2-3 LEVELS.md "Level 9", Appendix A; the DOOR rect is renamed
 * `door-gate`, D10.8). Introduces nothing: trap, spring and door combined, and the trap learnt as a
 * hazard on hole 6 becomes a tool. A sunken channel (490-760, floor 640) runs under a wall at 650-690
 * (top y 200) whose DOOR stands flush on the channel floor (D10.12). The BAIT plate (490-610) that holds the
 * door sits INSIDE a trap (480-610 x 590-640, released only by TOP): whoever rests there is caught,
 * which hands every turn to the partner. The plate covers the trap's whole restable floor (480-490 is the
 * 0.4 ramp): with Appendix A's 490-600 plate, a ball resting at 600-610 was caught WITHOUT holding the
 * door, and its partner on the tee side could never reach TOP or the cup, a softlock the scoped reset
 * cannot end because the partner can still shoot (the solver's traps pass found it: 174 of 2,639 low
 * shots from red's tee stopped in that strip). Past the door a sandy yard leads to a raised SPRING mouth (the
 * pad 976-1040 on a 40 px plinth at y 580, behind a 16 px back lip) that lifts a ball 360 px onto TOP on
 * the summit; TOP frees the bait and holds the door. Red shoots first. The cup holds TOP (D2).
 *
 * Intended line (par 8): red rolls onto BAIT and is caught (the door opens) -> blue rolls through the
 * door past red into the yard -> blue lobs into the raised spring mouth (as many tries as it takes: red
 * is caught, so blue keeps the turn) and lands on TOP, freeing red -> red rolls out through the door
 * and makes the same lob -> both chip down to the terrace green and putt.
 *
 * Measured against the real sim (levels README "Launcher re-verification"): the spring throws a ball
 * onto TOP from every pad x (0.5 px steps) for every +-3 % launch change, exactly one launch each; with
 * nobody on BAIT or TOP the shut door stops every human-grid shot from both tees.
 */
import type { Level } from '../types';
import { SWITCH_COLOUR, compileLevel, terrainPiece } from './authoring';

const WALL_X = 670; // the wall spans 650-690
const WALL_TOP = 200;
const DOOR_TOP = 520;
const CHANNEL_FLOOR = 640; // the door stands flush on it

export const level: Level = compileLevel({
  id: 'w3-09-bait',
  name: 'Bait',
  world: 3,
  order: 9,
  par: 8,
  hint: 'The BAIT plate opens the DOOR, but it sits in a TRAP: whoever rests there is caught and skips turns. Take the bait on purpose; your partner climbs the SPRING to TOP, which frees you.',
  aha: 'Getting caught is the plan: the ball in the trap holds the door and hands every turn to its partner, who takes as many shots as the raised spring needs and then frees the bait from the top.',
  watchOut:
    'Resting on BAIT gets you caught on purpose: the door stays open and every turn goes to your partner, who rolls through and lobs into the raised SPRING mouth as many times as it takes. Landing on TOP frees the bait and still holds the door, so the bait rolls out and climbs next (a ball in the cup holds TOP too).',
  mechanicsIntroduced: [],
  firstPlayer: 0,
  cupHoldsSwitch: 'top',
  width: 1960,
  wind: 0,
  terrain: {
    pieces: [
      terrainPiece(
        [
          [0, 620], // tees at 100 / 150
          [440, 620],
          [490, CHANNEL_FLOOR], // sunken channel 490-760 runs under the wall at 650-690
          [760, CHANNEL_FLOOR],
          [800, 620],
          [960, 620], // sandy yard 820-950
          [961, 564], // raised spring mouth: the back lip, 16 px above the pad ...
          [968, 564],
          [976, 580], // ... then the pad 976-1040 on a 40 px plinth, open on the muzzle side
          [1040, 580],
          [1041, 620],
          [1240, 620],
          [1241, 260], // 360 px cliff up to the summit
          [1260, 260],
          [1290, 280], // TOP bowl 1260-1480 (sand 1270-1470)
          [1450, 280],
          [1480, 260],
          [1560, 260],
          [1561, 440], // drop to the terrace
          [1960, 440], // terrace green, cup at 1840, back bunker 1910-1960
        ],
        720,
      ),
    ],
    gaps: [],
  },
  props: [
    { kind: 'trap', id: 'bait-trap', x: 480, y: 590, w: 130, h: 50, releaseIds: ['top'], label: 'TRAP' },
    { kind: 'blocker', id: 'wall-cap', centerX: WALL_X, h: DOOR_TOP - WALL_TOP, bottom: DOOR_TOP },
    { kind: 'blocker', id: 'door-gate', centerX: WALL_X, h: CHANNEL_FLOOR - DOOR_TOP, bottom: CHANNEL_FLOOR, switchIds: ['bait', 'top'], activeWhen: false, label: 'DOOR' },
    { kind: 'sand', id: 'yard-sand', x1: 820, x2: 950 },
    { kind: 'spring', id: 'spring', centerX: 1008, w: 64, launch: { x: 200, y: -740 }, label: 'SPRING' },
    { kind: 'sand', id: 'top-sand', x1: 1270, x2: 1470 },
    { kind: 'sand', id: 'back-bunker', x1: 1910, x2: 1960 },
  ],
  switches: [
    { id: 'bait', centerX: 550, w: 120, colour: SWITCH_COLOUR, label: 'BAIT' }, // 490-610: the trap's whole restable floor (no caught-but-not-holding strip)
    { id: 'top', centerX: 1370, w: 140, colour: SWITCH_COLOUR, label: 'TOP' }, // 1300-1440 on the bowl floor
  ],
  holeX: 1840,
  startXs: [100, 150],
});
