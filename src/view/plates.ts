// OWNER: view
/**
 * Which plate moments LAST (BUILD_DECISIONS D11). A plate goes down the moment any ball touches it and comes up
 * the tick no ball is on it, so a ball rolling across a plate, bouncing over it, or rocking up the ramps of the dish
 * it sits in flicks the plate and its door or bridge. Measured on the shipped holes (every hole with a plate, both
 * tees, a 33 x 10 shot grid): 77 % of the shots that end with the shooter on a plate pressed it two to four times
 * before the ball settled, the plate coming back up for a median 30 ticks between presses. The canvas draws every
 * flick from SimState (plate cap, lamps, wires, doors, planks, stickers); this tracker decides what earns more than
 * that. One tracker per consumer (view.ts: sparks, callouts, sticker pulses; audio.ts: clicks, chimes, slides), each
 * fed every SimEvent in order, so they agree:
 * - every `switchOn` is a PRESS (the plate clicks down), `fresh` when the plate had been up for FRESH_PRESS_TICKS or
 *   was never down, so a ball rocking in the dish clicks again without new sparks;
 * - a press is HELD once it lasts: a ball comes to rest on the plate (`ballRest` in its press zone), a ball is put
 *   down on it at rest (the respawn of `fellOffWorld`, `trapReturn`, `flightTimeout`), or the cup holds it (a `sink`
 *   or `gimme` on a level with `cupHoldsSwitch`). A stall tap that never lets the plate up adds nothing;
 * - every `switchOff` is a RELEASE, `ended` when the plate had been HELD (its holder left), not a ball passing over;
 * - a switch-driven door, window, bridge or fan announces a WAY change only when it lasts: it leaves its rest state
 *   (the state with no plate down) together with a HELD plate that drives it, and returns to it at once when a
 *   change announced that way is undone. A pass-over announces nothing; the door's own animation shows it;
 * - a word never contradicts the way it names: when a press that does not last moves a way off the rest state just
 *   announced (the holder's hop landing back on its plate, a lob off a deck touching another plate that drives the
 *   bridge), that word is taken back (UNSAY) on the same tick, and the way's next lasting change (HELD and OPEN once
 *   a ball settles on the plate) is announced as usual. Measured on near-vertical taps by a holder on every door,
 *   window and bridge plate and on lobs off both decks: 876 of 1,319 SHUT / GONE words were undone, a median 40
 *   ticks (p75 58) after them, so holding SHUT back until a release had lasted would make it a second late;
 * - a trap's JAWS on a ball last the same way: a ball coming to rest in armed jaws is caught for good, but a free
 *   lasts only while a HELD release plate (or the cup) keeps the trap open. A rescuer rolling across FREE, or rocking
 *   in its dish, frees and re-catches its partner two or three times before settling; those flicks are not lasting,
 *   and the free is announced (`late`) when the rescuer settles on the plate;
 * - a jaws word never contradicts the jaws it names either: when a free that does not last reopens jaws whose SNAP!
 *   stands (the holder of a release plate hops off it, the trap re-arms around its waiting partner, and the holder
 *   lands back), that SNAP! is taken back (UNSNAP) on the same tick, and FREE! comes (`late`) once the holder settles
 *   on the plate. On a grid of near-vertical taps by such a holder (every trap's release plates, 75-105 degrees x
 *   power 10-60), 124 of 462 taps otherwise left a SNAP! on screen over jaws the landing had opened;
 * - a word stands, and can be taken back, for WORD_STANDS_TICKS after it is said: longer than its callout lives and
 *   its sound plays, so there is nothing left of an older word to take back;
 * - a hold LASTS past its own tick: a ball that comes to rest on a plate and leaves it on that tick (L12's door seat
 *   sends it BACK +1 at once) holds nothing, so HELD, OPEN, the confirm and the slides never come for it.
 * Events only, so audio (which never sees SimState) runs it exactly as the view does: both feed whole ticks through
 * `feedAll`, which reads each tick's end from the tick's own switch events, so the two cannot disagree. Online,
 * GameCanvas hands both trackers every event once and in order: a hidden tab's batches dropped as stale are fed
 * without being presented (GameClient.takeStreamBreak). A state the events did not bring (a `?state=` link, an
 * online start, rejoin or playAgain, a hole reached without its levelStart) re-bases both trackers through `sync`
 * (GameCanvas: view.plates and AudioSystem.syncPlates), and the events fed after it are exactly the later ones.
 * Taken at any tick, mid-flight too, the re-based tracker then says what a tracker that saw every event says, except
 * what a snapshot does not carry (see `sync`).
 */
