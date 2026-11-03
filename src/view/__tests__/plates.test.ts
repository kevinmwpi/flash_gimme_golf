// OWNER: view
// BUILD_DECISIONS D11 on screen: a plate goes down the moment a ball touches it, but HELD, OPEN / SHUT words, the
// sparks after the first press and (audio.test.ts) the confirm chime and the door slide wait for a press that LASTS
// (plates.ts). Real-sim shots on Two Doors and Load & Fire, then the tracker's edge cases.
import { describe, expect, it } from 'vitest';
import { EVENT_REPLAY_WINDOW_MS } from '../../net/GameClient';
import { GOLDEN_LINES, type GoldenLine } from '../../sim/__tests__/levels-golden';
import { waitingOf } from '../../sim/devices';
import { LEVELS, levelById } from '../../sim/levels/index';
import { level as twoDoors } from '../../sim/levels/w1-02-two-doors';
import { level as plateAndBridge } from '../../sim/levels/w1-04-plate-and-bridge';
import { level as boobyTrap } from '../../sim/levels/w2-06-booby-trap';
import { level as loadAndFire } from '../../sim/levels/w2-07-load-and-fire';
import { evaluateSwitches } from '../../sim/physics';
import { createSim, stepSim } from '../../sim/sim';
import { isRectActive, rectSwitchIds } from '../../sim/terrain';
import type { Aim, BallState, Level, PlayerCommand, PlayerId, SimEvent, SimState, Vec } from '../../sim/types';
import { AIM_ANGLE_MAX, AIM_ANGLE_MIN, BALL_RADIUS, DT, REST_TICKS, SWITCH_CONTACT_TOLERANCE, quantize4 } from '../../sim/types';
import { holdsOf, waitingChipOf } from '../GameCanvas';
import { FRESH_PRESS_TICKS, WORD_STANDS_TICKS, createPlateTracker, type PlateMoment } from '../plates';
import { CALLOUT_TTL, PLATE_CLICK_SEC, applySimEvents, createViewState, updateView, type ViewState } from '../view';

type Tick = { readonly state: SimState; readonly events: readonly SimEvent[] };

const RED: PlayerId = 0;
const BLUE: PlayerId = 1;
const STALL = (power: number): Aim => ({ angle: quantize4(-Math.PI / 2), power });
/** Flat out to the right at full power: a roll along the fairway. */
const ROLL = (power: number): Aim => ({ angle: AIM_ANGLE_MAX, power });

const rest = (pos: Vec): BallState => ({ pos, vel: { x: 0, y: 0 }, asleep: true, sunk: false, grounded: true, restTicks: REST_TICKS, lastRest: pos });

function plateSpot(level: Level, id: string, dx = 0): Vec {
  const sw = level.switches.find((s) => s.id === id);
  if (sw === undefined) throw new Error(`no plate ${id}`);
  return { x: sw.x + sw.w / 2 + dx, y: sw.surfaceY - BALL_RADIUS };
}

function rectOf(level: Level, id: string): Level['rects'][number] {
  const r = level.rects.find((x) => x.id === id);
  if (r === undefined) throw new Error(`no rect ${id}`);
  return r;
}

/**
 * The hole past its intro card with both balls resting where given (switches as they imply) and `active` to shoot.
 * `seed` presses plates before the balls are read: a deck plate can only be found down while its bridge stands.
 */
function crafted(level: Level, red: Vec, blue: Vec, active: PlayerId, seed: Record<string, boolean> = {}): SimState {
  const intro = stepSim(createSim({ playerCount: 2, levelIds: [level.id], seed: 7, mode: 'local' }).state, [{ type: 'continue', playerId: RED }]).state;
  const balls: [BallState, BallState] = [rest(red), rest(blue)];
  const up = { ...Object.fromEntries(level.switches.map((s) => [s.id, false])), ...seed };
  const switches = evaluateSwitches(level, evaluateSwitches(level, up, balls), balls);
  return { ...intro, balls, switches, activePlayer: active, turnDelayTicks: 0, phase: 'aiming' };
}

/** A shot `deg` degrees up from flat right (90 = straight up, 180 = flat left) at `power`, as a player can aim it. */
const AIM = (deg: number, power: number): Aim => ({ angle: quantize4(Math.min(AIM_ANGLE_MAX, Math.max(AIM_ANGLE_MIN, (-deg * Math.PI) / 180))), power });

/** The active ball's shot, every tick until the next shot could be taken. */
function shot(state: SimState, aim: Aim): Tick[] {
  const p = state.activePlayer;
  let r = stepSim(state, [
    { type: 'setAim', playerId: p, ...aim },
    { type: 'shoot', playerId: p },
  ]);
  const ticks: Tick[] = [r];
  for (let i = 0; i < 1500 && (r.state.phase === 'flying' || r.state.turnDelayTicks > 0); i += 1) {
    r = stepSim(r.state, []);
    ticks.push(r);
  }
  if (r.state.phase === 'flying') throw new Error('the shot never settled');
  return ticks;
}

/** Feeds a fresh tracker every event, as audio does (events only), and returns its moments with their ticks. */
function trackerMoments(start: SimState, level: Level, ticks: readonly Tick[]): PlateMoment[] {
  const tracker = createPlateTracker(() => level);
  tracker.sync(level, start.switches, start.balls);
  return ticks.flatMap((t) => t.events.flatMap((e) => tracker.feed(e)));
}

type Seen = { readonly tick: number; readonly text: string };

/** Plays the ticks into a view as GameCanvas does; returns every callout as it is born, the streak bursts and the
 *  callouts alive on each tick. */
function viewOf(start: SimState, level: Level, ticks: readonly Tick[]): { view: ViewState; born: Seen[]; bursts: number[]; alive: string[][] } {
  const view = createViewState(level, start);
  view.reducedMotion = false;
  const born: Seen[] = [];
  const bursts: number[] = [];
  const alive: string[][] = [];
  let lastId = 0;
  let prev = start;
  for (const t of ticks) {
    const streaks = view.particles.filter((p) => p.shape === 'streak').length;
    applySimEvents(view, t.events, t.state);
    if (view.particles.filter((p) => p.shape === 'streak').length > streaks) bursts.push(t.state.tick);
    for (const c of view.callouts) if (c.id > lastId) born.push({ tick: t.state.tick, text: c.text });
    lastId = Math.max(lastId, ...view.callouts.map((c) => c.id));
    updateView(view, prev, t.state, 1, DT);
    alive.push(view.callouts.map((c) => c.text));
    prev = t.state;
  }
  return { view, born, bursts, alive };
}

