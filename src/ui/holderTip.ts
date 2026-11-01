// OWNER: ui
/**
 * The holder tip (BUILD_DECISIONS D2, D10.10: the toast that teaches the stall tap). At the start of a turn
 * the active ball may rest on a plate its partner still needs. The tip names that plate only when a stall
 * tap really keeps the partner's way open:
 * - neither ball waits in a device (caught in an armed trap or loaded in a cold cannon): there the WAITING
 *   rule already hands every turn to the free ball, and a release or FIRE plate is the partner's job;
 * - the plate opens a door or raises a bridge: a plate whose only consumers are traps or cannons is never
 *   named (a trap blocks no way, it only holds a ball that rests in it, and a loaded ball fires whenever a
 *   FIRE plate is held again, so staying on one never keeps anything open);
 * - the plate is not wired to the cup (sinking holds it too) and is not a deck plate (a deck lets go
 *   the tick its ball moves, so a tap drops the bridge under the tapper);
 * - the partner rests on no plate that drives the same door or bridge, this one included (the
 *   partner keeps the way open, so the holder may go);
 * - the door or bridge still stands between the partner and the cup: a door whose middle is not
 *   behind the partner (a closing door pushes a ball out through the nearer face), or a bridge that
 *   starts ahead of the partner. A partner already on the planks (the lip strips beside the deck)
 *   falls whatever the holder does; staying would still be the holder's best move there, but a tip
 *   followed by the partner's fall reads as wrong advice, so it stays silent on purpose;
 * - the partner cannot pass that wall through a field of its own colour from where it rests.
 * Who rests where, and whether a device holds it there, comes from SimEvents (advanceSpots), never from
 * switchOn.byPlayer, which names only the first ball on a plate. An unknown spot means no tip.
 */
import { waitingOf } from '../sim/devices';
import { levelById } from '../sim/levels/index';
import { BALL_RADIUS, PLAYER_GATE_COLOUR, SWITCH_CONTACT_TOLERANCE } from '../sim/types';
import type { BallState, Level, LevelRect, PlayerId, PressureSwitch, SimEvent, SimState, Vec } from '../sim/types';

/** Where a ball last came to rest, and whether a device holds it there (caught or loaded, D10.4). */
export type BallSpot = { readonly pos: Vec; readonly sunk: boolean; readonly waiting: boolean };
/** One spot per slot; null while unknown (an online mount before that ball's first event). */
export type Spots = readonly [BallSpot | null, BallSpot | null];

export const UNKNOWN_SPOTS: Spots = [null, null];

/** The tip arrives with the turn banner and is the only teaching toast, so it stays up longer than TOAST_MS. */
export const HOLDER_TIP_MS = 5000;

/**
 * Room a ball needs to lob through its own colour field, measured on Colour Keys: within 15 px of the
 * wall face no lob passes, and from 15 to 40 px only steep 74-88 degree lobs do. The tip in that band
 * is a deliberate, safe suggestion (the stall tap still works there).
 */
const OWN_FIELD_LOB_ROOM = 40;

/** Both balls on their tees, as every level (and every restart) begins. */
export function teeSpots(level: Level): Spots {
  return [
    { pos: level.starts[0], sunk: false, waiting: false },
    { pos: level.starts[1], sunk: false, waiting: false },
  ];
}

function spotOf(level: Level, state: Pick<SimState, 'balls' | 'switches'>, slot: PlayerId): BallSpot {
  const ball: Readonly<BallState> = state.balls[slot];
  return { pos: ball.pos, sunk: ball.sunk, waiting: waitingOf(level, state.switches, ball) !== null };
}

/** The balls of a known state (a local mount, a resumed share link included), devices included. */
export function spotsOf(level: Level, state: Pick<SimState, 'balls' | 'switches'>): Spots {
  return [spotOf(level, state, 0), spotOf(level, state, 1)];
}

/**
 * Spots after one SimEvent; feed every event in order. A device event follows the rest or teleport it
 * belongs to in the same tick (BUILD_DECISIONS D10.4: `trapCaught` / `cannonLoad` after `ballRest` or a
 * respawn), so a rest or a teleport clears `waiting` and the device event that follows sets it again.
 */
