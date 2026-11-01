// OWNER: levels
/**
 * World 3, hole 11 — CROSSFIRE (worlds-2-3 LEVELS.md "Level 11", Appendix A; the DOOR rect is renamed
 * `door-gate`, D10.8). Introduces nothing: colour fields, cannon and door combined, World 1's Colour
 * Keys leapfrog fired through a cannon. Behind the tees a full-height BLUE field (230-270) guards the
 * FIRE ledge (0-200, 100 px up), so only blue can reach FIRE. Ahead of them a RED field (700-740)
 * stands on a DOOR (held by FAR) in front of the cannon pit, so only red can lob into the CANNON (breech
 * 780-840 at y 640, sand pit sides 741-779 / 841-899) until FAR opens the door. The cannon fires along
 * (440, -730) across a 560 px chasm (900-1460) into the FAR bowl on a plateau 220 px up. Red shoots
 * first. The cup holds FAR (D2).
 *
 * The pit's right side rises straight on to the chasm lip at (900, 610); Appendix A put a 20 px flat at
 * 880-900 (y 620) there. Blue gets right of the red field only through the door, which only FAR holds
 * open, so a ball resting on that flat when red left FAR was boxed in (door shut, cannon cold, FIRE and
 * FAR out of reach): a softlock the scoped reset cannot end. Now nothing between the door and the chasm
 * holds a resting ball but the breech, where the lit cannon fires it or the cold one LOADS it.
 *
 * Intended line (par 8): red moves up toward the red field (x 600-660) -> blue lobs LEFT through its
 * field onto the FIRE ledge (the cannon lights) -> red lobs through the red field into the pit and is
 * fired onto FAR (or waits LOADED until blue's landing fires it) -> FAR opens the door and keeps the
 * cannon lit; red putts out (the cup keeps FAR held) -> blue drops off the ledge, rolls through the
 * door into the cannon, is fired onto FAR and putts.
 *
 * Measured against the real sim (levels README "Launcher re-verification"): from every breech x
 * (0.5 px steps) and every +-3 % launch change, red (FIRE held) and blue (FIRE and FAR held) are fired
 * onto FAR and rest there with exactly one launch, fired on entry or LOADED.
 */
import type { Level } from '../types';
import { SWITCH_COLOUR, compileLevel, terrainPiece } from './authoring';

const GAP_X1 = 900;
const GAP_X2 = 1460;
const RED_X = 720; // the red field and its door span 700-740
const FIELD_TOP = 200;
const DOOR_TOP = 520;
const DOOR_FOOT = 640; // floor + WALL_EMBED_PX

export const level: Level = compileLevel({
  id: 'w3-11-crossfire',
  name: 'Crossfire',
  world: 3,
  order: 11,
  par: 8,
  hint: 'Only red gets through the RED field into the CANNON, and only blue reaches FIRE behind the BLUE field. Red lands on FAR, which opens the DOOR so blue can roll in.',
  aha: "The colours pick the roles: only red can load the cannon and only blue can reach FIRE, and red's landing plate opens the door that lets blue into the same cannon.",
  watchOut:
    'Blue bounces off the red field, so only red can load the CANNON, and only blue gets through the blue field onto FIRE. Red, move up close to the red field before you lob into the cannon pit. Once red lands on FAR the DOOR opens, so blue can roll straight into the cannon (a ball in the cup holds FAR too).',
  mechanicsIntroduced: [],
  firstPlayer: 0,
  cupHoldsSwitch: 'far',
  width: 1960,
  wind: 0,
  terrain: {
    pieces: [
      terrainPiece(
        [
          [0, 520], // FIRE ledge 0-200, 100 px above the floor
          [40, 520],
          [60, 530], // FIRE plate dish, floor 60-180
          [180, 530],
          [200, 520],
          [201, 620], // floor: blue field at 230-270, tees 420 / 470, red field + door at 700-740
          [740, 620],
          [780, 640], // cannon pit: sand sides 741-779 / 841-899, breech 780-840
          [840, 640],
          [GAP_X1, 610], // the right side runs on to the chasm lip: no restable flat right of the door
        ],
        720,
      ),
      terrainPiece(
        [
          [GAP_X2, 400], // the plateau, 220 px up
          [1480, 400],
          [1500, 412], // FAR bowl 1480-1720 (sand)
          [1700, 412],
          [1720, 400],
          [1960, 400], // green, cup at 1860, back bunker 1910-1960
        ],
        720,
      ),
    ],
    gaps: [{ x1: GAP_X1, x2: GAP_X2 }],
  },
  props: [
    { kind: 'colourGate', id: 'blue-field', centerX: 250, h: 440, bottom: 640, colour: 'blue' },
    { kind: 'colourGate', id: 'red-field', centerX: RED_X, h: DOOR_TOP - FIELD_TOP, bottom: DOOR_TOP, colour: 'red' },
    { kind: 'blocker', id: 'door-gate', centerX: RED_X, h: DOOR_FOOT - DOOR_TOP, bottom: DOOR_FOOT, switchIds: ['far'], activeWhen: false, label: 'DOOR' },
    { kind: 'sand', id: 'pit-l', x1: 741, x2: 779 },
    { kind: 'cannon', id: 'cannon', centerX: 810, w: 60, launch: { x: 440, y: -730 }, fireIds: ['fire', 'far'], label: 'CANNON' },
    { kind: 'sand', id: 'pit-r', x1: 841, x2: 899 },
    { kind: 'sand', id: 'landing', x1: 1480, x2: 1720 },
    { kind: 'sand', id: 'back-bunker', x1: 1910, x2: 1960 },
  ],
  switches: [
    { id: 'fire', centerX: 120, w: 120, colour: SWITCH_COLOUR, label: 'FIRE' }, // 60-180 on the ledge
    { id: 'far', centerX: 1600, w: 200, colour: SWITCH_COLOUR, label: 'FAR' }, // 1500-1700 on the bowl floor
  ],
  holeX: 1860,
  startXs: [420, 470],
});
