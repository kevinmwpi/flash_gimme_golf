// OWNER: levels
/**
 * World 1, hole 1 — FIRST FAIRWAY (LEVELS.md "Level 1"). One unmoving 1280 px screen: a hill with a
 * shelf behind its crest, a bunker under the shelf's lip where a lazy full drive lands, and a raised
 * green with a second bunker behind the cup. Teaches aim + power, the cup, the gimme and turn order;
 * the one mechanic is SAND. Red shoots first.
 *
 * Geometry decisions, all verified at SHOT_SPEED_PER_POWER 6.5 against the real sim (scripts/solver.ts):
 * - LEVELS.md's straight 540 -> 840 downslope was replaced by an 18 px drop onto a flat SHELF 580-810.
 *   Every segment of the old slope was steeper than the friction-equivalent slope
 *   (ROLL_FRICTION / (GRAVITY * SLOPE_GRAVITY_SCALE) = tan 0.114), so no ball could rest between the
 *   crest and the sand and the "3/4 swing lays up" beat did not exist. On the shelf a 3/4 swing
 *   (power 69-77 at 10-45 deg) stops short of the sand; a full swing still rolls off the lip into the
 *   bunker and stops dead; a soft swing still rests on the hill.
 * - The bunker is 800-1010: it starts 10 px before the lip at 810 so the lip has sand restitution. A
 *   grass lip let a 26-27 deg full drive from the blue tee skip once off it, clear the sand and run in
 *   (1 ace in 858); with the sandy lip aces are 0/858 from both tees.
 * - A back bunker 1240-1280 runs from the green to the level edge. Without it the right level edge
 *   (WALL_RESTITUTION 0.45, 90 px behind the cup) returned 45 of 70 human-grid hole-outs from the
 *   sand as bank-ins and only 3/162 approaches rested within 90 px of the cup; with it the approach
 *   from the sand sinks 40/162, rests within 90 px 33/162 and 26/162 stop in the back sand to be
 *   pitched back. The finishing beat is "approach, then putt", not "slam the back wall".
 * 1110 px tee-to-cup; LEVELS.md tees 90 / 130 became 90 / 140 (MIN_TEE_SEPARATION 50).
 */
import type { Level } from '../types';
import { compileLevel, terrainPiece } from './authoring';

export const level: Level = compileLevel({
  id: 'w1-01-first-fairway',
  name: 'First Fairway',
  world: 1,
  order: 1,
  par: 6,
  hint: 'Pull back from your ball and let go. Sand stops a rolling ball dead, so pitch over the bunker.',
  aha: 'Power is distance: a full swing carries over the hill and runs into the bunker, a three-quarter swing stops on the shelf short of it, and a short pitch over the sand lands on the green where a ball that stops next to the cup is conceded (GIMME).',
  watchOut:
    'Full power every time? A big drive runs over the shelf into the bunker and stops dead. Take a three-quarter swing to stop short of the SAND, then pitch over it onto the green. There is more sand behind the cup, so do not blast the putt.',
  mechanicsIntroduced: ['sand'],
  firstPlayer: 0,
  width: 1280,
  wind: 0,
  terrain: {
    pieces: [
      terrainPiece(
        [
          [0, 590],
          [200, 590],
          [320, 578],
          [440, 552],
          [540, 538], // hill crest, 52 px above the tee
          [580, 556], // 18 px drop onto the shelf
          [810, 556], // lay-up shelf 580-810; its lip (800-810) is already sand
          [840, 590], // bunker face down into the sand
          [1020, 590], // flat carrying the bunker (800-1010)
          [1060, 578],
          [1120, 562],
          [1280, 562], // green 1120-1280, cup at 1190, back bunker 1240-1280
        ],
        720,
      ),
    ],
    gaps: [],
  },
  props: [
    { kind: 'sand', id: 'bunker', x1: 800, x2: 1010 },
    { kind: 'sand', id: 'back-bunker', x1: 1240, x2: 1280 },
  ],
  switches: [],
  holeX: 1190,
  startXs: [90, 140],
});
