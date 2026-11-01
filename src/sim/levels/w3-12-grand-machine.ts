// OWNER: levels
/**
 * World 3, hole 12 — GRAND MACHINE (worlds-2-3 LEVELS.md "Level 12", Appendix A; the DOOR rect is
 * renamed `door-gate`, D10.8). The finale introduces nothing: cannon, spring, trap and door combined,
 * with two co-op machines up to a 300 px summit. FLY: a CANNON on a mount at the far left (breech
 * 100-140 at y 565 in a sand funnel 41-99 / 141-199) fires along (700, -760) while a ball rests on FIRE
 * (the dish 420-600) or TOP; overshoot the mount and the pit behind it (0-40) is a TRAP (12-40 x
 * 590-640) released by FIRE or TOP. CLIMB: a sunken seat channel (680-1180, floor 640) runs under a
 * wall at 820-860 (top y 200) whose DOOR stands flush on the channel floor (D10.12); the DOOR plate (680-780)
 * sits inside a TRAP (680-780 x 590-640, released only by TOP), so the holder is caught and its partner
 * gets every turn to roll through to the SPRING (972-1028) that lifts it onto TOP. TOP is one long sand
 * basin (plate 1230-1680) that holds the door, lights the cannon and frees both traps. Red shoots
 * first. The cup holds TOP (D2), so the second ball can always take either route.
 *
 * Intended lines (par 7): FLY - red lobs LEFT into the cannon and waits, LOADED -> blue rests on FIRE
 * and red is fired onto TOP -> blue lobs LEFT into the cannon (TOP keeps it lit) and flies up -> both
 * chip down to the green and putt. CLIMB - red rolls onto the DOOR plate and is caught (the door opens)
 * -> blue rolls through to the spring and lands on TOP, freeing red -> red rolls through and climbs ->
 * both chip down and putt.
 *
 * Measured against the real sim (levels README "Launcher re-verification"): from every breech x
 * (0.5 px steps) and every +-3 % launch change the cannon (FIRE held) lands a ball on TOP, fired on
 * entry or LOADED, and from every pad x the spring (DOOR held) does too, exactly one launch each; with
 * the door shut, low rolls along the seat channel never pass the flush-footed door.
 */
import type { Level } from '../types';
import { SWITCH_COLOUR, compileLevel, terrainPiece } from './authoring';

const WALL_X = 840; // the wall spans 820-860
const WALL_TOP = 200;
const DOOR_TOP = 520;
const CHANNEL_FLOOR = 640; // the door stands flush on it

export const level: Level = compileLevel({
  id: 'w3-12-grand-machine',
  name: 'Grand Machine',
  world: 3,
  order: 12,
  par: 7,
  hint: 'Two ways up: lob LEFT into the CANNON while your partner rests on FIRE, or ride the SPRING behind the DOOR while your partner sits in its TRAP. TOP opens everything for the second ball.',
  aha: 'Every way up needs the other ball, so we choose: I fly while you hold FIRE, or I climb while you sit in the door trap, and whoever lands on TOP opens both machines for the other.',
  watchOut:
    'Overshoot the CANNON and the pit TRAP behind it holds you until a ball rests on FIRE or TOP; then lob back in. The other way up: one ball sits on the DOOR plate in its TRAP to hold the door while the other rolls through to the SPRING. Whoever lands on TOP opens the door, lights the cannon and frees both traps (a ball in the cup does too).',
  mechanicsIntroduced: [],
  firstPlayer: 0,
  cupHoldsSwitch: 'top',
  width: 1960,
  wind: 0,
  terrain: {
    pieces: [
      terrainPiece(
        [
          [0, 640], // the pit 0-40 behind the mount
          [40, 640],
          [41, 540], // cannon mount 41-200, top 540
          [100, 565], // sand funnel down to the breech 100-140
          [140, 565],
          [200, 540],
          [201, 620],
          [420, 620], // tees at 300 / 350
          [460, 640], // FIRE dish 420-600
          [560, 640],
          [600, 620],
          [640, 620],
          [680, CHANNEL_FLOOR], // seat channel 680-1180 under the wall at 820-860; spring pad 972-1028
          [1180, CHANNEL_FLOOR],
          [1181, 320], // the cliff up to the summit
          [1200, 320],
          [1215, 334], // TOP basin 1215-1690 (sand 1205-1690)
          [1690, 334],
          [1691, 300], // the basin's dirt face
          [1730, 300],
          [1731, 400], // step down to the green
          [1960, 400], // green, cup at 1850, back bunker 1900-1960
        ],
        720,
      ),
    ],
    gaps: [],
  },
  props: [
    { kind: 'trap', id: 'pit', x: 12, y: 590, w: 28, h: 50, releaseIds: ['fire', 'top'], label: 'TRAP' },
    { kind: 'sand', id: 'funnel-l', x1: 41, x2: 99 },
    { kind: 'cannon', id: 'cannon', centerX: 120, w: 40, launch: { x: 700, y: -760 }, fireIds: ['fire', 'top'], label: 'CANNON' },
    { kind: 'sand', id: 'funnel-r', x1: 141, x2: 199 },
    { kind: 'trap', id: 'door-seat', x: 680, y: 590, w: 100, h: 50, releaseIds: ['top'], label: 'TRAP' },
    { kind: 'blocker', id: 'wall-cap', centerX: WALL_X, h: DOOR_TOP - WALL_TOP, bottom: DOOR_TOP },
    { kind: 'blocker', id: 'door-gate', centerX: WALL_X, h: CHANNEL_FLOOR - DOOR_TOP, bottom: CHANNEL_FLOOR, switchIds: ['door', 'top'], activeWhen: false, label: 'DOOR' },
    { kind: 'spring', id: 'spring', centerX: 1000, w: 56, launch: { x: 180, y: -800 }, label: 'SPRING' },
    { kind: 'sand', id: 'top-sand', x1: 1205, x2: 1690 },
    { kind: 'sand', id: 'back-bunker', x1: 1900, x2: 1960 },
  ],
  switches: [
    { id: 'fire', centerX: 510, w: 100, colour: SWITCH_COLOUR, label: 'FIRE' }, // 460-560 on the dish floor
    { id: 'door', centerX: 730, w: 100, colour: SWITCH_COLOUR, label: 'DOOR' }, // 680-780, inside the door-seat trap
    { id: 'top', centerX: 1455, w: 450, colour: SWITCH_COLOUR, label: 'TOP' }, // 1230-1680 in the basin
  ],
  holeX: 1850,
  startXs: [300, 350],
});
