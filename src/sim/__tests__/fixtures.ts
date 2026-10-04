// OWNER: sim
/**
 * Hand-written `Level` literals for SIM tests (ARCH.md §4): SIM never depends on LEVELS' files.
 * Every y is 2-dp exact so initial states survive a snapshot round trip. `fixtureRegistry` has the
 * shape of `src/sim/levels/index.ts` so a test can `vi.mock('../levels/index', ...)` with it and run
 * `createSim`/`stepSim`/`encodeSnapshot` against fixtures only.
 */
import type { Level, PlayerId, ReplayEntry, SimConfig, SimMode, WorldId } from '../types';
import { BALL_RADIUS, HOLE_RADIUS, VIEWPORT_H } from '../types';

export const GROUND_Y = 600;
const TEE_Y = GROUND_Y - BALL_RADIUS;
const WALL_H = 160;
const WALL_Y = GROUND_Y - WALL_H;
const PAD_Y = GROUND_Y - 6;

type Overrides = Partial<Level> & Pick<Level, 'id'>;

const flatGround = (width: number): Level['terrain'] => ({
  pieces: [{ surface: [{ x: 0, y: GROUND_Y }, { x: width, y: GROUND_Y }], baseY: VIEWPORT_H }],
  gaps: [],
});

function fixture(o: Overrides): Level {
  const width = o.width ?? 1600;
  return {
    name: `Fixture ${o.id}`,
    world: 1,
    order: 0,
    par: 4,
    hint: 'fixture',
    aha: 'fixture',
    watchOut: 'fixture',
    mechanicsIntroduced: ['sand'],
    firstPlayer: 0,
    mechanicsPresent: [],
    height: VIEWPORT_H,
    wind: 0,
    terrain: flatGround(width),
    rects: [],
    switches: [],
    hole: { x: 1400, rimY: GROUND_Y, radius: HOLE_RADIUS },
    starts: [
      { x: 100, y: TEE_Y },
      { x: 160, y: TEE_Y },
    ],
    ...o,
    width,
  };
}

/** Flat 1600 px fairway, cup at 1400, tees at 200 / 260. */
export const flatLevel: Level = fixture({
  id: 'fixture-flat',
  starts: [
    { x: 200, y: TEE_Y },
    { x: 260, y: TEE_Y },
  ],
});

/** A 1 px riser from y 648 up to a plateau at y 300 at x 958 (physics-notes §4.3). */
export const cliffLevel: Level = fixture({
  id: 'fixture-cliff',
  terrain: {
    pieces: [
      {
        surface: [
          { x: 0, y: 648 },
          { x: 958, y: 648 },
          { x: 959, y: 300 },
          { x: 1600, y: 300 },
        ],
        baseY: VIEWPORT_H,
      },
    ],
    gaps: [],
  },
  hole: { x: 1400, rimY: 300, radius: HOLE_RADIUS },
  starts: [
    { x: 200, y: 648 - BALL_RADIUS },
    { x: 260, y: 648 - BALL_RADIUS },
  ],
});

/** A 70 degree face (x 400-500), a plateau, then a 34 degree ramp back down to the fairway. */
export const slopeLevel: Level = fixture({
  id: 'fixture-slope',
  terrain: {
    pieces: [
      {
        surface: [
          { x: 0, y: GROUND_Y },
          { x: 400, y: GROUND_Y },
          { x: 500, y: 325 },
          { x: 900, y: 325 },
          { x: 1300, y: GROUND_Y },
          { x: 1600, y: GROUND_Y },
        ],
        baseY: VIEWPORT_H,
      },
    ],
    gaps: [],
  },
  hole: { x: 700, rimY: 325, radius: HOLE_RADIUS },
});

export const BRIDGE_X1 = 500;
export const BRIDGE_X2 = 660;
export const BRIDGE_H = 16;

/**
 * A 160 px gap spanned by a bridge held by ANY of three plates (D2 switchIds): `near` before the gap,
 * `far` after it, and `deck` ON the bridge (onRectId, inset 24 px from both lips).
 */
