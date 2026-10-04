// OWNER: sim
// ARCH.md §4 turns row (+ BUILD_DECISIONS D2: who goes first comes from level.firstPlayer).
import { describe, expect, it, vi } from 'vitest';
import { createSim, isShotReady, stepSim } from '../sim';
import type { Aim, PlayerCommand, PlayerId, SimEvent, SimEventType, SimMode, SimState, StepResult } from '../types';
import { DEFAULT_AIM, TURN_DELAY_TICKS } from '../types';
import { PUTT_AIM, blueFirstLevel, fixtureConfig, shortLevel } from './fixtures';

vi.mock('../levels/index', async () => (await import('./fixtures')).fixtureRegistry);

const CAMPAIGN = [shortLevel, blueFirstLevel];
const config = (mode: SimMode = 'local') => fixtureConfig(CAMPAIGN, mode);
const cont = (playerId: PlayerId): PlayerCommand => ({ type: 'continue', playerId });
const SHORT_HOP: Aim = { angle: -1.4, power: 20 };

const ofType = <T extends SimEventType>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

function untilReady(state: SimState): SimState {
  let s = state;
  for (let i = 0; i < 2000 && !isShotReady(s); i += 1) s = stepSim(s, []).state;
  if (!isShotReady(s)) throw new Error('never ready');
  return s;
}

/** Shoots `aim` with the active player as soon as the turn is ready, then steps until the phase leaves `flying`. */
function shootAndSettle(state: SimState, aim: Aim): { state: SimState; events: SimEvent[]; results: StepResult[] } {
  const ready = untilReady(state);
  const p = ready.activePlayer;
  const results: StepResult[] = [stepSim(ready, [{ type: 'setAim', playerId: p, ...aim }, { type: 'shoot', playerId: p }])];
  let s = results[0]?.state ?? ready;
  for (let i = 0; i < 3000 && s.phase === 'flying'; i += 1) {
    const r = stepSim(s, []);
    results.push(r);
    s = r.state;
  }
  if (s.phase === 'flying') throw new Error('never settled');
  return { state: s, events: results.flatMap((r) => r.events), results };
}

function startPlaying(mode: SimMode = 'local'): SimState {
  return stepSim(createSim(config(mode)).state, [cont(0)]).state;
}

