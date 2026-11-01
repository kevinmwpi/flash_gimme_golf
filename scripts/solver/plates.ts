// OWNER: levels
/**
 * The solver's plate checks (scripts/solver.ts, decision 19): the holder's stall tap and the bridge deck's lip
 * and lone-ball rules, played through the full sim from crafted resting balls.
 */
import { rectContains, rectSwitchIds } from '../../src/sim/terrain';
import type { BallState, BridgeRect, Level, PressureSwitch, SimState } from '../../src/sim/types';
import { BALL_RADIUS } from '../../src/sim/types';
import { allOff, craftedBall, fmtShot, inSlotOrder, newGame, onFairway, settledSwitches, takeShot, withBalls, type Shot } from './game';
import { bridgesOf, plateSwitches } from './sweeps';

export const STALL_TAPS: readonly Shot[] = [
  { deg: 90, power: 10 },
  { deg: 90, power: 15 },
  { deg: 80, power: 20 },
  { deg: 100, power: 15 },
];

export type StallResult = {
  readonly switchId: string;
  readonly partnerAt: 'tee' | 'plate' | 'deck';
  readonly tap: Shot;
  readonly heldBefore: boolean;
  readonly reHeld: boolean;
  readonly partnerFell: boolean;
  readonly bridgeDrops: number;
  readonly holderRestX: number;
};

function plateRest(level: Level, sw: PressureSwitch): { x: number; y: number } {
  return onFairway(level, sw.x + sw.w / 2);
}

/** A seat: a plate whose resting ball sits inside a trap (L9 BAIT, L12 DOOR). Its holder is caught, so it never shoots. */
export function isSeat(level: Level, sw: PressureSwitch): boolean {
  return level.rects.some((r) => r.kind === 'trap' && rectContains(r, plateRest(level, sw)));
}

/** The plates whose holder may have to stall-tap: every plate on the fairway except the seats. */
export function stallPlates(level: Level): PressureSwitch[] {
  return plateSwitches(level).filter((sw) => !isSeat(level, sw));
}

function deckBall(level: Level, bridge: BridgeRect): BallState {
  return craftedBall(level, 1, { x: bridge.x + bridge.w / 2, y: bridge.y - BALL_RADIUS });
}

/** A holder taps straight up at low power: it must land back on its plate and a partner parked on the deck must not fall. */
export function stallTapCheck(level: Level): StallResult[] {
  const out: StallResult[] = [];
  const base = newGame(level);
  for (const sw of stallPlates(level)) {
    const holder = craftedBall(level, 0, plateRest(level, sw));
    const partners: { at: StallResult['partnerAt']; ball: BallState }[] = [{ at: 'tee', ball: craftedBall(level, 1, level.starts[1]) }];
    for (const other of plateSwitches(level)) {
      if (other.id !== sw.id) partners.push({ at: 'plate', ball: craftedBall(level, 1, plateRest(level, other)) });
    }
    for (const bridge of bridgesOf(level)) {
      if (rectSwitchIds(bridge).includes(sw.id)) partners.push({ at: 'deck', ball: deckBall(level, bridge) });
    }
    for (const partner of partners) {
      for (const tap of STALL_TAPS) {
        const game = withBalls(base, inSlotOrder(0, holder, partner.ball), 0);
        const heldBefore = game.state.switches[sw.id] === true;
        const r = takeShot(game, tap);
        if (r === null) continue;
        out.push({
          switchId: sw.id,
          partnerAt: partner.at,
          tap,
          heldBefore,
          reHeld: r.summary.switches[sw.id] === true,
          partnerFell: r.summary.partnerFell,
          bridgeDrops: r.summary.bridgeDrops,
          holderRestX: Math.round(r.summary.restX),
        });
      }
    }
  }
  return out;
}

export type DeckLipResult = { readonly deckId: string; readonly lipSamples: number; readonly lipPresses: number; readonly deckSamples: number; readonly deckPresses: number };

const LIP_SAMPLE_PX = 24;
const DECK_SAMPLE_STEP_PX = 48;

