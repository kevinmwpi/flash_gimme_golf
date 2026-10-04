// OWNER: input-loop
/**
 * Loop glue (ARCH.md §1.12, §2; BUILD_DECISIONS D3): canvas sizing/letterboxing (DPR, matchMedia for
 * DPR changes, ResizeObserver on the wrapper), the fixed-step loop with a PERSISTENT pending command
 * queue (drained by the first step of a frame, accumulating while paused, setAim coalesced in place),
 * the online substitution (GameClient.interpolated / drainEvents / renderTime, snap on
 * discontinuities, local echo of the aim), ONE input poll per frame, the ViewState, the aim preview
 * (real predictShot, memoised) and the renderFrame call. React never re-renders per frame: HUD data
 * arrives through `onFrame` (10 Hz, plus every phase change) and `onEvents`; the power meter is
 * written as CSS custom properties on `hudRef` every frame.
 */
import React, { useEffect, useRef } from 'react';
import type { GameClient } from '../net/GameClient';
import { predictShot, switchPresser } from '../sim/physics';
import { createSim, isShotReady, levelOf, stepSim } from '../sim/sim';
import { isRectActive, switchMaskOf } from '../sim/terrain';
import type { Aim, Level, PlayerCommand, PlayerId, SimConfig, SimEvent, SimPhase, SimState, StepResult, Vec } from '../sim/types';
import { DT, MAX_POWER, MIN_POWER, VIEWPORT_H, VIEWPORT_W } from '../sim/types';
import type { AudioSystem } from './audio';
import { createInputSystem, type InputSystem, type MissKind, type PointerDrag, type UiAction } from './input/index';
import { renderFrame } from './render/index';
import {
  applySimEvents,
  createViewState,
  pulseMissRings,
  screenToWorld,
  setCameraMode,
  updateView,
  worldToScreen,
  type AimPreview,
  type CameraMode,
  type DragVisual,
  type InputDevice,
  type ViewState,
} from './view';

export type LocalSession = { kind: 'local'; config: SimConfig; initial: StepResult; seats: readonly PlayerId[] };
export type OnlineSessionView = { kind: 'online'; client: GameClient; config: SimConfig; seat: PlayerId };

export type FrameSummary = {
  phase: SimPhase;
  tick: number;
  activePlayer: PlayerId;
  turnReady: boolean;
  strokes: [number, number];
  aim: Aim;
  device: InputDevice;
  cameraMode: CameraMode;
  levelId: string;
  seatIsActive: boolean;
  paused: boolean;
  /** BUILD_DECISIONS D3 (UX CD-7). */
  sunk: [boolean, boolean];
  turnDelayTicks: number;
  /** switchId -> slot whose resting ball presses it, from SimState (VISUAL.md §11), so a resumed or re-synced game is right at once. */
  holds: Record<string, PlayerId>;
  /** A fresh miss press (UX.md §5.2), for MISS_HINT_MS or until a real drag starts; drives the hint pill. */
  miss: MissKind | null;
};

export type GameCanvasProps = {
  session: LocalSession | OnlineSessionView;
  /** local only: stops stepping (online ignores); in both modes input is disabled while paused */
  paused: boolean;
  /** pause/mute/camera -> App */
  onUiAction(action: UiAction): void;
  /** throttled (10 Hz) HUD data */
  onFrame(summary: FrameSummary): void;
  /** for React callouts (ui/eventBus.ts) */
  onEvents(events: readonly SimEvent[]): void;
  audio: AudioSystem;
  /** commands from React overlays (continue, restartLevel), stamped playerId 0 locally; drained each frame */
  externalCommands: React.RefObject<PlayerCommand[]>;
  /** GameCanvas writes --power / --angle-deg / --aim-ready / --ball-x / --ball-y / --dragging on it every frame */
  hudRef: React.RefObject<HTMLElement | null>;
  /**
   * UI actions raised by React (the HUD camera button): drained every frame and applied to the view
   * like device input, without echoing back through `onUiAction`. A `toggleCamera` produced by the
   * input devices is applied locally AND forwarded; `FrameSummary.cameraMode` reports the result.
   */
  externalUiActions?: React.RefObject<UiAction[]>;
  /** Written every frame with the state just rendered (Pause's "Copy share link" encodes it). */
  stateRef?: React.RefObject<SimState | null>;
};

/** Frame delta clamp: a hidden tab never fast-forwards (ARCH.md §2.1). */
const MAX_FRAME_DT = 0.25;
const SUMMARY_INTERVAL_MS = 100;
const EMPTY: readonly PlayerCommand[] = Object.freeze([]);
const NO_ACTIONS: readonly UiAction[] = Object.freeze([]);
const FAN_INTENSITY = 1;
/** How long the hint pill keeps the miss copy after a press that grabbed nothing. */
export const MISS_HINT_MS = 2000;
/** AUDIO.md §8 item 6: the power meter ticks at every 10 % notch. */
const AIM_NOTCHES = 10;