/** Both balls putt out on a short hole; returns the state in levelResults. */
function holeOut(state: SimState): SimState {
  let s = state;
  while (s.phase === 'aiming') s = shootAndSettle(s, PUTT_AIM).state;
  expect(s.phase).toBe('levelResults');
  return s;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

describe('turn logic', () => {
  it('createSim => phase intro, activePlayer = level.firstPlayer, turnDelayTicks 0', () => {
    const red = createSim(config());
    expect(red.state).toMatchObject({ phase: 'intro', activePlayer: 0, turnDelayTicks: 0, levelIndex: 0, levelId: shortLevel.id, tick: 0, campaign: [] });
    expect(red.events).toEqual([{ type: 'levelStart', levelId: shortLevel.id, levelIndex: 0, firstPlayer: 0, restarted: false, tick: 0 }]);
    expect(red.state.players).toEqual([{ strokes: 0, aim: DEFAULT_AIM }, { strokes: 0, aim: DEFAULT_AIM }]);
    expect(red.state.balls[0]).toMatchObject({ pos: shortLevel.starts[0], asleep: true, sunk: false, grounded: true, lastRest: shortLevel.starts[0] });
    const blue = createSim(fixtureConfig([blueFirstLevel]));
    expect(blue.state.activePlayer).toBe(1);
    expect(blue.events[0]).toMatchObject({ type: 'levelStart', firstPlayer: 1 });
  });

  it('continue{playerId:1} from seat 1 (local mode) is accepted', () => {
    const r = stepSim(createSim(config('local')).state, [cont(1)]);
    expect(r.state.phase).toBe('aiming');
    expect(r.events.map((e) => e.type)).toEqual(['playStart', 'turnStart']);
    expect(ofType(r.events, 'turnStart')[0]).toMatchObject({ playerId: 0, readyInTicks: 0, sameAsBefore: false });
    expect(r.state.turnDelayTicks).toBe(0);
  });

  it('in solo, continue{playerId:1} maps to seat 0 and is accepted', () => {
    const r = stepSim(createSim(config('solo')).state, [cont(1)]);
    expect(r.state.phase).toBe('aiming');
    expect(ofType(r.events, 'commandRejected')).toHaveLength(0);
  });

  it('restartLevel{playerId:1} in local => rejected notHost', () => {
    const intro = createSim(config('local')).state;
    const r = stepSim(intro, [{ type: 'restartLevel', playerId: 1 }]);
    expect(r.events).toEqual([{ type: 'commandRejected', command: 'restartLevel', playerId: 1, reason: 'notHost', tick: 1 }]);
    expect(r.state).toEqual({ ...intro, tick: 1 });
    const host = stepSim(intro, [{ type: 'restartLevel', playerId: 0 }]);
    expect(host.state.phase).toBe('aiming');
    expect(host.state.turnDelayTicks).toBe(TURN_DELAY_TICKS);
  });

  it('setAim{playerId:1} while activePlayer 0 => notActivePlayer even in solo', () => {
    for (const mode of ['solo', 'local'] as const) {
      const aiming = startPlaying(mode);
      const r = stepSim(aiming, [{ type: 'setAim', playerId: 1, angle: -1, power: 50 }]);
      expect(ofType(r.events, 'commandRejected')).toEqual([expect.objectContaining({ command: 'setAim', playerId: 1, reason: 'notActivePlayer' })]);
      expect(r.state.players).toBe(aiming.players);
      expect(r.state.switches).toBe(aiming.switches);
    }
    const nan = stepSim(startPlaying(), [{ type: 'setAim', playerId: 0, angle: Number.NaN, power: 50 }]);
    expect(ofType(nan.events, 'commandRejected')[0]?.reason).toBe('outOfRange');
  });

  it('shoot during turnDelay => rejected turnDelay', () => {
    const restarted = stepSim(createSim(config()).state, [{ type: 'restartLevel', playerId: 0 }]).state;
    expect(restarted.turnDelayTicks).toBe(TURN_DELAY_TICKS);
    const r = stepSim(restarted, [{ type: 'shoot', playerId: 0 }]);
    expect(ofType(r.events, 'commandRejected')).toEqual([expect.objectContaining({ command: 'shoot', reason: 'turnDelay' })]);
    expect(r.state.phase).toBe('aiming');
    expect(r.state.players[0].strokes).toBe(0);
    const ready = untilReady(r.state);
    const shot = stepSim(ready, [{ type: 'shoot', playerId: 0 }]);
    expect(ofType(shot.events, 'ballHit')).toHaveLength(1);
    expect(shot.state.phase).toBe('flying');
  });

  it('restartLevel issued while aiming leaves turnDelayTicks 27 (= turnStart.readyInTicks), the next tick 26', () => {
    const ready = untilReady(startPlaying());
    expect(ready.turnDelayTicks).toBe(0);
    for (const from of [ready, stepSim(shootAndSettle(ready, SHORT_HOP).state, []).state]) {
      expect(from.phase).toBe('aiming');
      const r = stepSim(from, [{ type: 'restartLevel', playerId: 0 }]);
      expect(ofType(r.events, 'turnStart')[0]).toMatchObject({ readyInTicks: TURN_DELAY_TICKS });
      expect(r.state.turnDelayTicks).toBe(TURN_DELAY_TICKS);
      expect(stepSim(r.state, []).state.turnDelayTicks).toBe(TURN_DELAY_TICKS - 1);
    }
    // the same promise holds for a restart from flying
    const flying = stepSim(ready, [{ type: 'setAim', playerId: 0, ...SHORT_HOP }, { type: 'shoot', playerId: 0 }]).state;
    expect(stepSim(flying, [{ type: 'restartLevel', playerId: 0 }]).state.turnDelayTicks).toBe(TURN_DELAY_TICKS);
  });

  it('after rest the OTHER slot becomes active; the first observable state has turnDelayTicks 27, the next tick 26', () => {
    const { state, events, results } = shootAndSettle(startPlaying(), SHORT_HOP);
    expect(state.phase).toBe('aiming');
    expect(state.activePlayer).toBe(1);
    expect(state.turnDelayTicks).toBe(TURN_DELAY_TICKS);
    expect(state.players[0].strokes).toBe(1);
    expect(ofType(events, 'ballHit')[0]).toMatchObject({ playerId: 0, angle: SHORT_HOP.angle, power: SHORT_HOP.power });
    const last = results[results.length - 1];
    expect(ofType(last?.events ?? [], 'turnStart')).toEqual([expect.objectContaining({ playerId: 1, readyInTicks: TURN_DELAY_TICKS, sameAsBefore: false })]);
    expect(stepSim(state, []).state.turnDelayTicks).toBe(TURN_DELAY_TICKS - 1);
  });

  it('when one ball is sunk the same slot continues', () => {
    const redIn = shootAndSettle(startPlaying(), PUTT_AIM);
    expect(redIn.state.balls[0].sunk).toBe(true);
    expect(ofType(redIn.events, 'sink').length + ofType(redIn.events, 'gimme').length).toBe(1);
    expect(redIn.state.activePlayer).toBe(1);
    const blueShort = shootAndSettle(redIn.state, SHORT_HOP);
    expect(blueShort.state.phase).toBe('aiming');
    expect(blueShort.state.activePlayer).toBe(1);
    const turn = ofType(blueShort.events, 'turnStart');
    expect(turn).toEqual([expect.objectContaining({ playerId: 1, sameAsBefore: true })]);
  });

  it('both sunk => levelResults + levelComplete', () => {
    let s = startPlaying();
    const all: SimEvent[] = [];
    while (s.phase === 'aiming') {
      const r = shootAndSettle(s, PUTT_AIM);
      all.push(...r.events);
      s = r.state;
    }
    expect(s.phase).toBe('levelResults');
    expect(s.balls.every((b) => b.sunk)).toBe(true);
    const done = ofType(all, 'levelComplete');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({
      result: { levelId: shortLevel.id, par: shortLevel.par, strokes: [1, 1], medal: 'gold' },
      teamStrokes: 2,
      isLastLevel: false,
    });
    expect(s.campaign).toEqual([done[0]?.result]);
    expect(ofType(all, 'turnStart').length).toBe(1);
  });

  it('restartLevel in levelResults (host) => aiming with strokes 0, campaign kept, activePlayer = firstPlayer', () => {
    const first = holeOut(startPlaying());
    const second = holeOut(stepSim(stepSim(first, [cont(1)]).state, [cont(0)]).state);
    expect(second.levelIndex).toBe(1);
    expect(second.campaign).toHaveLength(2);
    const r = stepSim(second, [{ type: 'restartLevel', playerId: 0 }]);
    expect(r.state).toMatchObject({ phase: 'aiming', levelIndex: 1, levelId: blueFirstLevel.id, activePlayer: 1, turnDelayTicks: TURN_DELAY_TICKS });
    expect(r.state.players.map((p) => p.strokes)).toEqual([0, 0]);
    expect(r.state.players.map((p) => p.aim)).toEqual([DEFAULT_AIM, DEFAULT_AIM]);
    expect(r.state.balls.map((b) => b.pos)).toEqual(blueFirstLevel.starts);
    expect(r.state.balls.every((b) => b.asleep && !b.sunk)).toBe(true);
    expect(r.state.campaign).toEqual([first.campaign[0]]);
    expect(r.events.map((e) => e.type)).toEqual(['levelRestart', 'levelStart', 'turnStart']);
    expect(ofType(r.events, 'levelStart')[0]).toMatchObject({ restarted: true, firstPlayer: 1, levelIndex: 1 });
    expect(ofType(r.events, 'turnStart')[0]).toMatchObject({ playerId: 1, readyInTicks: TURN_DELAY_TICKS });
    // a guest cannot retry the hole
    expect(ofType(stepSim(second, [{ type: 'restartLevel', playerId: 1 }]).events, 'commandRejected')[0]?.reason).toBe('notHost');
  });

  it('the next level starts with activePlayer = that level.firstPlayer (L3 is blue)', () => {
    const results = holeOut(startPlaying());
    const r = stepSim(results, [cont(1)]);
    expect(r.state).toMatchObject({ phase: 'intro', levelIndex: 1, levelId: blueFirstLevel.id, activePlayer: 1, turnDelayTicks: 0 });
    expect(r.state.players.map((p) => p.strokes)).toEqual([0, 0]);
    expect(r.state.balls.map((b) => b.pos)).toEqual(blueFirstLevel.starts);
    expect(r.events).toEqual([{ type: 'levelStart', levelId: blueFirstLevel.id, levelIndex: 1, firstPlayer: 1, restarted: false, tick: r.state.tick }]);
    expect(r.state.campaign).toHaveLength(1);
    const aiming = stepSim(r.state, [cont(0)]);
    expect(ofType(aiming.events, 'turnStart')[0]).toMatchObject({ playerId: 1 });
  });

  it('last level => campaignResults + campaignComplete', () => {
    const first = holeOut(startPlaying());
    const second = holeOut(stepSim(stepSim(first, [cont(0)]).state, [cont(1)]).state);
    const r = stepSim(second, [cont(0)]);
    expect(r.state.phase).toBe('campaignResults');
    expect(r.state.campaign).toHaveLength(2);
    expect(ofType(r.events, 'campaignComplete')).toEqual([
      expect.objectContaining({ results: second.campaign, totalStrokes: 4, coursePar: 6, medal: 'gold' }),
    ]);
    // terminal: nothing is accepted any more
    for (const cmd of [cont(0), { type: 'restartLevel', playerId: 0 } as const, { type: 'shoot', playerId: 0 } as const]) {
      const again = stepSim(r.state, [cmd]);
      expect(ofType(again.events, 'commandRejected')[0]?.reason).toBe('wrongPhase');
      expect(again.state).toEqual({ ...r.state, tick: r.state.tick + 1 });
    }
  });

  it('a second continue after the phase changed => wrongPhase and no state change', () => {
    const intro = createSim(config()).state;
    const same = stepSim(intro, [cont(0), cont(1)]);
    expect(same.state.phase).toBe('aiming');
    expect(ofType(same.events, 'commandRejected')).toEqual([{ type: 'commandRejected', command: 'continue', playerId: 1, reason: 'wrongPhase', tick: 1 }]);
    const later = stepSim(same.state, [cont(1)]);
    expect(later.state).toEqual(stepSim(same.state, []).state);
    expect(later.events.map((e) => e.type)).toEqual(['commandRejected']);
  });

  describe('meta commands stamped with their screen (MetaScreen): first wins', () => {
    const next = (playerId: PlayerId): PlayerCommand => ({ type: 'continue', playerId, levelIndex: 0, phase: 'levelResults' });
    const retry: PlayerCommand = { type: 'restartLevel', playerId: 0, levelIndex: 0, phase: 'levelResults' };
    const rejections = (events: readonly SimEvent[]) => ofType(events, 'commandRejected').map((e) => [e.command, e.playerId, e.reason]);

    it('two Next hole presses in the same tick => the next level intro, the second rejected', () => {
      const results = holeOut(startPlaying());
      const r = stepSim(results, [next(0), next(1)]);
      expect(r.state).toMatchObject({ phase: 'intro', levelIndex: 1, levelId: blueFirstLevel.id });
      expect(rejections(r.events)).toEqual([['continue', 1, 'wrongPhase']]);
    });

    it('a Next hole press arriving one tick after the first => still the next level intro', () => {
      const intro = stepSim(holeOut(startPlaying()), [next(1)]).state;
      const later = stepSim(intro, [next(0)]);
      expect(later.state).toEqual(stepSim(intro, []).state);
      expect(later.state.phase).toBe('intro');
      expect(rejections(later.events)).toEqual([['continue', 0, 'wrongPhase']]);
    });

    it('Next then Retry in one tick => the next level intro; the late Retry never restarts the new hole', () => {
      const r = stepSim(holeOut(startPlaying()), [next(1), retry]);
      expect(r.state).toMatchObject({ phase: 'intro', levelIndex: 1 });
      expect(ofType(r.events, 'levelRestart')).toEqual([]);
      expect(rejections(r.events)).toEqual([['restartLevel', 0, 'wrongPhase']]);
    });

    it('Retry then Next in one tick => the finished hole restarts; the late Next is dropped', () => {
      const r = stepSim(holeOut(startPlaying()), [retry, next(1)]);
      expect(r.state).toMatchObject({ phase: 'aiming', levelIndex: 0, campaign: [] });
      expect(rejections(r.events)).toEqual([['continue', 1, 'wrongPhase']]);
    });

    it('a pause-menu restart stamped with the level only works while aiming and flying', () => {
      const aiming = untilReady(startPlaying());
      const restart: PlayerCommand = { type: 'restartLevel', playerId: 0, levelIndex: 0 };
      expect(ofType(stepSim(aiming, [restart]).events, 'levelRestart')).toHaveLength(1);
      const flying = stepSim(aiming, [{ type: 'shoot', playerId: aiming.activePlayer }]).state;
      expect(flying.phase).toBe('flying');
      expect(ofType(stepSim(flying, [restart]).events, 'levelRestart')).toHaveLength(1);
      expect(rejections(stepSim(flying, [{ ...restart, levelIndex: 1 }]).events)).toEqual([['restartLevel', 0, 'wrongPhase']]);
    });
  });

  it('every number in the new state is finite every tick (non-finite throws)', () => {
    const aiming = startPlaying();
    const broken: SimState = {
      ...aiming,
      phase: 'flying',
      balls: [{ ...aiming.balls[0], asleep: false, vel: { x: Number.NaN, y: 0 } }, aiming.balls[1]],
    };
    expect(() => stepSim(broken, [])).toThrow('sim: non-finite state');
    const infinite: SimState = { ...aiming, players: [{ strokes: Number.POSITIVE_INFINITY, aim: DEFAULT_AIM }, aiming.players[1]] };
    expect(() => stepSim(infinite, [])).toThrow('sim: non-finite state');
  });

  it('stepSim never mutates its input state', () => {
    const frozen = deepFreeze(startPlaying());
    const r = stepSim(frozen, [{ type: 'setAim', playerId: 0, angle: -1, power: 60 }, { type: 'shoot', playerId: 0 }]);
    expect(r.state.phase).toBe('flying');
    expect(frozen.phase).toBe('aiming');
    let s = deepFreeze(r.state);
    for (let i = 0; i < 120; i += 1) s = deepFreeze(stepSim(s, []).state);
    expect(s.tick).toBe(frozen.tick + 121);
  });
});