export function advanceSpots(spots: Spots, e: SimEvent): Spots {
  switch (e.type) {
    case 'levelStart':
      return teeSpots(levelById(e.levelId));
    case 'ballRest':
      return withSpot(spots, e.playerId, { pos: e.pos, sunk: false, waiting: false });
    case 'fellOffWorld':
    case 'trapReturn':
    case 'flightTimeout':
      return withSpot(spots, e.playerId, { pos: e.respawnPos, sunk: false, waiting: false });
    case 'trapCaught':
    case 'cannonLoad':
      return withSpot(spots, e.playerId, { pos: e.pos, sunk: false, waiting: true });
    case 'trapFreed':
    case 'cannonFire':
      return withSpot(spots, e.playerId, { pos: e.pos, sunk: false, waiting: false });
    case 'sink':
    case 'gimme':
      return withSpot(spots, e.playerId, { pos: e.pos, sunk: true, waiting: false });
    default:
      return spots;
  }
}

function withSpot(spots: Spots, slot: PlayerId, spot: BallSpot): Spots {
  return slot === 0 ? [spot, spots[1]] : [spots[0], spot];
}

/** physics switchPresser's press zone (without its ground-source check). */
function restsOn(spot: BallSpot, sw: PressureSwitch): boolean {
  return (
    !spot.sunk &&
    spot.pos.x >= sw.x &&
    spot.pos.x <= sw.x + sw.w &&
    Math.abs(spot.pos.y + BALL_RADIUS - sw.surfaceY) <= SWITCH_CONTACT_TOLERANCE
  );
}

/** Same rule as sim/terrain `rectSwitchIds` (switchIds overrides switchId), which ui may not import. */
function driversOf(rect: LevelRect): readonly string[] {
  if (rect.switchIds !== undefined) return rect.switchIds;
  return rect.switchId !== undefined ? [rect.switchId] : [];
}

/** A door or a bridge: the only plate consumers a stall tap can keep open for the partner (D10.10). */
function opensAWay(rect: LevelRect): boolean {
  return rect.kind === 'blocker' || rect.kind === 'bridge';
}

/** Does `rect` still stand between a partner at x `px` and the cup at x `cx`? */
function stillAhead(rect: LevelRect, px: number, cx: number): boolean {
  const right = cx >= px;
  if (rect.kind === 'blocker') {
    const mid = rect.x + rect.w / 2;
    return right ? mid >= px && rect.x <= cx : mid <= px && rect.x + rect.w >= cx;
  }
  return right ? rect.x > px && rect.x <= cx : rect.x + rect.w < px && rect.x + rect.w >= cx;
}

/** Can a ball of `slot` resting at x `px` get past `rect`'s wall through a field of its own colour? */
function ownFieldPasses(level: Level, rect: LevelRect, slot: PlayerId, px: number, cx: number): boolean {
  const colour = PLAYER_GATE_COLOUR[slot];
  const field = level.rects.some((g) => g.kind === 'colourGate' && g.colour === colour && g.x < rect.x + rect.w && rect.x < g.x + g.w);
  if (!field) return false;
  return cx >= px ? px <= rect.x - OWN_FIELD_LOB_ROOM : px >= rect.x + rect.w + OWN_FIELD_LOB_ROOM;
}

/** The id of the plate the tip should name at the start of `holder`'s turn, or null. */
export function holderTipSwitch(level: Level, spots: Spots, holder: PlayerId): string | null {
  const partner: PlayerId = holder === 0 ? 1 : 0;
  const mine = spots[holder];
  const theirs = spots[partner];
  if (mine === null || theirs === null || mine.sunk || theirs.sunk || mine.waiting || theirs.waiting) return null;
  for (const sw of level.switches) {
    if (sw.id === level.cupHoldsSwitch || sw.onRectId !== undefined || !restsOn(mine, sw)) continue;
    const partnerNeedsIt = level.rects.some((rect) => {
      const drivers = driversOf(rect);
      if (!opensAWay(rect) || !drivers.includes(sw.id)) return false;
      if (level.switches.some((other) => drivers.includes(other.id) && restsOn(theirs, other))) return false;
      if (ownFieldPasses(level, rect, partner, theirs.pos.x, level.hole.x)) return false;
      return stillAhead(rect, theirs.pos.x, level.hole.x);
    });
    if (partnerNeedsIt) return sw.id;
  }
  return null;
}