/** A setAim replaces the last pending setAim for the same slot IN PLACE (order vs shoot preserved). */
export function enqueue(pending: PlayerCommand[], commands: readonly PlayerCommand[]): void {
  for (const cmd of commands) {
    if (cmd.type === 'setAim') {
      let replaced = false;
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        const p = pending[i];
        if (p !== undefined && p.type === 'setAim' && p.playerId === cmd.playerId) {
          pending[i] = cmd;
          replaced = true;
          break;
        }
      }
      if (replaced) continue;
    }
    pending.push(cmd);
  }
}

/**
 * --angle-deg follows the UX convention (0 = right, 90 = straight up); the sim angle is y-down radians.
 * --ball-x / --ball-y are the active ball's stage-space position (unitless px) so stage-space DOM such as
 * the onboarding coach and the touch power readout can anchor to it; --dragging is 1 while a slingshot
 * drag is live (UX.md §4.5 / §5.5).
 */
function writeHudVars(hud: HTMLElement | null, aim: Aim, ready: boolean, ball: Vec, dragging: boolean): void {
  if (hud === null) return;
  hud.style.setProperty('--power', String((aim.power - MIN_POWER) / (MAX_POWER - MIN_POWER)));
  hud.style.setProperty('--angle-deg', String(Math.round((-aim.angle * 180) / Math.PI)));
  hud.style.setProperty('--aim-ready', ready ? '1' : '0');
  hud.style.setProperty('--ball-x', String(Math.round(ball.x)));
  hud.style.setProperty('--ball-y', String(Math.round(ball.y)));
  hud.style.setProperty('--dragging', dragging ? '1' : '0');
}

/** The live slingshot drag for the renderer: logical screen px -> world space under the frame's camera. */
function dragVisual(view: ViewState, drag: PointerDrag | null): DragVisual | null {
  if (drag === null) return null;
  return { pointer: screenToWorld(view, drag.pointer), cancel: drag.cancel, clamped: drag.clamped };
}

function seatsOf(session: LocalSession | OnlineSessionView): readonly PlayerId[] {
  return session.kind === 'local' ? session.seats : [session.seat];
}

/** Who physically holds each pressed switch (a cup hold has no slot and is reported by the level's `cupHoldsSwitch`). */
function holdsOf(level: Level, sim: SimState): Record<string, PlayerId> {
  const holds: Record<string, PlayerId> = {};
  for (const sw of level.switches) {
    if (sim.switches[sw.id] !== true) continue;
    const presser = switchPresser(level, sw, sim.switches, sim.balls);
    if (presser !== null) holds[sw.id] = presser;
  }
  return holds;
}

type SummaryFlags = { paused: boolean; miss: MissKind | null };

function summarise(sim: SimState, level: Level, view: ViewState, device: InputDevice, seats: readonly PlayerId[], flags: SummaryFlags): FrameSummary {
  return {
    phase: sim.phase,
    tick: sim.tick,
    activePlayer: sim.activePlayer,
    turnReady: isShotReady(sim),
    strokes: [sim.players[0].strokes, sim.players[1].strokes],
    aim: sim.players[sim.activePlayer].aim,
    device,
    cameraMode: view.cameraMode,
    levelId: sim.levelId,
    seatIsActive: seats.some((seat) => (sim.config.mode === 'solo' ? seat === 0 : seat === sim.activePlayer)),
    paused: flags.paused,
    sunk: [sim.balls[0].sunk, sim.balls[1].sunk],
    turnDelayTicks: sim.turnDelayTicks,
    holds: holdsOf(level, sim),
    miss: flags.miss,
  };
}

/**
 * AUDIO.md §8 item 6: `audio.sfx.aimTick(power01)` whenever the local meter's 10 % notch changes.
 * The notch is only (re)seeded, never ticked, when the local aim appears (turn start, level start).
 */
export function createAimTicker(): (audio: AudioSystem, sim: SimState, aim: Aim | null) => void {
  let lastNotch: number | null = null;
  return (audio, sim, aim) => {
    if (aim === null || sim.phase !== 'aiming') {
      lastNotch = null;
      return;
    }
    const power01 = (aim.power - MIN_POWER) / (MAX_POWER - MIN_POWER);
    const notch = Math.floor(power01 * AIM_NOTCHES);
    if (lastNotch !== null && notch !== lastNotch) audio.sfx.aimTick(power01);
    lastNotch = notch;
  };
}

