// @vitest-environment jsdom
// OWNER: view
// BUILD_DECISIONS D11: the view (sparks, callouts) and audio (clicks, confirms, slides) each keep a plate tracker
// (plates.ts), and must decide every press, hold and take-back alike, or the words on screen and the sounds in the air
// tell two stories. Both REAL consumers run tick by tick on the real sim, the view through applySimEvents and audio
// through handleEvents, and the moments their own trackers compute are recorded as they compute them
// (createPlateTracker passes through a recorder; nothing else is stubbed but the AudioContext).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitingOf } from '../../sim/devices';
import { LEVELS, levelById } from '../../sim/levels/index';
import { level as grandMachine } from '../../sim/levels/w3-12-grand-machine';
import { evaluateSwitches } from '../../sim/physics';
import { createSim, stepSim } from '../../sim/sim';
import { isRectActive, rectSwitchIds } from '../../sim/terrain';
import type { Aim, BallState, Level, PlayerId, SimEvent, SimState, Vec } from '../../sim/types';
import { AIM_ANGLE_MAX, AIM_ANGLE_MIN, BALL_RADIUS, REST_TICKS, quantize1, quantize4 } from '../../sim/types';
import { createAudio, type AudioSystem } from '../audio';
import type * as PlatesModule from '../plates';
import { createPlateTracker, type PlateMoment, type PlateTracker } from '../plates';
import { applySimEvents, createViewState, type ViewState } from '../view';

/** Every plate tracker made, in order, with the moments of each call into it. */
const made = vi.hoisted(() => ({ trackers: [] as Array<{ calls: PlateMoment[][] }> }));

vi.mock('../plates', async (importOriginal) => {
  const real = await importOriginal<typeof PlatesModule>();
  return {
    ...real,
    createPlateTracker: (...args: Parameters<typeof real.createPlateTracker>): PlateTracker => {
      const tracker = real.createPlateTracker(...args);
      const rec = { calls: [] as PlateMoment[][] };
      made.trackers.push(rec);
      return {
        ...tracker,
        feed: (e, live) => {
          const moments = tracker.feed(e, live);
          rec.calls.push(moments);
          return moments;
        },
        feedAll: (events) => {
          const moments = tracker.feedAll(events);
          rec.calls.push(moments.flat());
          return moments;
        },
      };
    },
  };
});

// ---- a stub Web Audio graph: enough for createAudio to unlock (the plate cues are recorded off its sfx) ----
class StubParam {
  value = 0;
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
  setTargetAtTime(): void {}
  cancelScheduledValues(): void {}
  cancelAndHoldAtTime(): void {}
}
class StubNode {
  gain = new StubParam();
  frequency = new StubParam();
  detune = new StubParam();
  Q = new StubParam();
  offset = new StubParam();
  playbackRate = new StubParam();
  threshold = new StubParam();
  knee = new StubParam();
  ratio = new StubParam();
  attack = new StubParam();
  release = new StubParam();
  type = '';
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  connect(): StubNode {
    return this;
  }
  disconnect(): void {}
  start(): void {}
  stop(): void {}
}
class StubAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = new StubNode();
  resume(): Promise<void> {
    return Promise.resolve();
  }
  createGain(): StubNode {
    return new StubNode();
  }
  createOscillator(): StubNode {
    return new StubNode();
  }
  createBufferSource(): StubNode {
    return new StubNode();
  }
  createBiquadFilter(): StubNode {
    return new StubNode();
  }
  createDynamicsCompressor(): StubNode {
    return new StubNode();
  }
  createConstantSource(): StubNode {
    return new StubNode();
  }
  createBuffer(_channels: number, length: number): { getChannelData(): Float32Array } {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'AudioContext');
});

const RED: PlayerId = 0;
const BLUE: PlayerId = 1;
const AIM = (deg: number, power: number): Aim => ({ angle: quantize4(Math.min(AIM_ANGLE_MAX, Math.max(AIM_ANGLE_MIN, (-deg * Math.PI) / 180))), power: quantize1(power) });
const rest = (pos: Vec): BallState => ({ pos, vel: { x: 0, y: 0 }, asleep: true, sunk: false, grounded: true, restTicks: REST_TICKS, lastRest: pos });

function plateSpot(level: Level, id: string): Vec {
  const sw = level.switches.find((s) => s.id === id);
  if (sw === undefined) throw new Error(`no plate ${id}`);
  return { x: sw.x + sw.w / 2, y: sw.surfaceY - BALL_RADIUS };
}

