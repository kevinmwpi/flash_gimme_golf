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
 *   and the free is announced (`late`) when the rescuer settles on the plate.
 * Events only, so audio (which never sees SimState) can run it; the view passes the live switch mask to confirm a
 * hold, which also heals a tracker that missed events (an online client drops events past its replay window). A
 * state the events did not bring (a `?state=` link, an online rejoin or sync, a dropped levelStart) re-bases both
 * trackers through `sync` (GameCanvas: view.plates and AudioSystem.syncPlates, with the state it draws).
 */
import { hasLevel, levelById } from '../sim/levels/index';
import { isRectActive, rectSwitchIds } from '../sim/terrain';
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
  /** The moments `e` causes, in order. `live`: the switch mask after `e`'s tick, when the caller has it (it confirms a hold). */
  feed(e: SimEvent, live?: Readonly<Record<string, boolean>>): PlateMoment[];
  /** Starts over on `level` from a known state: plates down, holds of resting balls and the cup, ways as they stand. */
  sync(level: Level | null, switches: Readonly<Record<string, boolean>>, balls?: readonly Readonly<BallState>[]): void;
};

/**
 * A plate that had been up for this long (1 s) presses `fresh` again. The same landing re-presses its plate after a
 * median 30 ticks and within 60 ticks 97 % of the time (2,521 re-presses on the shipped holes).
 */
export const FRESH_PRESS_TICKS = 60;

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

const registryLevel = (id: string): Level | null => (hasLevel(id) ? levelById(id) : null);

export function createPlateTracker(levelFor: (id: string) => Level | null = registryLevel): PlateTracker {
  let level: Level | null = null;
  const down = new Set<string>();
  const held = new Set<string>();
  /** switchId -> the tick the plate last came up. */
  const upAt = new Map<string, number>();
  /** rectId -> the state last announced (a WAY moment); absent = its rest state. */
  const announced = new Map<string, boolean>();
  /** Ways whose back-to-rest word (SHUT, GONE) is the last thing said about them and still stands. */
  const standing = new Set<string>();
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

  return {
    sync(next, switches, balls = []) {
      reset(next);
      if (next === null) return;
      sunk[0] = balls[0]?.sunk === true;
      sunk[1] = balls[1]?.sunk === true;
      for (const sw of next.switches) {
        if (switches[sw.id] !== true) continue;
        down.add(sw.id);
        if (cupHolds(sw.id) || balls.some((b) => b.asleep && !b.sunk && restsOnPlate(sw, b.pos))) held.add(sw.id);
      }
      for (const rect of next.rects) if (isWay(rect)) announced.set(rect.id, isRectActive(rect, switches));
    },

    feed(e, live) {
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
            if (standing.delete(rect.id)) out.push({ kind: 'unsay', rectId: rect.id, rectKind: rect.kind, switchId: e.switchId, tick: e.tick });
            break;
          }
          if (announcedState(rect) === e.active) break;
          announced.set(rect.id, e.active);
          standing.add(rect.id);
          out.push({ kind: 'way', rectId: rect.id, rectKind: rect.kind, active: e.active, switchId: e.switchId, tick: e.tick });
          break;
        }
        case 'trapFreed': {
          // a free lasts while a HELD release plate (or the cup) keeps the trap open; otherwise the ball is let go only
          // while a rolling ball is on the plate, and the free is announced once that plate comes to last
          const lasting = level === null || releases(e.rectId).some((id) => held.has(id) || cupHolds(id));
          if (lasting) looseIn.delete(e.playerId);
          else looseIn.set(e.playerId, { rectId: e.rectId, pos: e.pos });
          out.push({ kind: 'jaws', playerId: e.playerId, rectId: e.rectId, pos: e.pos, tick: e.tick, caught: false, lasting, late: false });
          break;
        }
        case 'trapCaught': {
          // caught again before any free was announced: the jaws closed on a ball that, as far as anyone heard, never got out
          const regained = looseIn.get(e.playerId)?.rectId === e.rectId;
          looseIn.delete(e.playerId);
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
    },
  };
}