/** The miss shown in the HUD: the latest miss press for MISS_HINT_MS, dropped as soon as a real drag starts. */
function createMissTracker(): (miss: MissKind | null, dragging: boolean, nowMs: number) => MissKind | null {
  let kind: MissKind | null = null;
  let until = -Infinity;
  return (miss, dragging, nowMs) => {
    if (miss !== null) {
      kind = miss;
      until = nowMs + MISS_HINT_MS;
    }
    if (dragging || nowMs >= until) kind = null;
    return kind;
  };
}

/** D3: any non-sunk ball whose centre is inside an ACTIVE fan AABB. */
function fanActive(level: Level, sim: SimState): boolean {
  for (const rect of level.rects) {
    if (rect.kind !== 'fan' || !isRectActive(rect, sim.switches)) continue;
    for (const ball of sim.balls) {
      if (ball.sunk) continue;
      const { x, y } = ball.pos;
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return true;
    }
  }
  return false;
}

/** Memoised `predictShot` for the active slot (ARCH §2.1): local aim when a local seat owns it, else the sim's. */
function createAimPreviewer(): (sim: SimState, level: Level, localAim: Aim | null) => AimPreview | null {
  let key = '';
  let cached: AimPreview | null = null;
  return (sim, level, localAim) => {
    if (sim.phase !== 'aiming') return null;
    const p = sim.activePlayer;
    const aim = localAim ?? sim.players[p].aim;
    const remote = localAim === null;
    const [b0, b1] = sim.balls;
    const next = `${sim.levelId}|${p}|${aim.angle}|${aim.power}|${switchMaskOf(level, sim.switches)}|${b0.pos.x}|${b0.pos.y}|${b1.pos.x}|${b1.pos.y}|${remote ? 1 : 0}`;
    if (next === key) return cached;
    key = next;
    const other = sim.balls[p === 0 ? 1 : 0];
    const shot = predictShot(level, sim.switches, sim.balls[p], p, aim, [other]);
    cached = { points: shot.points, landing: shot.landing, outcome: shot.outcome, playerId: p, remote };
    return cached;
  };
}

