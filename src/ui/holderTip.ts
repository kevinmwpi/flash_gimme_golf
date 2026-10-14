// OWNER: ui
/**
 * The holder tip (BUILD_DECISIONS D2: the toast that teaches the stall tap). At the start of a turn
 * the active ball may rest on a plate its partner still needs. The tip names that plate only when a
 * stall tap really keeps the partner's way open:
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
 * Who rests where comes from SimEvents (advanceSpots), never from switchOn.byPlayer, which names
 * only the first ball on a plate. An unknown spot means no tip.
 */
import { levelById } from '../sim/levels/index';
import { BALL_RADIUS, PLAYER_GATE_COLOUR, SWITCH_CONTACT_TOLERANCE } from '../sim/types';
import type { BallState, Level, LevelRect, PlayerId, PressureSwitch, SimEvent, Vec } from '../sim/types';

/** Where a ball last came to rest. */
export type BallSpot = { readonly pos: Vec; readonly sunk: boolean };
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
    { pos: level.starts[0], sunk: false },
    { pos: level.starts[1], sunk: false },
  ];
}

/** The balls of a known state (a local mount, a resumed share link included). */
export function spotsOf(balls: readonly [Readonly<BallState>, Readonly<BallState>]): Spots {
  return [
    { pos: balls[0].pos, sunk: balls[0].sunk },
    { pos: balls[1].pos, sunk: balls[1].sunk },
  ];
}

/** Spots after one SimEvent; feed every event in order. */
export function advanceSpots(spots: Spots, e: SimEvent): Spots {
  switch (e.type) {
    case 'levelStart':
      return teeSpots(levelById(e.levelId));
    case 'ballRest':
      return withSpot(spots, e.playerId, { pos: e.pos, sunk: false });
    case 'fellOffWorld':
      return withSpot(spots, e.playerId, { pos: e.respawnPos, sunk: false });
    case 'sink':
    case 'gimme':
      return withSpot(spots, e.playerId, { pos: e.pos, sunk: true });
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
  if (mine === null || theirs === null || mine.sunk || theirs.sunk) return null;
  for (const sw of level.switches) {
    if (sw.id === level.cupHoldsSwitch || sw.onRectId !== undefined || !restsOn(mine, sw)) continue;
    const partnerNeedsIt = level.rects.some((rect) => {
      const drivers = driversOf(rect);
      if (!drivers.includes(sw.id)) return false;
      if (level.switches.some((other) => drivers.includes(other.id) && restsOn(theirs, other))) return false;
      if (ownFieldPasses(level, rect, partner, theirs.pos.x, level.hole.x)) return false;
      return stillAhead(rect, theirs.pos.x, level.hole.x);
    });
    if (partnerNeedsIt) return sw.id;
  }
  return null;
}