const ofType = <T extends SimEvent['type']>(ticks: readonly Tick[], type: T): Extract<SimEvent, { type: T }>[] =>
  ticks.flatMap((t) => t.events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type));

/** Every tick's state and events of a golden line, from createSim (the solver's config: seed 1, local). */
function goldenRun(g: GoldenLine): { level: Level; states: SimState[]; events: SimEvent[][] } {
  const level = levelById(g.levelId);
  const first = createSim({ playerCount: 2, levelIds: [g.levelId], seed: 1, mode: 'local' });
  const byTick = new Map<number, PlayerCommand[]>();
  for (const e of g.log) byTick.set(e.tick, [...(byTick.get(e.tick) ?? []), e.cmd]);
  const states: SimState[] = [first.state];
  const events: SimEvent[][] = [[...first.events]];
  let s = first.state;
  while (s.tick < g.finalTick) {
    const r = stepSim(s, byTick.get(s.tick) ?? []);
    s = r.state;
    states[s.tick] = s;
    events[s.tick] = [...r.events];
  }
  return { level, states, events };
}

describe('Two Doors: a ball rolling across the DOOR plate (real sim)', () => {
  // red rolls flat out from its tee: onto the DOOR plate, across it (the door opens and shuts before red gets
  // there, red bounces off it), back across it, up the tee-side ramp and back onto it, where it rests
  const start = crafted(twoDoors, twoDoors.starts[0], twoDoors.starts[1], RED);
  const ticks = shot(start, ROLL(100));
  const moments = trackerMoments(start, twoDoors, ticks).filter((m) => ('switchId' in m ? m.switchId === 'door' : true));
  const restTick = ofType(ticks, 'ballRest').find((e) => e.playerId === RED)?.tick ?? -1;

  it('the sim: the door opened as red crossed, shut before red reached it, and red rests on the plate', () => {
    const doorOpenAt = ticks.filter((t) => t.state.switches.door === true).map((t) => t.state.tick);
    const bounceOffDoor = ofType(ticks, 'bounce').find((e) => e.surface === 'blocker');
    expect(bounceOffDoor).toBeDefined();
    const shutWhenHit = ticks.find((t) => t.state.tick === bounceOffDoor?.tick)?.state.switches.door;
    expect(shutWhenHit).toBe(false);
    expect(doorOpenAt.length).toBeGreaterThan(0);
    expect(ofType(ticks, 'switchOn').filter((e) => e.switchId === 'door').length).toBeGreaterThanOrEqual(2);
    expect(restTick).toBeGreaterThan(0);
    expect(ticks[ticks.length - 1]?.state.switches.door).toBe(true);
  });

  it('every touch is a press, only the first one fresh; every lift before the rest is a pass, not the end of a hold', () => {
    const presses = moments.filter((m) => m.kind === 'press');
    expect(presses.length).toBeGreaterThanOrEqual(2);
    expect(presses.map((m) => m.kind === 'press' && m.fresh)).toEqual([true, ...presses.slice(1).map(() => false)]);
    const releases = moments.filter((m) => m.kind === 'release');
    expect(releases.length).toBe(presses.length - 1);
    expect(releases.every((m) => m.kind === 'release' && !m.ended)).toBe(true);
  });

  it('HELD and DOOR OPEN come once, together, on the tick red comes to rest', () => {
    const lasting = moments.filter((m) => m.kind === 'held' || m.kind === 'way');
    expect(lasting).toEqual([
      { kind: 'held', switchId: 'door', pos: { x: 795, y: 640 }, tick: restTick },
      { kind: 'way', rectId: 'door-gate', rectKind: 'blocker', active: false, switchId: 'door', tick: restTick },
    ]);
  });

  it('the view says DOOR HELD and DOOR OPEN at the rest, never SHUT or HELD while red rolls, and sparks once', () => {
    const { born, bursts, view } = viewOf(start, twoDoors, ticks);
    expect(born).toEqual([
      { tick: restTick, text: 'DOOR HELD' },
      { tick: restTick, text: 'DOOR OPEN' },
    ]);
    const firstPress = ofType(ticks, 'switchOn')[0]?.tick;
    expect(bursts).toEqual([firstPress]);
    // the plate's sticker popped on the fresh press only (it is a long way back by now)
    expect(view.stickerPulse.has('switch:door')).toBe(true);
  });
});

describe('a stall tap on a held plate (real sim)', () => {
  const start = crafted(twoDoors, plateSpot(twoDoors, 'door'), twoDoors.starts[1], RED);

  it('at low power the plate never comes up: no moment, no word, no spark, the door open every tick', () => {
    const ticks = shot(start, STALL(10));
    expect(ticks.every((t) => t.state.switches.door === true)).toBe(true);
    expect(trackerMoments(start, twoDoors, ticks)).toEqual([]);
    const { born, bursts } = viewOf(start, twoDoors, ticks);
    expect(born).toEqual([]);
    expect(bursts).toEqual([]);
  });

  it('too hard a tap lifts off: DOOR SHUT as it rises, taken back as it lands on the plate again, DOOR HELD and DOOR OPEN when it settles, never SHUT and OPEN at once', () => {
    const ticks = shot(start, STALL(50));
    const moments = trackerMoments(start, twoDoors, ticks);
    expect(moments.map((m) => m.kind)).toEqual(['release', 'way', 'press', 'unsay', 'held', 'way']);
    expect(moments[0]).toMatchObject({ kind: 'release', ended: true });
    expect(moments[1]).toMatchObject({ kind: 'way', rectId: 'door-gate', active: true });
    expect(moments[2]).toMatchObject({ kind: 'press', fresh: false });
    // the landing presses DOOR again and the door opens on that tick: DOOR SHUT no longer stands
    expect(moments[3]).toEqual({ kind: 'unsay', rectId: 'door-gate', rectKind: 'blocker', switchId: 'door', tick: moments[2]?.tick });
    const { born, alive } = viewOf(start, twoDoors, ticks);
    expect(born.map((s) => s.text)).toEqual(['DOOR SHUT', 'DOOR HELD', 'DOOR OPEN']);
    expect(alive.some((texts) => texts.includes('DOOR SHUT') && texts.includes('DOOR OPEN'))).toBe(false);
  });
});