/** The seat of a trap: a ball resting on its floor, centred. */
const seatOf = (rect: Level['rects'][number]): Vec => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h - BALL_RADIUS });

/** The hole past its intro card with both balls resting where given (switches as they imply) and `active` to shoot. */
function crafted(level: Level, red: Vec, blue: Vec, active: PlayerId, seed: Record<string, boolean> = {}): SimState {
  const intro = stepSim(createSim({ playerCount: 2, levelIds: [level.id], seed: 7, mode: 'local' }).state, [{ type: 'continue', playerId: RED }]).state;
  const balls: [BallState, BallState] = [rest(red), rest(blue)];
  const up = { ...Object.fromEntries(level.switches.map((s) => [s.id, false])), ...seed };
  const switches = evaluateSwitches(level, evaluateSwitches(level, up, balls), balls);
  return { ...intro, balls, switches, activePlayer: active, turnDelayTicks: 0, phase: 'aiming' };
}

type Recorded = { calls: PlateMoment[][] };

/** `make()`, and the one plate tracker it made. */
function trackerOf<T>(make: () => T): { made: T; tracker: Recorded } {
  const before = made.trackers.length;
  const value = make();
  const tracker = made.trackers[before];
  if (tracker === undefined || made.trackers.length !== before + 1) throw new Error('expected exactly one plate tracker');
  return { made: value, tracker };
}

/** An audio system (stubbed context or none) and the plate tracker it keeps. */
function recordedAudio(): { audio: AudioSystem; tracker: Recorded } {
  const { made: audio, tracker } = trackerOf(() => createAudio({ seed: 1 }));
  return { audio, tracker };
}

/** A view and an audio system standing on `start` (as GameCanvas re-bases both), with the two trackers they keep. */
function consumers(level: Level, start: SimState, heard = recordedAudio()): { view: ViewState; audio: AudioSystem; viewT: Recorded; audioT: Recorded } {
  const { made: view, tracker: viewT } = trackerOf(() => createViewState(level, start));
  heard.audio.syncPlates(level, start.switches, start.balls);
  return { view, audio: heard.audio, viewT, audioT: heard.tracker };
}

/** A tick's moments, in a canonical order (the two consumers may meet the same moments in another order). */
const canonical = (moments: readonly PlateMoment[]): string[] => moments.map((m) => JSON.stringify(m)).sort();

type TickSeen = {
  tick: number;
  events: readonly SimEvent[];
  state: SimState;
  view: PlateMoment[];
  audio: PlateMoment[];
  /** A third tracker's, fed each event with the sim's own switch mask after the tick (the rule the view used to read off SimState). */
  simMask: PlateMoment[];
  callouts: string[];
};

/**
 * The active ball's shot from `start`, each tick handed to the view (applySimEvents, as a local GameCanvas frame does)
 * and to audio (handleEvents), until the next shot could be taken; per tick, the moments each consumer's tracker made.
 */
function playShot(level: Level, start: SimState, aim: Aim, onTick?: (seen: TickSeen) => void, heard?: { audio: AudioSystem; tracker: Recorded }): TickSeen[] {
  made.trackers.length = 0;
  const c = consumers(level, start, heard);
  const reference = createPlateTracker(() => level);
  reference.sync(level, start.switches, start.balls);
  const p = start.activePlayer;
  let r = stepSim(start, [
    { type: 'setAim', playerId: p, ...aim },
    { type: 'shoot', playerId: p },
  ]);
  const seen: TickSeen[] = [];
  for (let i = 0; i < 3000; i += 1) {
    const v0 = c.viewT.calls.length;
    const a0 = c.audioT.calls.length;
    applySimEvents(c.view, r.events, r.state);
    c.audio.handleEvents(r.events, 0);
    const now = r.state.switches;
    const tick: TickSeen = {
      tick: r.state.tick,
      events: r.events,
      state: r.state,
      view: c.viewT.calls.slice(v0).flat(),
      audio: c.audioT.calls.slice(a0).flat(),
      simMask: r.events.flatMap((e) => reference.feed(e, now)),
      callouts: c.view.callouts.map((x) => x.text),
    };
    seen.push(tick);
    onTick?.(tick);
    if (r.state.phase !== 'flying' && r.state.turnDelayTicks === 0) break;
    r = stepSim(r.state, []);
  }
  return seen;
}

