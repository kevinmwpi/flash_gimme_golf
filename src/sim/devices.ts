// OWNER: sim
/**
 * Device queries for the TRAP and the CANNON (worlds 2-3 LEVELS.md, BUILD_DECISIONS D10.4). Pure functions
 * of the level, the switch map and a ball: CAUGHT and LOADED are derived from position, the rest flag and
 * the switches, never stored. physics.ts and sim.ts apply the rules with them; the view, the UI and the
 * solver read them, so nobody re-derives a device's activeWhen polarity.
 */
import { isRectActive, rectContains, rectSwitchIds } from './terrain';
import type { BallState, CannonRect, Level, LevelRect, PlayerId, SimEventBody, TrapRect, Vec } from './types';
import { BALL_RADIUS, SWITCH_CONTACT_TOLERANCE } from './types';

type Switches = Readonly<Record<string, boolean>>;

export type WaitReason = 'caught' | 'loaded';
/** Why a ball cannot shoot: the WAITING rule hands its turns to the partner. */
export type Waiting = { readonly reason: WaitReason; readonly rectId: string };

/** ARMED while none of its release plates is held (a trap is active exactly like a door is shut). */
export function isTrapArmed(rect: TrapRect, switches: Switches): boolean {
  return isRectActive(rect, switches);
}

/** LIT while any of its FIRE plates is held. */
export function isCannonLit(rect: CannonRect, switches: Switches): boolean {
  return isRectActive(rect, switches);
}

/** Asleep and not sunk: the only balls a device holds. */
function isResting(ball: Readonly<BallState>): boolean {
  return ball.asleep && !ball.sunk;
}

/** A ball centre on the breech floor: centre x inside [x, x+w], bottom within SWITCH_CONTACT_TOLERANCE of rect.y. */
function onBreech(rect: CannonRect, pos: Vec): boolean {
  return pos.x >= rect.x && pos.x <= rect.x + rect.w && Math.abs(pos.y + BALL_RADIUS - rect.y) <= SWITCH_CONTACT_TOLERANCE;
}

/** The cannon (lit or cold) whose breech floor a ball centre sits on, else null. */
export function breechAt(level: Level, pos: Vec): CannonRect | null {
  for (const rect of level.rects) if (rect.kind === 'cannon' && onBreech(rect, pos)) return rect;
  return null;
}

/** True when pos (a ball centre) sits on ANY cannon breech floor, lit or cold (the safe-spot guard). */
export function onCannonBreech(level: Level, pos: Vec): boolean {
  return breechAt(level, pos) !== null;
}

/** The armed trap containing a RESTING (asleep, not sunk) ball's centre, else null. */
export function trapHolding(level: Level, switches: Switches, ball: Readonly<BallState>): TrapRect | null {
  if (!isResting(ball)) return null;
  for (const rect of level.rects) {
    if (rect.kind === 'trap' && isTrapArmed(rect, switches) && rectContains(rect, ball.pos)) return rect;
  }
  return null;
}

/** The COLD cannon whose breech a RESTING ball sits on, else null. */
export function cannonHolding(level: Level, switches: Switches, ball: Readonly<BallState>): CannonRect | null {
  if (!isResting(ball)) return null;
  const cannon = breechAt(level, ball.pos);
  return cannon !== null && !isCannonLit(cannon, switches) ? cannon : null;
}

/** Caught first, then loaded; null when the ball is free (or moving, or sunk). */
export function waitingOf(level: Level, switches: Switches, ball: Readonly<BallState>): Waiting | null {
  const trap = trapHolding(level, switches, ball);
  if (trap !== null) return { reason: 'caught', rectId: trap.id };
  const cannon = cannonHolding(level, switches, ball);
  return cannon === null ? null : { reason: 'loaded', rectId: cannon.id };
}

/**
 * The device event of a ball that has just come to rest where it is (a settle, or a teleport that left it
 * asleep): `trapCaught` when an armed trap holds it, else `cannonLoad` on a cold breech, else null.
 */
export function restEventOf(level: Level, switches: Switches, ball: Readonly<BallState>, playerId: PlayerId): SimEventBody | null {
  const waiting = waitingOf(level, switches, ball);
  if (waiting === null) return null;
  return waiting.reason === 'caught'
    ? { type: 'trapCaught', playerId, pos: ball.pos, rectId: waiting.rectId }
    : { type: 'cannonLoad', playerId, pos: ball.pos, rectId: waiting.rectId };
}

/** The release / FIRE switch ids of a device (rectSwitchIds) plus whether the cup holds one of them. */
export function releaseIdsOf(level: Level, rect: LevelRect): { switchIds: readonly string[]; cup: boolean } {
  const switchIds = rectSwitchIds(rect);
  const cup = level.cupHoldsSwitch !== undefined && switchIds.includes(level.cupHoldsSwitch);
  return { switchIds, cup };
}

/** Label (or upper-cased id) of the FIRST switch in `rect.switchIds`: the chip text `CAUGHT · needs <LABEL>`. */
export function releaseLabel(level: Level, rect: LevelRect): string {
  const first = rectSwitchIds(rect)[0];
  if (first === undefined) return '';
  return level.switches.find((sw) => sw.id === first)?.label ?? first.toUpperCase();
}