describe('Load & Fire: the partner rolls across FIRE (real sim)', () => {
  const cannon = rectOf(loadAndFire, 'cannon');
  const breech = { x: cannon.x + cannon.w / 2, y: cannon.y - BALL_RADIUS };
  const start = crafted(loadAndFire, breech, loadAndFire.starts[1], BLUE);
  const ticks = shot(start, ROLL(70));

  it('the loaded ball fires as blue touches FIRE and blue rolls on: the near FIRE plate is pressed, never HELD', () => {
    const [press] = ofType(ticks, 'switchOn');
    const [fire] = ofType(ticks, 'cannonFire');
    expect(press).toMatchObject({ switchId: 'fire', byPlayer: BLUE });
    expect(fire).toMatchObject({ playerId: RED, rectId: 'cannon' });
    expect((fire?.tick ?? 0) - (press?.tick ?? 0)).toBeLessThanOrEqual(1);
    expect(ticks[ticks.length - 1]?.state.switches.fire).toBe(false);
    const moments = trackerMoments(start, loadAndFire, ticks).filter((m) => 'switchId' in m && m.switchId === 'fire');
    expect(moments.map((m) => m.kind)).toEqual(['press', 'release']);
    const { born, bursts } = viewOf(start, loadAndFire, ticks);
    expect(bursts[0]).toBe(press?.tick);
    // BOOM! as blue passes; the only FIRE HELD is red's, when the shot it rode comes to rest on the far FIRE plate
    expect(born.find((s) => s.text === 'BOOM!')?.tick).toBe(fire?.tick);
    const redRest = ofType(ticks, 'ballRest').find((e) => e.playerId === RED);
    const farPlate = loadAndFire.switches.find((s) => s.id === 'fire-far');
    expect(redRest !== undefined && farPlate !== undefined && redRest.pos.x >= farPlate.x && redRest.pos.x <= farPlate.x + farPlate.w).toBe(true);
    expect(born.filter((s) => s.text === 'FIRE HELD')).toEqual([{ tick: redRest?.tick, text: 'FIRE HELD' }]);
  });
});

describe('a way word never contradicts the way it names (D11, real sim)', () => {
  type Rect = Level['rects'][number];
  /** What a live way callout claims: the rect its subject names (`rect:<id>`) and whether it calls the way passable. */
  function claimOf(level: Level, c: { readonly text: string; readonly subject?: string | undefined }): { rect: Rect; open: boolean } | null {
    const rect = level.rects.find((r) => c.subject === `rect:${r.id}`);
    if (rect === undefined) return null;
    if (/ (SHUT|GONE)$/.test(c.text)) return { rect, open: false };
    return / OPEN$/.test(c.text) ? { rect, open: true } : null;
  }
  /** A door or window lets a ball through while inactive, a bridge while active. */
  const passable = (rect: Rect, switches: Readonly<Record<string, boolean>>): boolean => (rect.kind === 'bridge' ? isRectActive(rect, switches) : !isRectActive(rect, switches));

  /** Plays the ticks into a view one per frame (a local game at 60 Hz) and lists each frame a live way word contradicts its way. */
  function contradictions(start: SimState, level: Level, ticks: readonly Tick[]): string[] {
    const view = createViewState(level, start);
    const out: string[] = [];
    let prev = start;
    for (const t of ticks) {
      applySimEvents(view, t.events, t.state);
      updateView(view, prev, t.state, 1, DT);
      for (const c of view.callouts) {
        const claim = claimOf(level, c);
        if (claim !== null && claim.open !== passable(claim.rect, t.state.switches)) out.push(`t${t.state.tick} ${c.text}`);
      }
      prev = t.state;
    }
    return out;
  }

  // red rests on DOOR (its hold keeps the door open) and taps; the review's cases, the build's STALL(50) among them
  const holder = crafted(twoDoors, plateSpot(twoDoors, 'door'), twoDoors.starts[1], RED);

  it.each([
    ['the stall tap 90/50', 90, 50],
    ['an off-vertical tap 107/40', 107, 40],
    ['a tap 100/45', 100, 45],
    ['a tap 75/35', 75, 35],
  ])('%s lifts the holder off DOOR and lands it back on the plate: DOOR SHUT goes the tick the door opens again', (_case, deg, power) => {
    const ticks = shot(holder, AIM(deg, power));
    const off = ofType(ticks, 'switchOff').find((e) => e.switchId === 'door');
    const on = ofType(ticks, 'switchOn').find((e) => e.switchId === 'door');
    const restTick = ofType(ticks, 'ballRest').find((e) => e.playerId === RED)?.tick;
    // the hold ended as red rose, a press that did not last opened the door again, and red settled on the plate
    expect(off).toBeDefined();
    expect(on?.tick).toBeGreaterThan(off?.tick ?? Infinity);
    expect(ticks[ticks.length - 1]?.state.switches.door).toBe(true);
    expect(contradictions(holder, twoDoors, ticks)).toEqual([]);
    expect(viewOf(holder, twoDoors, ticks).born).toEqual([
      { tick: off?.tick, text: 'DOOR SHUT' },
      { tick: restTick, text: 'DOOR HELD' },
      { tick: restTick, text: 'DOOR OPEN' },
    ]);
  });

  it('L4: a lone deck ball lobs off its deck (BRIDGE GONE) onto FAR, which brings the planks back while it rolls there: the word goes with them', () => {
    const deck = plateSpot(plateAndBridge, 'deck');
    const start = crafted(plateAndBridge, { x: 960, y: deck.y }, plateAndBridge.starts[1], RED, { deck: true });
    expect(start.switches.deck).toBe(true);
    const ticks = shot(start, AIM(40, 70));
    const far = ofType(ticks, 'switchOn').find((e) => e.switchId === 'far');
    const deckOff = ofType(ticks, 'switchOff').find((e) => e.switchId === 'deck');
    expect(far?.tick).toBeGreaterThan(deckOff?.tick ?? Infinity);
    expect(contradictions(start, plateAndBridge, ticks)).toEqual([]);
    expect(viewOf(start, plateAndBridge, ticks).born).toEqual([{ tick: deckOff?.tick, text: 'BRIDGE GONE' }]);
  });

  it('a holder that leaves DOOR for good: DOOR SHUT the tick the plate comes up, and it stands, the door staying shut', () => {
    const ticks = shot(holder, AIM(150, 60));
    const off = ofType(ticks, 'switchOff').find((e) => e.switchId === 'door');
    expect(ofType(ticks, 'switchOn').filter((e) => e.switchId === 'door')).toEqual([]);
    expect(trackerMoments(holder, twoDoors, ticks).map((m) => m.kind)).toEqual(['release', 'way']);
    expect(contradictions(holder, twoDoors, ticks)).toEqual([]);
    const { born, alive } = viewOf(holder, twoDoors, ticks);
    expect(born).toEqual([{ tick: off?.tick, text: 'DOOR SHUT' }]);
    // alive from the lift until it fades out (CALLOUT_TTL 1.1 s), never taken back
    const from = ticks.findIndex((t) => t.state.tick === off?.tick);
    expect(alive.slice(from, from + 60).every((texts) => texts.includes('DOOR SHUT'))).toBe(true);
  });

  it('a ball lobbed onto DOOR from its tee settles there: DOOR HELD and DOOR OPEN at the rest, nothing to take back', () => {
    const start = crafted(twoDoors, twoDoors.starts[0], twoDoors.starts[1], RED);
    const ticks = shot(start, AIM(42, 80));
    const restTick = ofType(ticks, 'ballRest').find((e) => e.playerId === RED)?.tick;
    expect(ticks[ticks.length - 1]?.state.switches.door).toBe(true);
    expect(trackerMoments(start, twoDoors, ticks).some((m) => m.kind === 'unsay')).toBe(false);
    expect(contradictions(start, twoDoors, ticks)).toEqual([]);
    expect(viewOf(start, twoDoors, ticks).born).toEqual([
      { tick: restTick, text: 'DOOR HELD' },
      { tick: restTick, text: 'DOOR OPEN' },
    ]);
  });
});

