// @vitest-environment jsdom
// OWNER: input-loop
// ARCH.md §4 loop row (fake RAF) + BUILD_DECISIONS D3 (setFan per frame, FrameSummary.sunk/turnDelayTicks).
// The sim step, renderer, level registry and predictShot are mocked so the test observes exactly which
// command batches the loop hands to `stepSim` on which frame.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SimModule from '../../sim/sim';
import type { Level, PlayerCommand, SimState } from '../../sim/types';
import { createAudio, type AudioSystem } from '../audio';
import GameCanvas, { enqueue, type FrameSummary, type GameCanvasProps, type LocalSession } from '../GameCanvas';

const fixture: Level = {
  id: 'test-flat',
  name: 'Flat',
  world: 1,
  order: 1,
  par: 4,
  hint: 'hint',
  aha: 'aha',
  watchOut: 'watch out',
  mechanicsIntroduced: ['sand'],
  firstPlayer: 0,
  mechanicsPresent: [],
  width: 1600,
  height: 720,
  wind: 0,
  terrain: { pieces: [{ surface: [{ x: 0, y: 600 }, { x: 1600, y: 600 }], baseY: 720 }], gaps: [] },
  rects: [],
  switches: [],
  hole: { x: 1400, rimY: 600, radius: 16 },
  starts: [{ x: 420, y: 588 }, { x: 520, y: 588 }],
};

const { batches, level } = vi.hoisted(() => ({ batches: [] as PlayerCommand[][], level: { current: null as Level | null } }));

vi.mock('../../sim/levels/index', () => ({
  LEVELS: [],
  WORLD1_IDS: [],
  levelById: () => {
    if (level.current === null) throw new Error('fixture not set');
    return level.current;
  },
  hasLevel: () => true,
  coursePar: () => 0,
  campaignFrom: () => [],
  worldTitle: () => 'World 1',
}));

vi.mock('../../sim/sim', async (importOriginal) => {
  const mod = await importOriginal<typeof SimModule>();
  return {
    ...mod,
    stepSim: (state: SimState, commands: readonly PlayerCommand[]) => {
      batches.push([...commands]);
      return { state: { ...state, tick: state.tick + 1 }, events: [] };
    },
  };
});

vi.mock('../render/index', () => ({ renderFrame: () => {} }));
vi.mock('../../sim/physics', () => ({ predictShot: () => ({ points: [], landing: null, outcome: 'running' }) }));

type Rig = {
  root: Root;
  host: HTMLDivElement;
  frame(nowMs: number): void;
  render(overrides?: Partial<GameCanvasProps>): void;
  external: React.RefObject<PlayerCommand[]>;
  summaries: FrameSummary[];
  audio: ReturnType<typeof createAudio>;
  hud: HTMLElement;
};

let rafCallbacks: FrameRequestCallback[] = [];
let clock = 0;