import { hasLevel, levelById } from '../sim/levels/index';
import { isRectActive, rectContains, rectSwitchIds } from '../sim/terrain';
import type { BallState, Level, LevelRect, LevelRectKind, PlayerId, PressureSwitch, SimEvent, Vec } from '../sim/types';
import { BALL_RADIUS, SWITCH_CONTACT_TOLERANCE } from '../sim/types';

export type PlateMoment =
  /** A plate went down (a ball touched it). `fresh`: it had been up a while, so this is not the same landing rocking. */
  | { readonly kind: 'press'; readonly switchId: string; readonly pos: Vec; readonly tick: number; readonly fresh: boolean }
  /** A plate came up. `ended`: it had been HELD, so a hold is over (its holder left); otherwise a ball passed over it. */
  | { readonly kind: 'release'; readonly switchId: string; readonly pos: Vec; readonly tick: number; readonly ended: boolean }
  /** The press lasts: a ball rests on the plate, a respawn put one there, or the cup holds it. */
  | { readonly kind: 'held'; readonly switchId: string; readonly pos: Vec; readonly tick: number }
  /** A door, window, bridge or fan changed for good (`active` as in `bridgeToggle`): opened with a HELD plate, or back to rest. */
  | { readonly kind: 'way'; readonly rectId: string; readonly rectKind: LevelRectKind; readonly active: boolean; readonly switchId: string; readonly tick: number }
  /** The way's back-to-rest word no longer stands: a press that does not last moved it again (`switchId` drove that toggle). */
  | { readonly kind: 'unsay'; readonly rectId: string; readonly rectKind: LevelRectKind; readonly switchId: string; readonly tick: number }
  /** A ball's SNAP! no longer stands: a free that does not last opened the jaws of `rectId` on it again. */
  | { readonly kind: 'unsnap'; readonly playerId: PlayerId; readonly rectId: string; readonly tick: number }
  /**
   * A trap's jaws on a ball (`trapCaught` / `trapFreed`, or a free announced `late`). `lasting`: a catch, a catch
   * after a free that lasted, or a free a HELD release plate (or the cup) keeps open. A `late` free carries no
   * event of its own: the jaws sprang on an earlier tick, and it is the release plate that has just come to last.
   */
  | {
      readonly kind: 'jaws';
      readonly playerId: PlayerId;
      readonly rectId: string;
      readonly pos: Vec;
      readonly tick: number;
      readonly caught: boolean;
      readonly lasting: boolean;
      readonly late: boolean;
    };

export type PlateTracker = {
  /**
   * The moments `e` causes, in order. `live`: the switch mask `e`'s tick ends with, when the caller has it: a ball that
   * comes to rest on a plate holds it only if the plate is still down then (a mask that says up also makes a tracker
   * that missed a release forget the press). Without it, the tracker's own plates as they stand at `e`.
   */
  feed(e: SimEvent, live?: Readonly<Record<string, boolean>>): PlateMoment[];
  /**
   * The moments of each of `events`, whole ticks in order (a frame's events, a hidden tab's dropped batches): each fed
   * with the mask its tick ends with, read from this tracker's plates and the tick's own switchOn / switchOff. A press
   * a later event of the same tick lets up again is no hold (a ball resting on a plate and sent BACK +1 on that tick).
   * The view and audio both feed this way, so they decide every hold alike.
   */
  feedAll(events: readonly SimEvent[]): PlateMoment[][];
  /**
   * Starts over on `level` from a known state, at any tick; the caller then feeds only events after that state. A plate
   * is HELD when the cup holds it, a ball rests on it, or a ball still moving last came to rest on it (`lastRest`: a
   * holder that has just been shot); a way stands announced as those HELD plates drive it, so a pass-over or a landing
   * still rocking in its dish has said nothing; a ball resting in jaws a press keeps open with no HELD release is let
   * go only for now, as `trapFreed` records it. The tracker has said no word yet, so it has none to take back. A
   * snapshot does not carry when a plate came up (a plate up at the sync presses `fresh`), nor a rest off permanent
   * ground (the sim keeps a ball's safe spot only there, so the holder of a deck plate already rolling at the sync reads
   * as a ball passing over it), nor a holder's hop that has landed back on its plate (it reads as still holding: its
   * rest then says no HELD and OPEN).
   */
  sync(level: Level | null, switches: Readonly<Record<string, boolean>>, balls?: readonly Readonly<BallState>[]): void;
};