export const gapBridgeLevel: Level = fixture({
  id: 'fixture-gap-bridge',
  mechanicsPresent: ['switch', 'bridge'],
  terrain: {
    pieces: [
      { surface: [{ x: 0, y: GROUND_Y }, { x: BRIDGE_X1, y: GROUND_Y }], baseY: VIEWPORT_H },
      { surface: [{ x: BRIDGE_X2, y: GROUND_Y }, { x: 1600, y: GROUND_Y }], baseY: VIEWPORT_H },
    ],
    gaps: [{ x1: BRIDGE_X1, x2: BRIDGE_X2 }],
  },
  rects: [
    {
      kind: 'bridge',
      id: 'bridge',
      x: BRIDGE_X1,
      y: GROUND_Y,
      w: BRIDGE_X2 - BRIDGE_X1,
      h: BRIDGE_H,
      switchIds: ['near', 'far', 'deck'],
      label: 'BRIDGE',
    },
  ],
  switches: [
    { id: 'near', x: 300, w: 100, surfaceY: GROUND_Y, colour: '#ffd400', label: 'A' },
    { id: 'far', x: 760, w: 100, surfaceY: GROUND_Y, colour: '#ffd400', label: 'B' },
    { id: 'deck', x: BRIDGE_X1 + 24, w: BRIDGE_X2 - BRIDGE_X1 - 48, surfaceY: GROUND_Y, colour: '#ffd400', label: 'DECK', onRectId: 'bridge' },
  ],
  starts: [
    { x: 150, y: TEE_Y },
    { x: 210, y: TEE_Y },
  ],
});

/** A plate (x 260-560) that opens a door at x 800, plus a PERMANENT wall at x 1200. */
export const blockerLevel: Level = fixture({
  id: 'fixture-blocker',
  mechanicsPresent: ['switch', 'blocker'],
  rects: [
    { kind: 'blocker', id: 'door', x: 800, y: WALL_Y, w: 40, h: WALL_H, switchId: 'door', label: 'DOOR' },
    { kind: 'blocker', id: 'wall', x: 1200, y: WALL_Y, w: 40, h: WALL_H },
  ],
  switches: [{ id: 'door', x: 260, w: 300, surfaceY: GROUND_Y, colour: '#ffd400', label: 'DOOR' }],
  hole: { x: 1500, rimY: GROUND_Y, radius: HOLE_RADIUS },
});

export const OVERHANG_BASE_Y = 520;

/** A flat fairway with a ceiling slab (surface y 440, base y 520) over x 700-900. */
export const overhangLevel: Level = fixture({
  id: 'fixture-overhang',
  terrain: {
    pieces: [
      { surface: [{ x: 0, y: GROUND_Y }, { x: 1600, y: GROUND_Y }], baseY: VIEWPORT_H },
      { surface: [{ x: 700, y: 440 }, { x: 900, y: 440 }], baseY: OVERHANG_BASE_Y },
    ],
    gaps: [],
  },
});

/** A red gate at x 700 and a blue gate at x 1000 (each 40 x 160). */
export const gateLevel: Level = fixture({
  id: 'fixture-gate',
  mechanicsPresent: ['colourGate'],
  rects: [
    { kind: 'colourGate', id: 'gate-red', x: 700, y: WALL_Y, w: 40, h: WALL_H, colour: 'red' },
    { kind: 'colourGate', id: 'gate-blue', x: 1000, y: WALL_Y, w: 40, h: WALL_H, colour: 'blue' },
  ],
  hole: { x: 1500, rimY: GROUND_Y, radius: HOLE_RADIUS },
});

export const SPRING_LAUNCH = { x: 120, y: -420 } as const;

/** Sand x 500-700, a spring at x 900-960 and a bumper at x 1200-1260, all flush pads. */
export const sandSpringBumperLevel: Level = fixture({
  id: 'fixture-pads',
  mechanicsPresent: ['sand', 'spring', 'bumper'],
  rects: [
    { kind: 'sand', id: 'sand', x: 500, y: PAD_Y, w: 200, h: 12, label: 'SAND' },
    { kind: 'spring', id: 'spring', x: 900, y: PAD_Y, w: 60, h: 12, launch: SPRING_LAUNCH, label: 'BOING' },
    { kind: 'bumper', id: 'bumper', x: 1200, y: PAD_Y, w: 60, h: 12, label: 'BONK' },
  ],
  hole: { x: 1500, rimY: GROUND_Y, radius: HOLE_RADIUS },
});

/** A plate (x 300-400) that switches ON a fan volume over x 800-900 (y 400-600). */
export const fanLevel: Level = fixture({
  id: 'fixture-fan',
  mechanicsPresent: ['switch', 'fan'],
  rects: [{ kind: 'fan', id: 'fan', x: 800, y: 400, w: 100, h: 200, switchId: 'fan-plate', label: 'FAN' }],
  switches: [{ id: 'fan-plate', x: 300, w: 100, surfaceY: GROUND_Y, colour: '#ffd400', label: 'A' }],
  hole: { x: 1500, rimY: GROUND_Y, radius: HOLE_RADIUS },
});