beforeEach(async () => {
  level.current = fixture;
  batches.length = 0;
  rafCallbacks = [];
  clock = 1000;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  HTMLCanvasElement.prototype.getContext = (() => ({ setTransform() {} })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  await Promise.resolve();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function mount(initialProps: Partial<GameCanvasProps> = {}): Promise<Rig> {
  const { createSim } = await import('../../sim/sim');
  const config = { playerCount: 1 as const, levelIds: [fixture.id], seed: 3, mode: 'solo' as const };
  const session: LocalSession = { kind: 'local', config, initial: createSim(config), seats: [0] };
  const external: React.RefObject<PlayerCommand[]> = { current: [] };
  const hud = document.createElement('div');
  const hudRef: React.RefObject<HTMLElement | null> = { current: hud };
  const summaries: FrameSummary[] = [];
  const audio = createAudio();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const base: GameCanvasProps = {
    session,
    paused: false,
    onUiAction: () => {},
    onFrame: (s) => summaries.push(s),
    onEvents: () => {},
    audio,
    externalCommands: external,
    hudRef,
  };
  const render = (overrides: Partial<GameCanvasProps> = {}): void => {
    act(() => root.render(React.createElement(GameCanvas, { ...base, ...initialProps, ...overrides })));
  };
  render();
  const frame = (nowMs: number): void => {
    clock = nowMs;
    const pending = rafCallbacks;
    rafCallbacks = [];
    for (const cb of pending) cb(nowMs);
  };
  return { root, host, frame, render, external, summaries, audio, hud };
}

describe('fixed-step loop', () => {
  it('a shoot produced on a frame with acc < DT is applied on the next frame that steps (persistent pending)', async () => {
    const r = await mount();
    r.frame(1000);
    expect(batches).toEqual([]);
    r.external.current.push({ type: 'shoot', playerId: 0 });
    r.frame(1005);
    expect(batches).toEqual([]);
    r.frame(1025);
    expect(batches).toEqual([[{ type: 'shoot', playerId: 0 }]]);
    r.frame(1060);
    expect(batches.slice(1).every((b) => b.length === 0)).toBe(true);
    expect(batches.length).toBeGreaterThan(2);
  });

  it('two setAim in one frame collapse to the latest (in place, order vs shoot preserved)', async () => {
    const r = await mount();
    r.frame(1000);
    r.external.current.push({ type: 'setAim', playerId: 0, angle: -1, power: 20 });
    r.external.current.push({ type: 'shoot', playerId: 0 });
    r.external.current.push({ type: 'setAim', playerId: 0, angle: -0.5, power: 70 });
    r.frame(1020);
    expect(batches[0]).toEqual([
      { type: 'setAim', playerId: 0, angle: -0.5, power: 70 },
      { type: 'shoot', playerId: 0 },
    ]);
    const queue: PlayerCommand[] = [];
    enqueue(queue, [{ type: 'setAim', playerId: 1, angle: -1, power: 20 }]);
    enqueue(queue, [{ type: 'setAim', playerId: 0, angle: -1, power: 20 }]);
    enqueue(queue, [{ type: 'setAim', playerId: 1, angle: -2, power: 90 }]);
    expect(queue).toEqual([
      { type: 'setAim', playerId: 1, angle: -2, power: 90 },
      { type: 'setAim', playerId: 0, angle: -1, power: 20 },
    ]);
  });

  it('continue queued while paused is applied after resume', async () => {
    const r = await mount({ paused: true });
    r.frame(1000);
    r.external.current.push({ type: 'continue', playerId: 0 });
    r.frame(1050);
    r.frame(1100);
    expect(batches).toEqual([]);
    r.render({ paused: false });
    r.frame(1120);
    expect(batches[0]).toEqual([{ type: 'continue', playerId: 0 }]);
  });

  it('GameCanvas calls audio.setFan(active, intensity) once per frame (D3)', async () => {
    const r = await mount();
    const setFan = vi.spyOn(r.audio, 'setFan');
    r.frame(1000);
    r.frame(1016);
    r.frame(1032);
    expect(setFan).toHaveBeenCalledTimes(3);
    expect(setFan).toHaveBeenLastCalledWith(false, 1);
  });

  it('aimTick plays when the local power crosses a 10 % notch, never when the aim appears or outside aiming (AUDIO.md §8.6)', async () => {
    const { createAimTicker } = await import('../GameCanvas');
    const aimTick = vi.fn();
    const audio = { sfx: { aimTick } } as unknown as AudioSystem;
    const aiming = { phase: 'aiming' } as SimState;
    const tick = createAimTicker();
    tick(audio, aiming, { angle: -1, power: 55 });
    tick(audio, aiming, { angle: -1, power: 58 });
    expect(aimTick).not.toHaveBeenCalled();
    tick(audio, aiming, { angle: -1, power: 64 });
    expect(aimTick).toHaveBeenCalledTimes(1);
    expect(aimTick).toHaveBeenLastCalledWith(0.6);
    tick(audio, aiming, { angle: -1, power: 40 });
    expect(aimTick).toHaveBeenCalledTimes(2);
    tick(audio, aiming, null);
    tick(audio, aiming, { angle: -1, power: 100 });
    expect(aimTick).toHaveBeenCalledTimes(2);
    tick(audio, { phase: 'flying' } as SimState, { angle: -1, power: 10 });
    expect(aimTick).toHaveBeenCalledTimes(2);
  });

  it('FrameSummary carries sunk and turnDelayTicks (D3 CD-7) and is throttled to 10 Hz', async () => {
    const r = await mount();
    r.frame(1000);
    r.frame(1016);
    r.frame(1050);
    expect(r.summaries).toHaveLength(1);
    r.frame(1100);
    expect(r.summaries).toHaveLength(2);
    const s = r.summaries[1];
    expect(s?.sunk).toEqual([false, false]);
    expect(s?.turnDelayTicks).toBe(0);
    expect(s?.phase).toBe('intro');
    expect(s?.device).toBeDefined();
  });

  it('the stage wrapper gets --stage-scale and the hud gets --power / --angle-deg / --aim-ready', async () => {
    const r = await mount();
    r.frame(1000);
    const stage = r.host.querySelector<HTMLElement>('.stage');
    expect(stage?.style.getPropertyValue('--stage-scale')).not.toBe('');
    expect(r.hud.style.getPropertyValue('--power')).toBe('0.5');
    expect(r.hud.style.getPropertyValue('--angle-deg')).toBe('45');
    expect(r.hud.style.getPropertyValue('--aim-ready')).toBe('0');
  });
});