/**
 * A plate that had been up for this long (1 s) presses `fresh` again. The same landing re-presses its plate after a
 * median 30 ticks and within 60 ticks 97 % of the time (2,521 re-presses on the shipped holes).
 */
export const FRESH_PRESS_TICKS = 60;

/**
 * A word (a way's SHUT / GONE, a ball's SNAP!) stands this long (1.5 s) after it is said and can be taken back until
 * then: longer than its callout lives on screen (view CALLOUT_TTL, 1.1 s) and its sound plays (a slide 0.35 s, a snap
 * 0.3 s). An older word has nothing left to take back, and a re-based tracker, which said nothing, agrees with one
 * that saw every event.
 */
export const WORD_STANDS_TICKS = 90;

/** Rect kinds a plate opens or closes for a ball: doors and windows (blockers), bridges, switch-driven fans. */
const WAY_KINDS: ReadonlySet<LevelRectKind> = new Set<LevelRectKind>(['blocker', 'bridge', 'fan']);

/** Is `pos` (a ball centre) resting in `sw`'s press zone: centre over the plate, bottom on its surface. */
function restsOnPlate(sw: PressureSwitch, pos: Vec): boolean {
  return pos.x >= sw.x && pos.x <= sw.x + sw.w && Math.abs(pos.y + BALL_RADIUS - sw.surfaceY) <= SWITCH_CONTACT_TOLERANCE;
}

function plateTop(sw: PressureSwitch): Vec {
  return { x: sw.x + sw.w / 2, y: sw.surfaceY };
}

function isWay(rect: LevelRect): boolean {
  return WAY_KINDS.has(rect.kind) && rectSwitchIds(rect).length > 0;
}

/** A rect's state with no plate down: a door shut, a bridge out, a fan off. */
function restState(rect: LevelRect): boolean {
  return isRectActive(rect, {});
}

/** Was a word said at `said` still standing at `tick`. */
function stands(said: number, tick: number): boolean {
  return tick - said < WORD_STANDS_TICKS;
}

/** sync: a ball resting on the plate, or one still moving whose last rest was on it (a holder that has just been shot). */
function holdsAtSync(sw: PressureSwitch, b: Readonly<BallState>): boolean {
  if (b.sunk) return false;
  return restsOnPlate(sw, b.asleep ? b.pos : b.lastRest);
}

/** feedAll: the end of the run of `events` from `from` that is one tick (a levelStart starts the hole over: a run of its own). */
function tickRunEnd(events: readonly SimEvent[], from: number): number {
  const tick = (events[from] as SimEvent).tick;
  let to = from + 1;
  while (to < events.length && (events[to] as SimEvent).tick === tick && (events[to] as SimEvent).type !== 'levelStart') to += 1;
  return to;
}

const registryLevel = (id: string): Level | null => (hasLevel(id) ? levelById(id) : null);

