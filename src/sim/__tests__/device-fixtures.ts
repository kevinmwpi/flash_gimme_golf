// OWNER: sim
/**
 * Compiled World 2-3 device fixtures for SIM tests (the fixtures.ts pattern, but built with `compileLevel`, so
 * every level passes `validateLevel`): a trap, a cannon, a straight-up spring for the flight watchdog, a
 * flush-footed door, and a small machine with both devices that the scripted device scenario plays.
 * `deviceRegistry` has the shape of `src/sim/levels/index.ts` for `vi.mock('../levels/index', ...)`.
 */
import { SWITCH_COLOUR, compileLevel, terrainPiece, type LevelDef } from '../levels/authoring';
import type { Level, ReplayEntry, SimConfig, SimMode, Vec, WorldId } from '../types';
import { VIEWPORT_H } from '../types';

export const FLOOR_Y = 600;

type Required = Pick<LevelDef, 'id' | 'mechanicsIntroduced' | 'props' | 'switches' | 'holeX' | 'startXs'>;

/** A world-2 fixture on a flat fairway at FLOOR_Y unless `terrain` says otherwise. */
function fixtureDef(o: Required & Partial<LevelDef>): LevelDef {
  const width = o.width ?? 1600;
  return {
    name: `Fixture ${o.id}`,
    world: 2,
    order: 5,
    par: 4,
    hint: 'fixture',
    aha: 'fixture',
    watchOut: 'fixture',
    firstPlayer: 0,
    wind: 0,
    terrain: { pieces: [terrainPiece([[0, FLOOR_Y], [width, FLOOR_Y]], VIEWPORT_H)], gaps: [] },
    ...o,
    width,
  };
}

/** Jaws over x 700-800 (a resting ball centre is at y 588, inside y 560-620), released by FREE (x 370-470) or the cup. */
export const trapLevel: Level = compileLevel(
  fixtureDef({
    id: 'fixture-trap',
    mechanicsIntroduced: ['trap'],
    cupHoldsSwitch: 'free',
    props: [{ kind: 'trap', id: 'snare', x: 700, y: 560, w: 100, h: 60, releaseIds: ['free'], label: 'TRAP' }],
    switches: [{ id: 'free', centerX: 420, w: 100, colour: SWITCH_COLOUR, label: 'FREE' }],
    holeX: 1400,
    startXs: [200, 260],
  }),
);

export const CANNON_LAUNCH: Vec = Object.freeze({ x: 400, y: -700 });

/** A cannon breech over x 680-720, lit by FIRE (x 370-470) or the cup; its flight lands in the sand at 1350-1750. */
export const cannonLevel: Level = compileLevel(
  fixtureDef({
    id: 'fixture-cannon',
    width: 2400,
    mechanicsIntroduced: ['cannon'],
    cupHoldsSwitch: 'fire',
    props: [
      { kind: 'cannon', id: 'cannon', centerX: 700, w: 40, launch: CANNON_LAUNCH, fireIds: ['fire'], label: 'CANNON' },
      { kind: 'sand', id: 'landing', x1: 1350, x2: 1750 },
    ],
    switches: [{ id: 'fire', centerX: 420, w: 100, colour: SWITCH_COLOUR, label: 'FIRE' }],
    holeX: 2200,
    startXs: [200, 260],
  }),
);

/**
 * A spring that launches straight up (x 572-628): a ball that touches it pogos forever (the watchdog's case).
 * The PERCH plate (x 370-470, held by the cup) lets a ball's safe spot sit on a plate.
 */
export const pogoLevel: Level = compileLevel(
  fixtureDef({
    id: 'fixture-pogo',
    mechanicsIntroduced: ['spring'],
    cupHoldsSwitch: 'perch',
    props: [{ kind: 'spring', id: 'pogo', centerX: 600, w: 56, launch: { x: 0, y: -500 }, label: 'POGO' }],
    switches: [{ id: 'perch', centerX: 420, w: 100, colour: SWITCH_COLOUR, label: 'PERCH' }],
    holeX: 1400,
    startXs: [200, 260],
  }),
);

export const DOOR_X = 800;
export const DOOR_W = 40;

/** A door (x 800-840, 120 px) whose foot stands FLUSH on the fairway (no embed), held open by DOOR (x 370-470). */
export const flushDoorLevel: Level = compileLevel(
  fixtureDef({
    id: 'fixture-flush-door',
    mechanicsIntroduced: [],
    props: [{ kind: 'blocker', id: 'door-gate', centerX: DOOR_X + DOOR_W / 2, w: DOOR_W, h: 120, bottom: FLOOR_Y, switchIds: ['door'], label: 'DOOR' }],
    switches: [{ id: 'door', centerX: 420, w: 100, colour: SWITCH_COLOUR, label: 'DOOR' }],
    holeX: 1400,
    startXs: [200, 260],
  }),
);

/**
 * Both devices on one fairway: FREE (x 300-400) releases the jaws over x 560-660; the FIRE plate sits in a dish
 * (x 900-1000, y 610) and lights the cannon whose breech is the floor of a dish (x 1180-1220, y 615); its
 * flight lands in the sand at 1850-2150. The cup (x 2300) holds FIRE.
 */