/** Letterbox the 1280x720 stage into the wrapper; returns the canvas transform scale (CSS scale x DPR). */
function fitCanvas(wrapper: HTMLDivElement, canvas: HTMLCanvasElement): number {
  const rect = wrapper.getBoundingClientRect();
  const scale = Math.max(0.01, Math.min(rect.width / VIEWPORT_W, rect.height / VIEWPORT_H));
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${VIEWPORT_W * scale}px`;
  canvas.style.height = `${VIEWPORT_H * scale}px`;
  canvas.width = Math.round(VIEWPORT_W * scale * dpr);
  canvas.height = Math.round(VIEWPORT_H * scale * dpr);
  wrapper.style.setProperty('--stage-scale', String(scale));
  return scale * dpr;
}

/** Re-fits on wrapper resizes and on DPR changes (zoom, moving between monitors). Returns a disposer. */
function watchLayout(wrapper: HTMLDivElement, onChange: () => void): () => void {
  let disposeMedia = (): void => {};
  const watchDpr = (): void => {
    disposeMedia();
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const onMedia = (): void => {
      onChange();
      watchDpr();
    };
    media.addEventListener('change', onMedia);
    disposeMedia = () => media.removeEventListener('change', onMedia);
  };
  watchDpr();
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(onChange);
    observer.observe(wrapper);
    return () => {
      observer.disconnect();
      disposeMedia();
    };
  }
  window.addEventListener('resize', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    disposeMedia();
  };
}

type LoopDeps = {
  session: LocalSession | OnlineSessionView;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  wrapper: HTMLDivElement;
  latest: React.RefObject<GameCanvasProps>;
};

type Loop = { frame(now: number): void; dispose(): void };

function createLoop({ session, canvas, ctx, wrapper, latest }: LoopDeps): Loop {
  const seats = seatsOf(session);
  const seat: PlayerId | null = session.kind === 'online' ? session.seat : null;
  const initial = session.kind === 'local' ? session.initial : createSim(session.config);
  let sim = initial.state;
  let prev = sim;
  let level = levelOf(sim);
  const view = createViewState(level, sim);
  const input: InputSystem = createInputSystem();
  input.attach(canvas);
  const previewFor = createAimPreviewer();
  const tickAim = createAimTicker();
  const trackMiss = createMissTracker();
  const pending: PlayerCommand[] = [];
  let acc = 0;
  let last = performance.now();
  let lastSummary = -Infinity;
  let lastPhase: SimPhase | null = null;
  let lastMiss: MissKind | null = null;
  let transformScale = fitCanvas(wrapper, canvas);

  const emit = (events: readonly SimEvent[], now: number): void => {
    if (events.length === 0) return;
    applySimEvents(view, events, sim);
    latest.current.audio.handleEvents(events, now, 0);
    latest.current.onEvents(events);
  };
  emit(initial.events, last);

  /** Local modes: fixed 60 Hz steps; the first step of a frame drains the persistent queue. */
  const stepLocal = (now: number): number => {
    let first = true;
    while (acc >= DT) {
      prev = sim;
      const r = stepSim(sim, first ? pending : EMPTY);
      if (first) {
        pending.length = 0;
        first = false;
      }
      sim = r.state;
      emit(r.events, now);
      acc -= DT;
    }
    return acc / DT;
  };

  /** Online: render the interpolated snapshot pair; events are released at the same render time. */
  const stepOnline = (client: GameClient, now: number): number => {
    for (const cmd of pending) client.sendCommand(cmd);
    pending.length = 0;
    const interp = client.interpolated(now);
    if (interp === null) {
      prev = sim;
      return 0;
    }
    prev = interp.prev;
    sim = interp.state;
    if (interp.snap) for (const rb of view.renderBalls) rb.snapNextFrame = true;
    emit(client.drainEvents(client.renderTime(now)), now);
    return interp.alpha;
  };

  const applyUi = (action: UiAction): void => {
    if (action === 'toggleCamera') setCameraMode(view, view.cameraMode === 'follow' ? 'overview' : 'follow', true);
  };

  const handleUi = (actions: readonly UiAction[]): void => {
    for (const action of actions) {
      applyUi(action);
      latest.current.onUiAction(action);
    }
  };

  const syncLevel = (): void => {
    if (sim.levelId === level.id) return;
    level = levelOf(sim);
    view.level = level;
  };

  const frame = (now: number): void => {
    const { paused, onFrame, hudRef, audio, externalUiActions, stateRef } = latest.current;
    const frameDt = Math.min(Math.max(0, now - last) / 1000, MAX_FRAME_DT);
    last = now;
    if (!paused) acc += frameDt;
    input.setEnabled(!paused);
    const frameIn = input.poll({ state: sim, seats, view, canvasRect: canvas.getBoundingClientRect(), dt: frameDt, nowMs: now });
    enqueue(pending, latest.current.externalCommands.current.splice(0));
    enqueue(pending, frameIn.commands);
    handleUi(frameIn.uiActions);
    for (const action of externalUiActions?.current.splice(0) ?? NO_ACTIONS) applyUi(action);
    const alpha = session.kind === 'local' ? stepLocal(now) : stepOnline(session.client, now);
    syncLevel();
    updateView(view, prev, sim, alpha, frameDt);
    view.lastDevice = frameIn.device;
    view.drag = dragVisual(view, frameIn.drag);
    if (frameIn.miss !== null && !paused) pulseMissRings(view, sim);
    const miss = paused ? null : trackMiss(frameIn.miss, frameIn.drag !== null, now);
    const localAim = input.localAim();
    view.aimPreview = previewFor(sim, level, localAim);
    tickAim(audio, sim, localAim);
    audio.setFan(fanActive(level, sim), FAN_INTENSITY);
    ctx.setTransform(transformScale, 0, 0, transformScale, 0, 0);
    renderFrame(ctx, { state: sim, view, seat, device: frameIn.device, showAim: view.aimPreview !== null });
    if (stateRef !== undefined) stateRef.current = sim;
    writeHudVars(hudRef.current, localAim ?? sim.players[sim.activePlayer].aim, isShotReady(sim), worldToScreen(view, sim.balls[sim.activePlayer].pos), view.drag !== null);
    if (now - lastSummary >= SUMMARY_INTERVAL_MS || sim.phase !== lastPhase || miss !== lastMiss) {
      lastSummary = now;
      lastPhase = sim.phase;
      lastMiss = miss;
      onFrame(summarise(sim, level, view, frameIn.device, seats, { paused, miss }));
    }
  };

  const onLayout = (): void => {
    transformScale = fitCanvas(wrapper, canvas);
  };
  const onVisibility = (): void => {
    last = performance.now();
  };
  const disposeLayout = watchLayout(wrapper, onLayout);
  document.addEventListener('visibilitychange', onVisibility);

  return {
    frame,
    dispose() {
      disposeLayout();
      document.removeEventListener('visibilitychange', onVisibility);
      input.detach();
    },
  };
}

export default function GameCanvas(props: GameCanvasProps): React.JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  const { session } = props;

  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (wrapper === null || canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const loop = createLoop({ session, canvas, ctx, wrapper, latest });
    let raf = 0;
    const tick = (now: number): void => {
      loop.frame(now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      loop.dispose();
    };
  }, [session]);

  return (
    <div ref={wrapperRef} className="stage">
      <canvas ref={canvasRef} className="stage-canvas" tabIndex={0} aria-label="Flash Golf playfield" />
    </div>
  );
}
