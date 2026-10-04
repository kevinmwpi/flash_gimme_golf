// OWNER: levels
/**
 * World 1, hole 3 — COLOUR KEYS (LEVELS.md "Level 3"). Two walls, each a colour field over a
 * plated door. The plate that opens DOOR 1 sits BEHIND wall 1 and only blue can fly there (blue
 * field); the plate that opens DOOR 2 sits behind wall 2 and only red can fly there (red field).
 * Blue unlocks red, red unlocks blue, and the colours fix the order: BLUE shoots first.
 * A sunk ball holds DOOR 2 from the cup (D2). Teaches the colour gate.
 *
 * Intended line (par 8; LEVELS.md said 9, see README "Pars"): blue lobs through the blue field onto the DOOR 1 plate -> red rolls
 * through door 1 and finishes near wall 2 -> blue moves up -> red lobs the red field onto the
 * DOOR 2 plate -> blue rolls through door 2 -> both chip to the green.
 *
 * A back bunker 1800-1860 runs from 60 px behind the cup to the level edge: without it the edge
 * (WALL_RESTITUTION 0.45, 120 px behind the cup) banked 36 of 56 human-grid hole-outs from the DOOR 2
 * plate back into the cup; with it 32 of those approaches stop in the sand to be pitched back and the
 * green gets putted (rests within 90 px of the cup 3 -> 19 of 162).
 */
import type { Level } from '../types';
import { SWITCH_COLOUR, compileLevel, terrainPiece } from './authoring';

const FLOOR = 620;
const WALL1_X = 460; // wall 1 spans 440-480
const WALL2_X = 1180; // wall 2 spans 1160-1200
const FIELD_TOP = 200; // 420 px above the floor
const DOOR_TOP = 520;
const DOOR_FOOT = 640; // floor + WALL_EMBED_PX

export const level: Level = compileLevel({
  id: 'w1-03-colour-keys',
  name: 'Colour Keys',
  world: 1,
  order: 3,
  par: 8,
  hint: 'Blue: lob over the door, through the blue field, and rest on the plate behind it: that opens DOOR 1 for red. Red: roll through low, then lob the red field onto the plate that opens DOOR 2 for blue.',
  aha: 'The plate that opens MY door is behind YOUR colour of field: blue unlocks red at wall 1, red unlocks blue at wall 2, and the colours dictate who goes first (blue) - a leapfrog, not a race.',
  watchOut:
    'Red cannot lob wall 1: the blue field bounces red, so red rolls through DOOR 1 low while blue holds. Lob the red field from close to wall 2, not from the tee side. If red leaves the DOOR 2 plate early, red can come back through its own field, and a sunk red holds DOOR 2 from the cup.',
  mechanicsIntroduced: ['colourGate'],
  firstPlayer: 1,
  cupHoldsSwitch: 'door2',
  width: 1860,
  wind: 0,
  terrain: {
    pieces: [
      terrainPiece(
        [
          [0, FLOOR], // wall 1 stands at 440-480 on this flat, 290 px from blue's tee
          [650, FLOOR],
          [700, 640], // DOOR 1 plate bowl 650-1050, behind wall 1: where a tee lob through the field rests
          [1000, 640],
          [1050, FLOOR], // wall 2 stands at 1160-1200 on this flat
          [1220, FLOOR],
          [1270, 640], // DOOR 2 plate bowl 1220-1610, behind wall 2: where red's field lob lands
          [1560, 640],
          [1610, FLOOR],
          [1660, 600],
          [1720, 596],
          [1860, 596], // green 1660-1860, cup at 1740
        ],
        720,
      ),
    ],
    gaps: [],
  },
  props: [
    { kind: 'colourGate', id: 'wall-1-field', centerX: WALL1_X, h: DOOR_TOP - FIELD_TOP, bottom: DOOR_TOP, colour: 'blue' },
    { kind: 'blocker', id: 'door-1-gate', centerX: WALL1_X, h: DOOR_FOOT - DOOR_TOP, bottom: DOOR_FOOT, switchId: 'door1', activeWhen: false, label: 'DOOR 1' },
    { kind: 'colourGate', id: 'wall-2-field', centerX: WALL2_X, h: DOOR_TOP - FIELD_TOP, bottom: DOOR_TOP, colour: 'red' },
    { kind: 'blocker', id: 'door-2-gate', centerX: WALL2_X, h: DOOR_FOOT - DOOR_TOP, bottom: DOOR_FOOT, switchId: 'door2', activeWhen: false, label: 'DOOR 2' },
    { kind: 'sand', id: 'back-bunker', x1: 1800, x2: 1860 },
  ],
  switches: [
    { id: 'door1', centerX: 850, w: 300, colour: SWITCH_COLOUR, label: 'DOOR 1' }, // 700-1000 on the bowl floor
    { id: 'door2', centerX: 1415, w: 290, colour: SWITCH_COLOUR, label: 'DOOR 2' }, // 1270-1560
  ],
  holeX: 1740,
  startXs: [100, 150],
});