export const machineLevel: Level = compileLevel(
  fixtureDef({
    id: 'fixture-machine',
    width: 2400,
    mechanicsIntroduced: [],
    cupHoldsSwitch: 'fire',
    terrain: {
      pieces: [
        terrainPiece(
          [
            [0, FLOOR_Y],
            [880, FLOOR_Y],
            [900, 610],
            [1000, 610],
            [1020, FLOOR_Y],
            [1140, FLOOR_Y],
            [1180, 615],
            [1220, 615],
            [1260, FLOOR_Y],
            [2400, FLOOR_Y],
          ],
          VIEWPORT_H,
        ),
      ],
      gaps: [],
    },
    props: [
      { kind: 'trap', id: 'snare', x: 560, y: 540, w: 100, h: 80, releaseIds: ['free'], label: 'TRAP' },
      { kind: 'cannon', id: 'cannon', centerX: 1200, w: 40, launch: CANNON_LAUNCH, fireIds: ['fire'], label: 'CANNON' },
      { kind: 'sand', id: 'landing', x1: 1850, x2: 2150 },
    ],
    switches: [
      { id: 'free', centerX: 350, w: 100, colour: SWITCH_COLOUR, label: 'FREE' },
      { id: 'fire', centerX: 950, w: 100, colour: SWITCH_COLOUR, label: 'FIRE' },
    ],
    holeX: 2300,
    startXs: [100, 160],
  }),
);

export const DEVICE_FIXTURES: readonly Level[] = Object.freeze([trapLevel, cannonLevel, pogoLevel, flushDoorLevel, machineLevel]);

const BY_ID: ReadonlyMap<string, Level> = new Map(DEVICE_FIXTURES.map((l) => [l.id, l] as const));

/** Drop-in replacement for `src/sim/levels/index.ts` (same export names) backed by the device fixtures. */
export const deviceRegistry = {
  LEVELS: DEVICE_FIXTURES,
  WORLD1_IDS: Object.freeze(DEVICE_FIXTURES.map((l) => l.id)) as readonly string[],
  levelById(id: string): Level {
    const level = BY_ID.get(id);
    if (level === undefined) throw new Error(`unknown fixture id: ${id}`);
    return level;
  },
  hasLevel(id: string): boolean {
    return BY_ID.has(id);
  },
  coursePar(levelIds: readonly string[]): number {
    return levelIds.reduce((sum, id) => sum + deviceRegistry.levelById(id).par, 0);
  },
  campaignFrom(levelId: string): readonly string[] {
    const index = DEVICE_FIXTURES.findIndex((l) => l.id === levelId);
    if (index < 0) throw new Error(`unknown fixture id: ${levelId}`);
    return DEVICE_FIXTURES.slice(index).map((l) => l.id);
  },
  worldTitle(world: WorldId): string {
    return `World ${world} — Device fixtures`;
  },
};

/** A single-level SimConfig over a device fixture. */
export function deviceConfig(level: Level, mode: SimMode = 'local', seed = 5): SimConfig {
  return { playerCount: mode === 'solo' ? 1 : 2, levelIds: [level.id], seed, mode };
}

/**
 * The device scenario on `machineLevel` (each shot found on a 1-degree x 0.5-power grid of legal aims by playing
 * its beat on the real sim): red stops in the jaws (CAUGHT); blue stops there too, so the scoped reset sends blue back
 * to its tee (BACK +1) and red's turn is skipped; blue rests on FREE (red FREED where it sits); red rolls into
 * the cold breech (LOADED); blue taps along FREE (red's turn skipped again); blue rests on FIRE and red is fired
 * the next tick onto the landing sand; red holes out (gimme), so the cup holds FIRE; blue rolls into the lit
 * breech (fired on entry) and holes out. Ends in levelResults at MACHINE_LOG_TICKS.
 */
export const MACHINE_LOG: readonly ReplayEntry[] = [
  { tick: 0, cmd: { type: 'continue', playerId: 0 } },
  { tick: 1, cmd: { type: 'setAim', playerId: 0, angle: -0.3316, power: 45.5 } },
  { tick: 1, cmd: { type: 'shoot', playerId: 0 } },
  { tick: 221, cmd: { type: 'setAim', playerId: 1, angle: -0.2967, power: 42 } },
  { tick: 221, cmd: { type: 'shoot', playerId: 1 } },
  { tick: 429, cmd: { type: 'setAim', playerId: 1, angle: -0.1745, power: 23 } },
  { tick: 429, cmd: { type: 'shoot', playerId: 1 } },
  { tick: 565, cmd: { type: 'setAim', playerId: 0, angle: -0.2967, power: 55 } },
  { tick: 565, cmd: { type: 'shoot', playerId: 0 } },
  { tick: 933, cmd: { type: 'setAim', playerId: 1, angle: -0.03, power: 10 } },
  { tick: 933, cmd: { type: 'shoot', playerId: 1 } },
  { tick: 1007, cmd: { type: 'setAim', playerId: 1, angle: -0.2443, power: 51 } },
  { tick: 1007, cmd: { type: 'shoot', playerId: 1 } },
  { tick: 1511, cmd: { type: 'setAim', playerId: 0, angle: -0.733, power: 43 } },
  { tick: 1511, cmd: { type: 'shoot', playerId: 0 } },
  { tick: 1674, cmd: { type: 'setAim', playerId: 1, angle: -0.6632, power: 28.5 } },
  { tick: 1674, cmd: { type: 'shoot', playerId: 1 } },
  { tick: 2003, cmd: { type: 'setAim', playerId: 1, angle: -0.6807, power: 46 } },
  { tick: 2003, cmd: { type: 'shoot', playerId: 1 } },
];

export const MACHINE_LOG_TICKS = 2141;