/** The cup (x 800) holds the `door` switch (D2 cupHoldsSwitch); the door stands at x 1100. */
export const cupHoldsLevel: Level = fixture({
  id: 'fixture-cup-holds',
  mechanicsPresent: ['switch', 'blocker'],
  cupHoldsSwitch: 'door',
  rects: [{ kind: 'blocker', id: 'door', x: 1100, y: WALL_Y, w: 40, h: WALL_H, switchId: 'door', label: 'DOOR' }],
  switches: [{ id: 'door', x: 300, w: 100, surfaceY: GROUND_Y, colour: '#ffd400', label: 'DOOR' }],
  hole: { x: 800, rimY: GROUND_Y, radius: HOLE_RADIUS },
});

/** Flat fairway with the cup only 300 px from the tees, so a low putt holes out (turn-flow tests). */
export const shortLevel: Level = fixture({
  id: 'fixture-short',
  par: 3,
  hole: { x: 500, rimY: GROUND_Y, radius: HOLE_RADIUS },
  starts: [
    { x: 200, y: TEE_Y },
    { x: 260, y: TEE_Y },
  ],
});

/** A low, soft putt that rolls from either shortLevel tee into the cup (260 px/s: the friction floor stops power 30 short). */
export const PUTT_AIM = { angle: -0.03, power: 40 } as const;

/** Like shortLevel but blue shoots first (D2 firstPlayer), for the next-level tests. */
export const blueFirstLevel: Level = fixture({
  id: 'fixture-blue-first',
  par: 3,
  firstPlayer: 1,
  hole: { x: 500, rimY: GROUND_Y, radius: HOLE_RADIUS },
  starts: [
    { x: 200, y: TEE_Y },
    { x: 260, y: TEE_Y },
  ],
});

/** The fixture campaign the replay / serialize goldens run on: a switch level, then a short hole. */
export const FIXTURE_CAMPAIGN: readonly Level[] = [gapBridgeLevel, shortLevel];

/**
 * The fixture replay log (ARCH.md §4 replay row): red chips onto plate A (power 30 rests at x ~327, inside
 * 300-400), blue drives across the held bridge, two more shots. Ticks are far enough apart that every shot
 * has settled; replay.test asserts nothing is rejected.
 */
export const FIXTURE_LOG: readonly ReplayEntry[] = [
  { tick: 0, cmd: { type: 'continue', playerId: 0 } },
  { tick: 1, cmd: { type: 'setAim', playerId: 0, angle: -0.7854, power: 30 } },
  { tick: 1, cmd: { type: 'shoot', playerId: 0 } },
  { tick: 600, cmd: { type: 'setAim', playerId: 1, angle: -0.7854, power: 60 } },
  { tick: 600, cmd: { type: 'shoot', playerId: 1 } },
  { tick: 1200, cmd: { type: 'setAim', playerId: 0, angle: -1.2, power: 40 } },
  { tick: 1200, cmd: { type: 'shoot', playerId: 0 } },
  { tick: 1650, cmd: { type: 'setAim', playerId: 1, angle: -1.4, power: 60 } },
  { tick: 1650, cmd: { type: 'shoot', playerId: 1 } },
];

export const FIXTURE_LOG_TICKS = 2000;

export const FIXTURES: readonly Level[] = Object.freeze([
  flatLevel,
  cliffLevel,
  slopeLevel,
  gapBridgeLevel,
  blockerLevel,
  overhangLevel,
  gateLevel,
  sandSpringBumperLevel,
  fanLevel,
  cupHoldsLevel,
  shortLevel,
  blueFirstLevel,
]);

const BY_ID: ReadonlyMap<string, Level> = new Map(FIXTURES.map((l) => [l.id, l] as const));

/** Drop-in replacement for `src/sim/levels/index.ts` (same export names) backed by the fixtures. */
export const fixtureRegistry = {
  LEVELS: FIXTURES,
  WORLD1_IDS: Object.freeze(FIXTURES.map((l) => l.id)) as readonly string[],
  levelById(id: string): Level {
    const level = BY_ID.get(id);
    if (level === undefined) throw new Error(`unknown fixture id: ${id}`);
    return level;
  },
  hasLevel(id: string): boolean {
    return BY_ID.has(id);
  },
  coursePar(levelIds: readonly string[]): number {
    return levelIds.reduce((sum, id) => sum + fixtureRegistry.levelById(id).par, 0);
  },
  campaignFrom(levelId: string): readonly string[] {
    const index = FIXTURES.findIndex((l) => l.id === levelId);
    if (index < 0) throw new Error(`unknown fixture id: ${levelId}`);
    return FIXTURES.slice(index).map((l) => l.id);
  },
  worldTitle(world: WorldId): string {
    return `World ${world} — Fixtures`;
  },
};

/** A SimConfig over fixture levels. */
export function fixtureConfig(levels: readonly Level[], mode: SimMode = 'local', seed = 42): SimConfig {
  return { playerCount: mode === 'solo' ? 1 : 2, levelIds: levels.map((l) => l.id), seed, mode };
}

/** The other slot. */
export function otherSlot(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}