describe('Booby Trap: a rescue on FREE (real sim)', () => {
  // red waits caught in the snare; blue shoots from its tee toward FREE
  const snare = rectOf(boobyTrap, 'snare');
  const caughtAt = { x: snare.x + snare.w / 2, y: snare.y + snare.h - BALL_RADIUS };
  const start = crafted(boobyTrap, caughtAt, boobyTrap.starts[1], BLUE);
  const lob = (deg: number, power: number): Aim => ({ angle: quantize4((-deg * Math.PI) / 180), power });

  it('the setup: red is caught, the WAITING rule hands blue the shot', () => {
    expect(waitingOf(boobyTrap, start.switches, start.balls[RED])).toEqual({ reason: 'caught', rectId: 'snare' });
  });

  it('blue rocks on FREE before settling: the jaws flick, and FREE! comes once, when blue rests on the plate', () => {
    const ticks = shot(start, lob(30, 40));
    expect(ofType(ticks, 'trapFreed').length).toBeGreaterThanOrEqual(2);
    expect(ofType(ticks, 'trapCaught').length).toBeGreaterThanOrEqual(1);
    const blueRest = ofType(ticks, 'ballRest').find((e) => e.playerId === BLUE);
    const jaws = trackerMoments(start, boobyTrap, ticks).filter((m) => m.kind === 'jaws');
    expect(jaws.filter((m) => m.kind === 'jaws' && m.lasting)).toEqual([
      { kind: 'jaws', playerId: RED, rectId: 'snare', pos: caughtAt, tick: blueRest?.tick, caught: false, lasting: true, late: true },
    ]);
    const { born } = viewOf(start, boobyTrap, ticks);
    expect(born.map((s) => s.text)).toEqual(['FREE HELD', 'FREE!']);
    expect(born.every((s) => s.tick === blueRest?.tick)).toBe(true);
  });

  it("red's chip stays CAUGHT · needs FREE or FAR while blue rocks on FREE, and red is free the tick blue settles", () => {
    const ticks = shot(start, lob(30, 40));
    const blueRest = ofType(ticks, 'ballRest').find((e) => e.playerId === BLUE);
    const freedAt = ofType(ticks, 'trapFreed')[0]?.tick ?? -1;
    for (const t of ticks) {
      const chip = waitingChipOf(boobyTrap, t.state, RED);
      if (blueRest !== undefined && t.state.tick >= blueRest.tick) expect(chip, `tick ${t.state.tick}`).toBeNull();
      else expect(chip, `tick ${t.state.tick}`).toEqual({ reason: 'caught', release: 'FREE or FAR' });
    }
    // the sim did let red go before blue settled (the jaws flicked), which the chip ignores
    expect(freedAt).toBeLessThan(blueRest?.tick ?? 0);
    expect(ticks.some((t) => t.state.tick < (blueRest?.tick ?? 0) && waitingOf(boobyTrap, t.state.switches, t.state.balls[RED]) === null)).toBe(true);
  });

  it('blue rolls across FREE and stops past it: red was let go and caught again, and nothing says FREE! or SNAP!', () => {
    const ticks = shot(start, ROLL(40));
    expect(ofType(ticks, 'trapFreed')).toHaveLength(1);
    expect(ofType(ticks, 'trapCaught')).toHaveLength(1);
    expect(ofType(ticks, 'turnSkipped')).toMatchObject([{ playerId: RED, reason: 'caught' }]);
    const jaws = trackerMoments(start, boobyTrap, ticks).filter((m) => m.kind === 'jaws');
    expect(jaws.map((m) => m.kind === 'jaws' && m.lasting)).toEqual([false, false]);
    const { born } = viewOf(start, boobyTrap, ticks);
    expect(born.map((s) => s.text).filter((t) => t === 'FREE!' || t === 'SNAP!')).toEqual([]);
  });
});