/** The tick a ball came to rest on L12's DOOR plate, in the door seat, and was sent BACK +1 on that same tick. */
function restAndReturnOnDoor(events: readonly SimEvent[]): boolean {
  const door = grandMachine.switches.find((s) => s.id === 'door');
  if (door === undefined) return false;
  const rests = events.filter((e): e is Extract<SimEvent, { type: 'ballRest' }> => e.type === 'ballRest' && e.pos.x >= door.x && e.pos.x <= door.x + door.w);
  return rests.some((r) => events.some((e) => e.type === 'trapReturn' && e.playerId === r.playerId)) && events.some((e) => e.type === 'switchOff' && e.switchId === 'door');
}

describe('the view and audio decide every plate moment alike (D11, real sim)', () => {
  const pit = grandMachine.rects.find((r) => r.id === 'pit');
  if (pit === undefined) throw new Error('Grand Machine has a pit trap');

  it("L12: blue comes to rest on DOOR in the door seat and is sent BACK +1 on that tick: the view and audio say and play the same, and nothing lasting about DOOR (no HELD, no OPEN, no confirm, no slide, no falling confirm)", () => {
    Object.defineProperty(window, 'AudioContext', { value: StubAudioContext, configurable: true, writable: true });
    made.trackers.length = 0;
    const heard = recordedAudio();
    const { audio } = heard;
    audio.unlock();
    // the plate cues audio voices, collected per tick below
    const cues: string[] = [];
    vi.spyOn(audio.sfx, 'switchOn').mockImplementation((o) => void cues.push(`${o?.click === false ? 'confirm' : 'click'}:${String(o?.playerId)}`));
    vi.spyOn(audio.sfx, 'switchOff').mockImplementation((o) => void cues.push(`${o?.chime === false ? 'tick' : 'falling-confirm'}:${String(o?.playerId)}`));
    vi.spyOn(audio.sfx, 'bridgeToggle').mockImplementation((active, o) => void cues.push(`slide-${active === true ? 'shut' : 'open'}:${String(o?.playerId)}`));
    vi.spyOn(audio.sfx, 'trapCaught').mockImplementation((o) => void cues.push(`${o?.chime === false ? 'quiet-snap' : 'snap'}:${String(o?.playerId)}`));
    vi.spyOn(audio.sfx, 'trapFreed').mockImplementation((o) => void cues.push(`${o?.chime === false ? 'quiet-latch' : 'free'}:${String(o?.playerId)}`));
    const heardAt = new Map<number, string[]>();
    // red waits freed in the pit by blue on FIRE; blue rolls flat into the door seat (the round-2 re-checker's grid shot)
    const start = crafted(grandMachine, seatOf(pit), plateSpot(grandMachine, 'fire'), BLUE);
    expect(waitingOf(grandMachine, start.switches, start.balls[RED])).toBeNull();
    const ticks = playShot(grandMachine, start, AIM(5, 50), (t) => heardAt.set(t.tick, cues.splice(0)), heard);
    const at = ticks.findIndex((t) => restAndReturnOnDoor(t.events));
    const hit = ticks[at];
    if (hit === undefined) throw new Error('blue never rested on DOOR and went BACK +1 on one tick');
    // the sim's story on that tick: blue rests on DOOR in the door seat, SNAP!, BACK +1 onto FIRE, DOOR comes up and
    // the door shuts, and FIRE (now under blue) lets red go
    expect(hit.events.map((e) => e.type)).toEqual(['ballRest', 'trapCaught', 'trapReturn', 'switchOn', 'switchOff', 'bridgeToggle', 'trapFreed']);
    expect(hit.state.switches).toMatchObject({ door: false, fire: true });
    // both trackers make the same moments, and none of them names DOOR as held or its door as changed for good
    expect(canonical(hit.audio)).toEqual(canonical(hit.view));
    expect(hit.audio.filter((m) => (m.kind === 'held' && m.switchId === 'door') || (m.kind === 'way' && m.rectId === 'door-gate'))).toEqual([]);
    expect(hit.audio.filter((m) => m.kind === 'release')).toEqual([expect.objectContaining({ switchId: 'door', ended: false })]);
    // what audio plays on that tick: FIRE's click and confirm, blue's SNAP and red's FREE, and DOOR's bare tick
    expect([...(heardAt.get(hit.tick) ?? [])].sort()).toEqual(['click:fire', 'confirm:fire', 'free:0', 'snap:1', 'tick:door']);
    // and nothing lasting about DOOR, on that tick or after it, on screen or in the air
    for (const t of ticks.slice(at)) {
      expect(t.callouts.filter((text) => text.startsWith('DOOR')), `t${t.tick}`).toEqual([]);
      expect((heardAt.get(t.tick) ?? []).filter((c) => /^(confirm|falling-confirm|slide-open|slide-shut):(door|door-gate)$/.test(c)), `t${t.tick}`).toEqual([]);
    }
    audio.dispose();
  });

  it('the audit: on a grid of shots (every L12 shot of the round-2 grid from the pit, and a coarse grid on every hole) the two trackers make the same moments on every tick', () => {
    type Start = { key: string; level: Level; start: SimState; fine: boolean };
    const starts: Start[] = [];
    for (const l of LEVELS) {
      const level = levelById(l.id);
      for (const sw of level.switches) {
        const ways = level.rects.filter((r) => (r.kind === 'blocker' || r.kind === 'bridge') && rectSwitchIds(r).includes(sw.id));
        if (ways.length === 0) continue;
        const start = crafted(level, plateSpot(level, sw.id), level.starts[1], RED, sw.onRectId !== undefined ? { [sw.id]: true } : {});
        if (start.switches[sw.id] !== true || !ways.some((r) => isRectActive(r, start.switches) !== isRectActive(r, {}))) continue;
        starts.push({ key: `${level.id} way-holder ${sw.id}`, level, start, fine: false });
      }
      for (const trap of level.rects.filter((r) => r.kind === 'trap')) {
        const seat = seatOf(trap);
        for (const id of rectSwitchIds(trap)) {
          const sw = level.switches.find((s) => s.id === id);
          if (sw === undefined || sw.onRectId !== undefined || (sw.x <= seat.x && seat.x <= sw.x + sw.w)) continue;
          const start = crafted(level, seat, plateSpot(level, id), BLUE);
          if (start.switches[id] !== true || waitingOf(level, start.switches, start.balls[RED]) !== null) continue;
          starts.push({ key: `${level.id} jaws-holder ${trap.id} via ${id}`, level, start, fine: level.id === grandMachine.id && trap.id === 'pit' && id === 'fire' });
        }
        const caught = crafted(level, seat, level.starts[1], BLUE);
        if (waitingOf(level, caught.switches, caught.balls[RED])?.reason === 'caught') {
          starts.push({ key: `${level.id} rescue ${trap.id}`, level, start: caught, fine: level.id === grandMachine.id && trap.id === 'pit' });
        }
      }
      for (const who of [RED, BLUE]) starts.push({ key: `${level.id} tee ${who}`, level, start: crafted(level, level.starts[0], level.starts[1], who), fine: false });
    }
    let shots = 0;
    let restAndReturn = 0;
    const disagree: string[] = [];
    const offTheSimMask: string[] = [];
    for (const { key, level, start, fine } of starts) {
      const degs = fine ? 5 : 30;
      const powers = fine ? 5 : 30;
      for (let deg = 5; deg <= 175; deg += degs) {
        for (let power = 10; power <= 100; power += powers) {
          shots += 1;
          let first: string | null = null;
          let firstOff: string | null = null;
          let returned = false;
          playShot(level, start, AIM(deg, power), (t) => {
            if (level.id === grandMachine.id && restAndReturnOnDoor(t.events)) returned = true;
            const view = JSON.stringify(canonical(t.view));
            if (first === null && view !== JSON.stringify(canonical(t.audio))) first = `t${t.tick}`;
            if (firstOff === null && view !== JSON.stringify(canonical(t.simMask))) firstOff = `t${t.tick}`;
          });
          if (returned) restAndReturn += 1;
          if (first !== null) disagree.push(`${key} ${deg}/${power} at ${String(first)}`);
          if (firstOff !== null) offTheSimMask.push(`${key} ${deg}/${power} at ${String(firstOff)}`);
        }
      }
    }
    expect({ shotsThatDisagree: disagree.length, first: disagree.slice(0, 5) }).toEqual({ shotsThatDisagree: 0, first: [] });
    // and both decide exactly as a tracker reading the sim's own plates after each tick: the view says what it said
    expect({ shotsOffTheSimMask: offTheSimMask.length, first: offTheSimMask.slice(0, 5) }).toEqual({ shotsOffTheSimMask: 0, first: [] });
    // the grid reaches the case: shots on L12 where a ball rests on DOOR and goes BACK +1 on that tick
    expect(restAndReturn).toBeGreaterThanOrEqual(200);
    expect(shots).toBeGreaterThan(2000);
    // some 2,600 real shots through a real view and audio: a few seconds, more on a loaded machine
  }, 60_000);
});