export function createPlateTracker(levelFor: (id: string) => Level | null = registryLevel): PlateTracker {
  let level: Level | null = null;
  const down = new Set<string>();
  const held = new Set<string>();
  /** switchId -> the tick the plate last came up. */
  const upAt = new Map<string, number>();
  /** rectId -> the state last announced (a WAY moment); absent = its rest state. */
  const announced = new Map<string, boolean>();
  /** rectId -> the tick its back-to-rest word (SHUT, GONE) was said, while that is the last thing said about the way. */
  const standing = new Map<string, number>();
  /** slot -> the trap and tick of its SNAP!, while that is the last thing said about the ball's jaws. */
  const snapped = new Map<PlayerId, { rectId: string; tick: number }>();
  const sunk: [boolean, boolean] = [false, false];
  /** Balls put down at rest this tick (rests and respawns): a press in the same tick by one of them is a hold at once. */
  let settled: { tick: number; spots: Vec[] } = { tick: -1, spots: [] };
  /** slot -> the trap that let it go while no release plate lasted: still caught as far as anything announced. */
  const looseIn = new Map<PlayerId, { rectId: string; pos: Vec }>();

  const mask = (): Record<string, boolean> => Object.fromEntries([...down].map((id) => [id, true]));
  const announcedState = (rect: LevelRect): boolean => announced.get(rect.id) ?? restState(rect);
  const releases = (rectId: string): readonly string[] => {
    const rect = level?.rects.find((r) => r.id === rectId);
    return rect === undefined ? [] : rectSwitchIds(rect);
  };

  /** HELD, then every way this plate drives that now stands changed from what was last announced, then the frees it keeps. */
  const hold = (sw: PressureSwitch, tick: number, out: PlateMoment[]): void => {
    held.add(sw.id);
    out.push({ kind: 'held', switchId: sw.id, pos: plateTop(sw), tick });
    if (level === null) return;
    const now = mask();
    for (const rect of level.rects) {
      if (!isWay(rect) || !rectSwitchIds(rect).includes(sw.id)) continue;
      const active = isRectActive(rect, now);
      if (active === announcedState(rect)) continue;
      announced.set(rect.id, active);
      // a held plate presses the way, so this is never its rest state
      standing.delete(rect.id);
      out.push({ kind: 'way', rectId: rect.id, rectKind: rect.kind, active, switchId: sw.id, tick });
    }
    for (const [playerId, loose] of looseIn) {
      if (!releases(loose.rectId).includes(sw.id)) continue;
      looseIn.delete(playerId);
      snapped.delete(playerId);
      out.push({ kind: 'jaws', playerId, rectId: loose.rectId, pos: loose.pos, tick, caught: false, lasting: true, late: true });
    }
  };

  const isDown = (id: string, live: Readonly<Record<string, boolean>> | undefined): boolean => (live === undefined ? down.has(id) : live[id] === true);

  /** A ball now rests at `pos`: every plate it is on that is down and not yet HELD becomes HELD. */
  const settleAt = (pos: Vec, tick: number, live: Readonly<Record<string, boolean>> | undefined, out: PlateMoment[]): void => {
    if (settled.tick !== tick) settled = { tick, spots: [] };
    settled.spots.push(pos);
    if (level === null) return;
    for (const sw of level.switches) {
      if (held.has(sw.id) || !restsOnPlate(sw, pos)) continue;
      if (!isDown(sw.id, live)) {
        // the live mask says up: a tracker that missed a release forgets the press
        down.delete(sw.id);
        continue;
      }
      down.add(sw.id);
      hold(sw, tick, out);
    }
  };

  const cupHolds = (id: string): boolean => level !== null && level.cupHoldsSwitch === id && (sunk[0] || sunk[1]);

  const reset = (next: Level | null): void => {
    level = next;
    down.clear();
    held.clear();
    upAt.clear();
    announced.clear();
    standing.clear();
    snapped.clear();
    sunk[0] = false;
    sunk[1] = false;
    settled = { tick: -1, spots: [] };
    looseIn.clear();
  };

  const onSunk = (slot: PlayerId, tick: number, out: PlateMoment[]): void => {
    sunk[slot] = true;
    const cup = level?.switches.find((sw) => sw.id === level?.cupHoldsSwitch);
    if (cup !== undefined && down.has(cup.id) && !held.has(cup.id)) hold(cup, tick, out);
  };

  const feed = (e: SimEvent, live?: Readonly<Record<string, boolean>>): PlateMoment[] => {
    const out: PlateMoment[] = [];
    switch (e.type) {
      case 'levelStart':
        reset(levelFor(e.levelId));
        break;
      case 'switchOn': {
        const last = upAt.get(e.switchId);
        down.add(e.switchId);
        out.push({ kind: 'press', switchId: e.switchId, pos: e.pos, tick: e.tick, fresh: last === undefined || e.tick - last >= FRESH_PRESS_TICKS });
        const sw = level?.switches.find((s) => s.id === e.switchId);
        if (sw === undefined || held.has(sw.id)) break;
        const putDown = settled.tick === e.tick && settled.spots.some((p) => restsOnPlate(sw, p));
        if (putDown || cupHolds(sw.id)) hold(sw, e.tick, out);
        break;
      }
      case 'switchOff':
        down.delete(e.switchId);
        upAt.set(e.switchId, e.tick);
        out.push({ kind: 'release', switchId: e.switchId, pos: e.pos, tick: e.tick, ended: held.delete(e.switchId) });
        break;
      case 'bridgeToggle': {
        // only the way back to rest is announced here, and only when the opposite was announced; the rest waits for a
        // hold. A move off a rest word that stands takes the word back: a press that does not last made it
        const rect = level?.rects.find((r) => r.id === e.rectId);
        if (rect === undefined || !isWay(rect)) break;
        if (e.active !== restState(rect)) {
          const said = standing.get(rect.id);
          standing.delete(rect.id);
          if (said !== undefined && stands(said, e.tick)) out.push({ kind: 'unsay', rectId: rect.id, rectKind: rect.kind, switchId: e.switchId, tick: e.tick });
          break;
        }
        if (announcedState(rect) === e.active) break;
        announced.set(rect.id, e.active);
        standing.set(rect.id, e.tick);
        out.push({ kind: 'way', rectId: rect.id, rectKind: rect.kind, active: e.active, switchId: e.switchId, tick: e.tick });
        break;
      }
      case 'trapFreed': {
        // a free lasts while a HELD release plate (or the cup) keeps the trap open; otherwise the ball is let go only
        // while a rolling ball is on the plate, and the free is announced once that plate comes to last. Either way the
        // ball's SNAP! no longer stands: FREE! replaces a lasting one, and a free that does not last takes it back
        const lasting = level === null || releases(e.rectId).some((id) => held.has(id) || cupHolds(id));
        if (lasting) looseIn.delete(e.playerId);
        else looseIn.set(e.playerId, { rectId: e.rectId, pos: e.pos });
        const snap = snapped.get(e.playerId);
        snapped.delete(e.playerId);
        if (!lasting && snap !== undefined && snap.rectId === e.rectId && stands(snap.tick, e.tick)) {
          out.push({ kind: 'unsnap', playerId: e.playerId, rectId: e.rectId, tick: e.tick });
        }
        out.push({ kind: 'jaws', playerId: e.playerId, rectId: e.rectId, pos: e.pos, tick: e.tick, caught: false, lasting, late: false });
        break;
      }
      case 'trapCaught': {
        // caught again before any free was announced: the jaws closed on a ball that, as far as anyone heard, never got out
        const regained = looseIn.get(e.playerId)?.rectId === e.rectId;
        looseIn.delete(e.playerId);
        if (!regained) snapped.set(e.playerId, { rectId: e.rectId, tick: e.tick });
        out.push({ kind: 'jaws', playerId: e.playerId, rectId: e.rectId, pos: e.pos, tick: e.tick, caught: true, lasting: !regained, late: false });
        break;
      }
      case 'ballRest':
        settleAt(e.pos, e.tick, live, out);
        break;
      case 'fellOffWorld':
      case 'trapReturn':
      case 'flightTimeout':
        looseIn.delete(e.playerId);
        snapped.delete(e.playerId);
        settleAt(e.respawnPos, e.tick, live, out);
        break;
      case 'sink':
      case 'gimme':
        onSunk(e.playerId, e.tick, out);
        break;
      default:
        break;
    }
    return out;
  };

  return {
    feed,

    feedAll(events) {
      const out: PlateMoment[][] = [];
      for (let from = 0; from < events.length; ) {
        const to = tickRunEnd(events, from);
        // the plates as this tick leaves them: those down now (none once a levelStart starts over), then its own switch events
        const ends = new Set(events[from]?.type === 'levelStart' ? [] : down);
        for (let i = from; i < to; i += 1) {
          const e = events[i] as SimEvent;
          if (e.type === 'switchOn') ends.add(e.switchId);
          else if (e.type === 'switchOff') ends.delete(e.switchId);
        }
        const live = Object.fromEntries([...ends].map((id) => [id, true]));
        for (let i = from; i < to; i += 1) out.push(feed(events[i] as SimEvent, live));
        from = to;
      }
      return out;
    },

    sync(next, switches, balls = []) {
      reset(next);
      if (next === null) return;
      sunk[0] = balls[0]?.sunk === true;
      sunk[1] = balls[1]?.sunk === true;
      for (const sw of next.switches) {
        if (switches[sw.id] !== true) continue;
        down.add(sw.id);
        if (cupHolds(sw.id) || balls.some((b) => holdsAtSync(sw, b))) held.add(sw.id);
      }
      // only a HELD plate announces a way, so the ways stand announced as the HELD plates alone drive them
      const heldMask = Object.fromEntries([...held].map((id) => [id, true]));
      for (const rect of next.rects) if (isWay(rect)) announced.set(rect.id, isRectActive(rect, heldMask));
      // a ball resting in jaws a press keeps open while no release plate (nor the cup) lasts: trapFreed's loose ball
      balls.forEach((b, slot) => {
        if (!b.asleep || b.sunk) return;
        const trap = next.rects.find((r) => r.kind === 'trap' && rectContains(r, b.pos) && !isRectActive(r, switches));
        if (trap === undefined || rectSwitchIds(trap).some((id) => held.has(id) || cupHolds(id))) return;
        looseIn.set(slot as PlayerId, { rectId: trap.id, pos: b.pos });
      });
    },
  };
}
