// OWNER: levels
/**
 * The solver's plate checks (scripts/solver.ts, decision 19, restated for BUILD_DECISIONS D11): the holder's
 * stall tap and the bridge deck's lip and lone-ball rules, played through the full sim from crafted resting balls.
 *
 * D11 (supersedes D2's resting-only rule): a plate goes DOWN when any non-sunk ball over it touches it (bottom
 * within SWITCH_CONTACT_TOLERANCE), rolling, bouncing or resting; once down it STAYS down while a ball over it is
 * at most PLATE_HOLD_HEIGHT_PX above it; it comes UP the tick no ball is on it. Each check below states the D11
 * property it proves; the pre-D11 versions asserted the opposite on the deck ("the planks vanish the tick the deck
 * ball moves, so every roll falls"), which is no longer true and no longer taught.
 */
import { rectContains, rectSwitchIds } from '../../src/sim/terrain';
import type { BallState, BridgeRect, Level, PressureSwitch, SimEvent, SimState } from '../../src/sim/types';
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
  /** `switchOff` events of the tapped plate during the tap: 0 under D11 (the plate never comes up). */
  readonly releases: number;
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

function switchOffs(events: readonly SimEvent[], switchId: string): number {
  return events.filter((e) => e.type === 'switchOff' && e.switchId === switchId).length;
}

/**
 * The holder's stall tap (straight up at low power) under D11: the tap never lets its plate come up. The highest
 * tap (80 deg at power 20: 130 px/s, vertical 128 px/s) rises vy^2 / 2g = 13 px and drifts 9 px sideways, far
 * inside PLATE_HOLD_HEIGHT_PX (72) and the plate, so the plate stays DOWN the whole time (0 `switchOff`, so the
 * door or bridge it drives never flickers: a holder's stall tap keeps the door open), the holder lands back on
 * it, and a partner parked on its tee, on another plate or on the bridge deck never falls. Before D11 the plate
 * came up for the whole tap and was re-held on the landing's `ballRest` tick; only re-held was asserted.
 */
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
          releases: switchOffs(r.events, sw.id),
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

/** Rest spots on the planks: 1 px inside either lip, plus every DECK_SAMPLE_STEP_PX in between. */
function deckSampleXs(bridge: BridgeRect): number[] {
  const xs = new Set<number>([bridge.x + 1, bridge.x + bridge.w - 1]);
  for (let x = bridge.x + DECK_SAMPLE_STEP_PX; x < bridge.x + bridge.w; x += DECK_SAMPLE_STEP_PX) xs.add(x);
  return [...xs].sort((a, b) => a - b);
}

/**
 * The deck's lip rule under D11. A ball resting at either lip (its centre 1-24 px outside the chasm, on the
 * terrain) never presses DECK: its ground is the lip piece, not the bridge (switchPresser's ground-source rule),
 * so a ball parked at a lip never holds the bridge. A ball resting ANYWHERE on the planks does, from 1 px inside
 * either lip: since D11 the DECK spans its bridge exactly, because a rolling deck ball keeps the bridge only while
 * it is over the plate, and the old 24 px inset dropped the planks under it 24 px short of the lip.
 */
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
    for (const x of deckSampleXs(bridge)) {
      deckSamples += 1;
      if (pressedWith(craftedBall(level, 1, { x, y: bridge.y - BALL_RADIUS }))) deckPresses += 1;
    }
    out.push({ deckId: deck.id, lipSamples, lipPresses, deckSamples, deckPresses });
  }
  return out;
}

export type LoneDeckResult = {
  readonly deckId: string;
  readonly fromX: number;
  readonly shot: Shot;
  readonly restX: number;
  readonly fell: boolean;
  /** Rests beyond the far lip (on the cup side). */
  readonly crossed: boolean;
  /** Rests on the planks (it still holds the bridge itself). */
  readonly onDeck: boolean;
  /** DECK came up during the shot (`switchOff`): the ball left the planks, over a lip or above the hold height. */
  readonly released: boolean;
};

/** Shots at or within this angle of the horizontal (either way) are "rolls" for the lone-deck rule; steeper ones, "lobs". */
export const LONE_DECK_ROLL_MAX_DEG = 7;
const LONE_DECK_ROLLS: Shot[] = [3, 5, 7, 173, 175, 177].flatMap((deg) => [40, 60, 80, 100].map((power) => ({ deg, power })));
/** 45 deg at power 80+ (520 px/s and up) rises (vy^2 / 2g) 109 px or more: well above PLATE_HOLD_HEIGHT_PX. */
const LONE_DECK_LOBS: Shot[] = [80, 90, 100].map((power) => ({ deg: 45, power }));
/** The deepest "far third" start: from here a 45 deg lob at power 80+ carries past the far lip. */
const LONE_DECK_FAR_MARGIN_PX = 240;

export function isLoneDeckRoll(shot: Shot): boolean {
  return shot.deg <= LONE_DECK_ROLL_MAX_DEG || shot.deg >= 180 - LONE_DECK_ROLL_MAX_DEG;
}

/**
 * The rule the L4 and L10 copy teaches under D11, for a lone deck ball ({deck} held, partner on its tee, so nothing
 * else holds the bridge). It presses DECK while it is on the planks, rolling, bouncing or hopping at most
 * PLATE_HOLD_HEIGHT_PX above them, and the deck spans its bridge to both lips, so the planks never vanish under a
 * ROLL: every roll of <= LONE_DECK_ROLL_MAX_DEG either way (power 40-100, from the near end, the centre and the far
 * third) ends on a lip or still on the deck, never in the chasm, and rolls toward the cup reach the far side
 * (`deck-lone-roll-keeps-bridge`; before D11 the deck let go the tick its ball moved and every roll fell). A LOB
 * that rises above the hold height lifts off: DECK comes up in flight, the planks vanish, and the ball crosses only
 * if it carries to a lip; it never comes back down on the planks (`deck-lone-lob-lifts-off`).
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
        const fell = r.summary.fell;
        out.push({
          deckId: deck.id,
          fromX,
          shot,
          restX: Math.round(r.summary.restX),
          fell,
          crossed: !fell && r.summary.restX > gap.x2,
          onDeck: !fell && r.summary.restX > gap.x1 && r.summary.restX < gap.x2,
          released: switchOffs(r.events, deck.id) > 0,
        });
      }
    }
  }
  return out;
}

export const fmtLoneDeck = (l: LoneDeckResult): string =>
  `${l.fromX} ${fmtShot(l.shot)} → ${l.restX}${l.fell ? ' fell' : ''}${l.crossed ? ' CROSSED' : ''}${l.onDeck ? ' on deck' : ''}${l.released ? '' : ' (deck kept)'}`;