describe('a jaws word never contradicts the jaws it names (D11, real sim)', () => {
  /** What a live SNAP! / FREE! claims: its subject (`jaws:<slot>`) names the ball, SNAP! says it is caught, FREE! free. */
  function jawsClaim(c: { readonly text: string; readonly subject?: string | undefined }): { p: PlayerId; caught: boolean } | null {
    const slot = /^jaws:([01])$/.exec(c.subject ?? '')?.[1];
    if (slot === undefined || (c.text !== 'SNAP!' && c.text !== 'FREE!')) return null;
    return { p: slot === '0' ? RED : BLUE, caught: c.text === 'SNAP!' };
  }

  /** Plays the ticks into a view one per frame (a local game at 60 Hz) and lists each frame a live jaws word contradicts its ball. */
  function jawsContradictions(start: SimState, level: Level, ticks: readonly Tick[]): string[] {
    const view = createViewState(level, start);
    const out: string[] = [];
    let prev = start;
    for (const t of ticks) {
      applySimEvents(view, t.events, t.state);
      updateView(view, prev, t.state, 1, DT);
      for (const c of view.callouts) {
        const claim = jawsClaim(c);
        if (claim === null) continue;
        const caught = waitingOf(level, t.state.switches, t.state.balls[claim.p])?.reason === 'caught';
        if (claim.caught !== caught) out.push(`t${t.state.tick} ${c.text}`);
      }
      prev = t.state;
    }
    return out;
  }

  /** The seat of a trap: a ball resting on its floor, centred. */
  const seatOf = (rect: Level['rects'][number]): Vec => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h - BALL_RADIUS });

  /** Red waits in `trapId`, freed by blue resting on its release plate `plateId`; blue to shoot. */
  function freedBy(level: Level, trapId: string, plateId: string): SimState {
    return crafted(level, seatOf(rectOf(level, trapId)), plateSpot(level, plateId), BLUE);
  }

  const jawsMoments = (start: SimState, level: Level, ticks: readonly Tick[]): PlateMoment[] =>
    trackerMoments(start, level, ticks).filter((m) => m.kind === 'jaws' || m.kind === 'unsnap');

  it('the grid: blue, holding a release plate, taps 75-105 deg x power 10-60 on every trap of the shipped holes, and no frame has a jaws word that contradicts its ball', () => {
    const offenders: string[] = [];
    const taps: Record<string, number> = {};
    const takenBack: Record<string, number> = {};
    for (const level of LEVELS) {
      for (const trap of level.rects.filter((r) => r.kind === 'trap')) {
        const seat = seatOf(trap);
        for (const id of rectSwitchIds(trap)) {
          const sw = level.switches.find((s) => s.id === id);
          // a deck plate, or a seat plate the waiting ball itself sits on, has no separate holder
          if (sw === undefined || sw.onRectId !== undefined || (sw.x <= seat.x && seat.x <= sw.x + sw.w)) continue;
          const start = freedBy(level, trap.id, id);
          if (start.switches[id] !== true || waitingOf(level, start.switches, start.balls[RED]) !== null) continue;
          const pair = `${level.id} ${trap.id} via ${id}`;
          for (let deg = 75; deg <= 105; deg += 5) {
            for (let power = 10; power <= 60; power += 5) {
              const ticks = shot(start, AIM(deg, power));
              taps[pair] = (taps[pair] ?? 0) + 1;
              if (jawsMoments(start, level, ticks).some((m) => m.kind === 'unsnap')) takenBack[pair] = (takenBack[pair] ?? 0) + 1;
              const bad = jawsContradictions(start, level, ticks);
              if (bad.length > 0) offenders.push(`${pair} ${deg}/${power}: ${bad[0] ?? ''} (${bad.length} frames)`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
    // every trap's release plates, 7 x 11 taps each; on each of them some taps re-open the jaws under a standing SNAP!
    expect(taps).toEqual({
      'w2-06-booby-trap snare via free': 77,
      'w2-06-booby-trap snare via far': 77,
      'w3-09-bait bait-trap via top': 77,
      'w3-12-grand-machine pit via fire': 77,
      'w3-12-grand-machine pit via top': 77,
      'w3-12-grand-machine door-seat via top': 77,
    });
    for (const pair of Object.keys(taps)) expect(takenBack[pair] ?? 0, pair).toBeGreaterThan(0);
  });

  it('L6: blue hops off FREE (the snare re-arms around red: SNAP!) and lands back on it: SNAP! goes the tick the jaws open again, and FREE! comes once blue settles', () => {
    const start = freedBy(boobyTrap, 'snare', 'free');
    const seat = start.balls[RED].pos;
    const ticks = shot(start, AIM(75, 35));
    const off = ofType(ticks, 'switchOff').find((e) => e.switchId === 'free');
    const on = ofType(ticks, 'switchOn').find((e) => e.switchId === 'free');
    const blueRest = ofType(ticks, 'ballRest').find((e) => e.playerId === BLUE);
    // the hold ended as blue rose, a press that did not last opened the jaws again, and blue settled on FREE
    expect(on?.tick).toBeGreaterThan(off?.tick ?? Infinity);
    expect(blueRest?.tick).toBeGreaterThan(on?.tick ?? Infinity);
    expect(ticks[ticks.length - 1]?.state.switches.free).toBe(true);
    expect(jawsContradictions(start, boobyTrap, ticks)).toEqual([]);
    expect(jawsMoments(start, boobyTrap, ticks)).toEqual([
      { kind: 'jaws', playerId: RED, rectId: 'snare', pos: seat, tick: off?.tick, caught: true, lasting: true, late: false },
      { kind: 'unsnap', playerId: RED, rectId: 'snare', tick: on?.tick },
      { kind: 'jaws', playerId: RED, rectId: 'snare', pos: seat, tick: on?.tick, caught: false, lasting: false, late: false },
      { kind: 'jaws', playerId: RED, rectId: 'snare', pos: seat, tick: blueRest?.tick, caught: false, lasting: true, late: true },
    ]);
    // the words said are the same as ever: SNAP! as the jaws close, FREE HELD and FREE! (late) as blue settles
    const { born, alive } = viewOf(start, boobyTrap, ticks);
    expect(born).toEqual([
      { tick: off?.tick, text: 'SNAP!' },
      { tick: blueRest?.tick, text: 'FREE HELD' },
      { tick: blueRest?.tick, text: 'FREE!' },
    ]);
    const reopened = ticks.findIndex((t) => t.state.tick === on?.tick);
    expect(alive[reopened - 1]).toContain('SNAP!');
    expect(alive[reopened]).not.toContain('SNAP!');
  });

  it('a holder that leaves FREE for good: SNAP! the tick the snare re-arms around red, and it stands, red staying caught', () => {
    const start = freedBy(boobyTrap, 'snare', 'free');
    const ticks = shot(start, AIM(75, 50));
    const off = ofType(ticks, 'switchOff').find((e) => e.switchId === 'free');
    expect(ofType(ticks, 'switchOn').filter((e) => e.switchId === 'free')).toEqual([]);
    expect(jawsMoments(start, boobyTrap, ticks).map((m) => m.kind === 'jaws' && m.caught && m.lasting)).toEqual([true]);
    expect(jawsContradictions(start, boobyTrap, ticks)).toEqual([]);
    const { born, alive } = viewOf(start, boobyTrap, ticks);
    expect(born).toEqual([{ tick: off?.tick, text: 'SNAP!' }]);
    // alive from the catch until it fades out (CALLOUT_TTL 1.1 s), never taken back
    const from = ticks.findIndex((t) => t.state.tick === off?.tick);
    expect(alive.slice(from, from + 60).every((texts) => texts.includes('SNAP!'))).toBe(true);
  });

  it('a jaws word stands longer than its callout lives: a free that does not last after WORD_STANDS_TICKS takes nothing back', () => {
    const snare = rectOf(boobyTrap, 'snare');
    const seat = seatOf(snare);
    const caught = (tick: number): SimEvent => ({ type: 'trapCaught', tick, playerId: RED, pos: seat, rectId: 'snare' });
    const freed = (tick: number): SimEvent => ({ type: 'trapFreed', tick, playerId: RED, pos: seat, rectId: 'snare' });
    const t = createPlateTracker(() => boobyTrap);
    t.sync(boobyTrap, Object.fromEntries(boobyTrap.switches.map((s) => [s.id, false])), [rest(seat), rest(boobyTrap.starts[1])]);
    expect(t.feed(caught(100)).map((m) => m.kind)).toEqual(['jaws']);
    expect(t.feed(freed(100 + WORD_STANDS_TICKS - 1)).map((m) => m.kind)).toEqual(['unsnap', 'jaws']);
    expect(t.feed(caught(300)).map((m) => m.kind)).toEqual(['jaws']);
    expect(t.feed(freed(300 + WORD_STANDS_TICKS)).map((m) => m.kind)).toEqual(['jaws']);
    // by then the word has left the screen: nothing of it is left to take back
    expect(CALLOUT_TTL).toBeLessThan(WORD_STANDS_TICKS * DT);
  });

  it.each([
    [
      'w3-09-bait',
      ['178:DOOR OPEN', '178:SNAP!', '329:SAND…', '437:BOING!', '548:SAND…', '570:FREE!', '662:SAND…', '714:DOOR SHUT', '715:SAND…', '844:TOP HELD', '844:DOOR OPEN', '936:BOING!', '1047:SAND…', '1105:SAND…', '1291:IN THE HOLE!'],
    ],
    [
      'w3-12-grand-machine',
      ['76:SAND…', '167:LOADED!', '239:BOOM!', '364:SAND…', '382:FIRE HELD', '397:TOP HELD', '397:DOOR OPEN', '457:SAND…', '457:DOOR SHUT', '535:TOP HELD', '535:DOOR OPEN', '641:SAND…', '655:BOOM!', '780:SAND…', '933:IN THE HOLE!'],
    ],
  ])('the golden line of %s says what it always said, and takes nothing back', (id, words) => {
    const g = GOLDEN_LINES.find((x) => x.levelId === id);
    if (g === undefined) throw new Error(`no golden line for ${id}`);
    const { level, states, events } = goldenRun(g);
    const view = createViewState(level, states[0] as SimState);
    applySimEvents(view, events[0] ?? [], states[0] as SimState);
    const tracker = createPlateTracker();
    for (const e of events[0] ?? []) tracker.feed(e);
    const born: string[] = [];
    let lastId = 0;
    for (let t = 1; t <= g.finalTick; t += 1) {
      const s = states[t] as SimState;
      for (const e of events[t] ?? []) for (const m of tracker.feed(e)) expect(m.kind === 'unsay' || m.kind === 'unsnap', `t${t} ${m.kind}`).toBe(false);
      applySimEvents(view, events[t] ?? [], s);
      for (const c of view.callouts) if (c.id > lastId) born.push(`${t}:${c.text}`);
      lastId = Math.max(lastId, ...view.callouts.map((c) => c.id));
      updateView(view, states[t - 1] as SimState, s, 1, DT);
    }
    expect(born).toEqual(words);
  });
});

describe('plate tracker edge cases', () => {
  const door = twoDoors.switches.find((s) => s.id === 'door');
  if (door === undefined) throw new Error('Two Doors has a DOOR plate');
  const doorTop = { x: door.x + door.w / 2, y: door.surfaceY };
  const onDoor = plateSpot(twoDoors, 'door');
  const allUp = Object.fromEntries(twoDoors.switches.map((s) => [s.id, false]));
  const on = (tick: number, switchId = 'door', pos = doorTop): SimEvent => ({ type: 'switchOn', tick, switchId, byPlayer: RED, pos });
  const off = (tick: number, switchId = 'door', pos = doorTop): SimEvent => ({ type: 'switchOff', tick, switchId, pos });
  const toggle = (tick: number, rectId: string, active: boolean, switchId: string): SimEvent => ({ type: 'bridgeToggle', tick, rectId, kind: 'blocker', active, switchId });
  const tracker = (switches: Record<string, boolean> = allUp, balls?: readonly BallState[]): ReturnType<typeof createPlateTracker> => {
    const t = createPlateTracker(() => twoDoors);
    t.sync(twoDoors, switches, balls);
    return t;
  };

  it('a respawn onto a plate holds it at once: press, HELD and the door in the same tick', () => {
    const t = tracker();
    expect(t.feed({ type: 'fellOffWorld', tick: 40, playerId: RED, pos: { x: 900, y: 900 }, respawnPos: onDoor, strokes: 2 })).toEqual([]);
    expect(t.feed(on(40)).map((m) => m.kind)).toEqual(['press', 'held', 'way']);
    expect(t.feed(toggle(40, 'door-gate', false, 'door'))).toEqual([]);
  });

  it('the cup holds its plate: a sink with the plate already down holds it; a sink that presses it holds it at once', () => {
    expect(twoDoors.cupHoldsSwitch).toBe('window');
    const rolling = tracker();
    expect(rolling.feed(on(10, 'window')).map((m) => m.kind)).toEqual(['press']);
    expect(rolling.feed({ type: 'sink', tick: 20, playerId: BLUE, pos: { x: 1680, y: 610 }, strokes: 3, speed: 50 }).map((m) => m.kind)).toEqual(['held', 'way']);
    const sinking = tracker();
    expect(sinking.feed({ type: 'gimme', tick: 30, playerId: BLUE, pos: { x: 1660, y: 588 }, strokes: 3 })).toEqual([]);
    expect(sinking.feed(on(30, 'window')).map((m) => m.kind)).toEqual(['press', 'held', 'way']);
  });

  it('a state resumed with a holder on the plate announces nothing until the holder leaves: then the hold ends and the door shuts', () => {
    const held = { ...allUp, door: true };
    const t = tracker(held, [rest(onDoor), rest(twoDoors.starts[1])]);
    expect(t.feed({ type: 'ballRest', tick: 5, playerId: BLUE, pos: twoDoors.starts[1], onPermanentGround: true }, held)).toEqual([]);
    expect(t.feed(off(9))).toEqual([{ kind: 'release', switchId: 'door', pos: doorTop, tick: 9, ended: true }]);
    expect(t.feed(toggle(9, 'door-gate', true, 'door'))).toEqual([{ kind: 'way', rectId: 'door-gate', rectKind: 'blocker', active: true, switchId: 'door', tick: 9 }]);
  });

  it('a rest the live switch mask says is off the plate holds nothing (a client that missed the release heals)', () => {
    const t = tracker();
    t.feed(on(10));
    expect(t.feed({ type: 'ballRest', tick: 30, playerId: RED, pos: onDoor, onPermanentGround: true }, allUp)).toEqual([]);
    expect(t.feed({ type: 'ballRest', tick: 31, playerId: RED, pos: onDoor, onPermanentGround: true }, { ...allUp, door: true }).map((m) => m.kind)).toEqual(['held', 'way']);
  });

  it('a press is fresh again once the plate has been up FRESH_PRESS_TICKS', () => {
    const t = tracker();
    t.feed(on(10));
    t.feed(off(20));
    expect(t.feed(on(20 + FRESH_PRESS_TICKS - 1))).toMatchObject([{ kind: 'press', fresh: false }]);
    t.feed(off(100));
    expect(t.feed(on(100 + FRESH_PRESS_TICKS))).toMatchObject([{ kind: 'press', fresh: true }]);
  });

  it('a door that opened and shut while nobody held its plate is never announced either way', () => {
    const t = tracker();
    t.feed(on(10));
    expect(t.feed(toggle(10, 'door-gate', false, 'door'))).toEqual([]);
    t.feed(off(14));
    expect(t.feed(toggle(14, 'door-gate', true, 'door'))).toEqual([]);
  });

  it('a way word stands longer than its callout lives: a press that does not last after WORD_STANDS_TICKS takes nothing back', () => {
    const t = tracker({ ...allUp, door: true }, [rest(onDoor), rest(twoDoors.starts[1])]);
    expect(t.feed(off(100)).map((m) => m.kind)).toEqual(['release']);
    expect(t.feed(toggle(100, 'door-gate', true, 'door')).map((m) => m.kind)).toEqual(['way']);
    t.feed(on(100 + WORD_STANDS_TICKS - 1));
    expect(t.feed(toggle(100 + WORD_STANDS_TICKS - 1, 'door-gate', false, 'door')).map((m) => m.kind)).toEqual(['unsay']);
    const late = tracker({ ...allUp, door: true }, [rest(onDoor), rest(twoDoors.starts[1])]);
    late.feed(off(100));
    late.feed(toggle(100, 'door-gate', true, 'door'));
    late.feed(on(100 + WORD_STANDS_TICKS));
    expect(late.feed(toggle(100 + WORD_STANDS_TICKS, 'door-gate', false, 'door'))).toEqual([]);
  });

  /** A ball rolling at `pos` whose last rest was `lastRest`. */
  const rolling = (pos: Vec, lastRest: Vec): BallState => ({ ...rest(pos), vel: { x: 120, y: 0 }, asleep: false, restTicks: 0, lastRest });

  it('re-based while a holder that has just been shot is still on its plate: the plate is HELD and DOOR OPEN stands, so its leaving ends the hold and says DOOR SHUT', () => {
    const t = tracker({ ...allUp, door: true }, [rolling(onDoor, onDoor), rest(twoDoors.starts[1])]);
    expect(t.feed(off(9))).toEqual([{ kind: 'release', switchId: 'door', pos: doorTop, tick: 9, ended: true }]);
    expect(t.feed(toggle(9, 'door-gate', true, 'door')).map((m) => m.kind)).toEqual(['way']);
  });

  it('re-based while a landing still rocks on the plate (nothing said yet): its rest says HELD and DOOR OPEN; a ball rolling off it says nothing', () => {
    const landing = tracker({ ...allUp, door: true }, [rolling(onDoor, twoDoors.starts[0]), rest(twoDoors.starts[1])]);
    expect(landing.feed({ type: 'ballRest', tick: 30, playerId: RED, pos: onDoor, onPermanentGround: true }).map((m) => m.kind)).toEqual(['held', 'way']);
    const passing = tracker({ ...allUp, door: true }, [rolling(onDoor, twoDoors.starts[0]), rest(twoDoors.starts[1])]);
    expect(passing.feed(off(12))).toEqual([{ kind: 'release', switchId: 'door', pos: doorTop, tick: 12, ended: false }]);
    expect(passing.feed(toggle(12, 'door-gate', true, 'door'))).toEqual([]);
  });

  it('re-based while a rescuer rolls on FREE and red waits in the open snare: red is let go only for now, and FREE! comes when the rescuer settles', () => {
    const snare = rectOf(boobyTrap, 'snare');
    const seat = { x: snare.x + snare.w / 2, y: snare.y + snare.h - BALL_RADIUS };
    const onFree = plateSpot(boobyTrap, 'free');
    const switches = { ...Object.fromEntries(boobyTrap.switches.map((s) => [s.id, false])), free: true };
    const t = createPlateTracker(() => boobyTrap);
    t.sync(boobyTrap, switches, [rest(seat), rolling(onFree, boobyTrap.starts[1])]);
    expect(t.feed({ type: 'ballRest', tick: 40, playerId: BLUE, pos: onFree, onPermanentGround: true }, switches).filter((m) => m.kind === 'jaws')).toEqual([
      { kind: 'jaws', playerId: RED, rectId: 'snare', pos: seat, tick: 40, caught: false, lasting: true, late: true },
    ]);
  });
});

describe('a tracker re-based at any tick says what a tracker that saw every event says (D11 sync, golden lines)', () => {
  /**
   * What a snapshot cannot carry, written as a re-based tracker says it: when a plate up at the sync came up (its first
   * press within FRESH_PRESS_TICKS of the sync is `fresh`, as for a plate up a long time), and a rest off permanent
   * ground (the sim keeps a ball's safe spot only there, so a deck plate down at the sync with no ball resting on it
   * reads as pressed by a ball passing over: unless a ball comes to rest on it first, its first release ends no hold).
   */
  function asReBased(want: readonly PlateMoment[], level: Level, s0: SimState): PlateMoment[] {
    const seen = new Set<string>();
    const heldSince = new Set<string>();
    return want.map((m) => {
      if (m.kind === 'held') heldSince.add(m.switchId);
      if (m.kind !== 'press' && m.kind !== 'release') return m;
      const first = !seen.has(m.switchId);
      seen.add(m.switchId);
      if (!first) return m;
      const down = s0.switches[m.switchId] === true;
      if (m.kind === 'press') return !down && m.tick - s0.tick < FRESH_PRESS_TICKS ? { ...m, fresh: true } : m;
      const sw = level.switches.find((x) => x.id === m.switchId);
      if (sw?.onRectId === undefined || !down || heldSince.has(sw.id) || level.cupHoldsSwitch === sw.id) return m;
      const restingOn = s0.balls.some((b) => b.asleep && !b.sunk && b.pos.x >= sw.x && b.pos.x <= sw.x + sw.w && Math.abs(b.pos.y + BALL_RADIUS - sw.surfaceY) <= SWITCH_CONTACT_TOLERANCE);
      return restingOn ? m : { ...m, ended: false };
    });
  }

  /**
   * Re-bases a fresh tracker on the state at every tick t0 of a golden line, told that it already includes the events
   * of the last `window` ticks (an online frame re-syncs from the snapshot its drained events reach), feeds it those
   * and every later event, and lists where its moments differ from those of a tracker that saw every event.
   */
  function reBasedMismatches(g: GoldenLine, window: number): string[] {
    const { level, states, events } = goldenRun(g);
    const full = createPlateTracker();
    const fullAt = events.map((evs) => evs.flatMap((e) => full.feed(e)));
    const mismatches: string[] = [];
    for (let t0 = window; t0 < g.finalTick; t0 += 1) {
      const s0 = states[t0] as SimState;
      const from = t0 - window + 1;
      const synced = createPlateTracker();
      synced.sync(level, s0.switches, s0.balls, events.slice(from, t0 + 1).flat());
      const got = events.slice(from).flatMap((evs) => evs.flatMap((e) => synced.feed(e)));
      const want = asReBased(fullAt.slice(from).flat(), level, states[from - 1] as SimState);
      let at = -1;
      for (let i = 0; i < Math.max(got.length, want.length) && at < 0; i += 1) if (JSON.stringify(got[i]) !== JSON.stringify(want[i])) at = i;
      if (at >= 0) mismatches.push(`sync@${t0}: got ${JSON.stringify(got[at])} want ${JSON.stringify(want[at])}`);
    }
    return mismatches;
  }

  it.each(GOLDEN_LINES.map((g) => [g.levelId, g] as const))('%s: a fresh tracker re-based at every tick of the golden line says every later moment as one that saw every event', (_id, g) => {
    const mismatches = reBasedMismatches(g, 0);
    expect(mismatches.length, mismatches.slice(0, 5).join('\n')).toBe(0);
  });

  it.each(GOLDEN_LINES.map((g) => [g.levelId, g] as const))(
    '%s: re-based at every tick from a state that already includes the last 30 ticks of events (an online frame draining its 500 ms replay window), it says their moments too',
    (_id, g) => {
      expect(30 * DT * 1000).toBeGreaterThanOrEqual(EVENT_REPLAY_WINDOW_MS);
      const mismatches = reBasedMismatches(g, 30);
      expect(mismatches.length, mismatches.slice(0, 5).join('\n')).toBe(0);
    },
  );
});

describe('the press reads as a click, the chip as a hold', () => {
  it('a one-tick press still clicks the plate cap fully down, then lets it up', () => {
    const start = crafted(twoDoors, twoDoors.starts[0], twoDoors.starts[1], RED);
    const view = createViewState(twoDoors, start);
    const door = twoDoors.switches.find((s) => s.id === 'door');
    if (door === undefined) throw new Error('no DOOR plate');
    applySimEvents(view, [{ type: 'switchOn', tick: 50, switchId: 'door', byPlayer: RED, pos: { x: 795, y: door.surfaceY } }], { ...start, switches: { ...start.switches, door: true } });
    // the sim lets it up the very next tick
    for (let t = 0; t < PLATE_CLICK_SEC / DT - 1; t += 1) updateView(view, start, start, 1, DT);
    expect(view.switchAnims.get('door')).toBe(1);
    for (let t = 0; t < 12; t += 1) updateView(view, start, start, 1, DT);
    expect(view.switchAnims.get('door')).toBe(0);
  });

  it('HOLDS names a plate only for a ball resting on it, whichever slot rolls across it', () => {
    const switches = { door: true, window: false };
    const resting = rest(plateSpot(twoDoors, 'door', 20));
    const rolling: BallState = { ...rest(plateSpot(twoDoors, 'door', -20)), vel: { x: 200, y: 0 }, asleep: false, restTicks: 0 };
    expect(holdsOf(twoDoors, { switches, balls: [rolling, rest(twoDoors.starts[1])] })).toEqual({});
    expect(holdsOf(twoDoors, { switches, balls: [rolling, resting] })).toEqual({ door: BLUE });
    expect(holdsOf(twoDoors, { switches, balls: [resting, rolling] })).toEqual({ door: RED });
  });
});