/** Balls resting at either lip never press the deck plate; a ball resting on the inset strip always does. */
export function deckLipCheck(level: Level): DeckLipResult[] {
  const out: DeckLipResult[] = [];
  for (const deck of level.switches.filter((sw) => sw.onRectId !== undefined)) {
    const bridge = bridgesOf(level).find((b) => b.id === deck.onRectId);
    const gap = bridge !== undefined ? level.terrain.gaps.find((g) => g.x1 === bridge.x) : undefined;
    if (bridge === undefined || gap === undefined) continue;
    const holderPlate = plateSwitches(level).find((sw) => rectSwitchIds(bridge).includes(sw.id));
    if (holderPlate === undefined) continue;
    const holder = craftedBall(level, 0, plateRest(level, holderPlate));
    const pressedWith = (probe: BallState): boolean => settledSwitches(level, [holder, probe])[deck.id] === true;
    let lipSamples = 0;
    let lipPresses = 0;
    for (let d = 1; d <= LIP_SAMPLE_PX; d += 1) {
      for (const x of [gap.x1 - d, gap.x2 + d]) {
        lipSamples += 1;
        if (pressedWith(craftedBall(level, 1, onFairway(level, x)))) lipPresses += 1;
      }
    }
    let deckSamples = 0;
    let deckPresses = 0;
    for (let x = deck.x; x <= deck.x + deck.w; x += DECK_SAMPLE_STEP_PX) {
      deckSamples += 1;
      if (pressedWith(craftedBall(level, 1, { x, y: bridge.y - BALL_RADIUS }))) deckPresses += 1;
    }
    out.push({ deckId: deck.id, lipSamples, lipPresses, deckSamples, deckPresses });
  }
  return out;
}

export type LoneDeckResult = { readonly deckId: string; readonly fromX: number; readonly shot: Shot; readonly restX: number; readonly fell: boolean; readonly crossed: boolean };

/** Shots at or under this angle are "rolls" for the lone-deck rule; above it, "lobs". */
export const LONE_DECK_ROLL_MAX_DEG = 7;
const LONE_DECK_ROLLS: Shot[] = [3, 5, 7].flatMap((deg) => [40, 60, 80, 100].map((power) => ({ deg, power })));
const LONE_DECK_LOBS: Shot[] = [80, 90, 100].map((power) => ({ deg: 45, power }));
/** The deepest "far third" start: a roll from closer than this hops onto the far lip before it has fallen a ball height. */
const LONE_DECK_FAR_MARGIN_PX = 240;

/**
 * The rule the L4 copy teaches ("a ball parked on the DECK must FLY off, never roll"): a lone deck ball
 * ({deck} held, partner on its tee) releases the deck the tick it moves, so every roll drops into the
 * chasm and only a lob that carries to the far lip crosses.
 */
export function loneDeckCheck(level: Level): LoneDeckResult[] {
  const out: LoneDeckResult[] = [];
  const base = newGame(level);
  for (const deck of level.switches.filter((sw) => sw.onRectId !== undefined)) {
    const bridge = bridgesOf(level).find((b) => b.id === deck.onRectId);
    const gap = bridge !== undefined ? level.terrain.gaps.find((g) => g.x1 === bridge.x) : undefined;
    if (bridge === undefined || gap === undefined) continue;
    const froms = [deck.x + DECK_SAMPLE_STEP_PX, bridge.x + bridge.w / 2, gap.x2 - LONE_DECK_FAR_MARGIN_PX];
    for (const fromX of froms) {
      for (const shot of [...LONE_DECK_ROLLS, ...LONE_DECK_LOBS]) {
        const balls = inSlotOrder(1, craftedBall(level, 1, { x: fromX, y: bridge.y - BALL_RADIUS }), craftedBall(level, 0, level.starts[0]));
        const state: SimState = { ...base.state, balls, switches: { ...allOff(level), [deck.id]: true }, activePlayer: 1, turnDelayTicks: 0, phase: 'aiming' };
        const r = takeShot({ config: base.config, state, log: [] }, shot);
        if (r === null) continue;
        out.push({ deckId: deck.id, fromX, shot, restX: Math.round(r.summary.restX), fell: r.summary.fell, crossed: !r.summary.fell && r.summary.restX > gap.x2 });
      }
    }
  }
  return out;
}

export const fmtLoneDeck = (l: LoneDeckResult): string => `${l.fromX} ${fmtShot(l.shot)} → ${l.restX}${l.fell ? ' fell' : ''}${l.crossed ? ' CROSSED' : ''}`;
