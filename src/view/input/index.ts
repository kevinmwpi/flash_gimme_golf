// OWNER: input-loop
/**
 * Input composition (ARCH.md §1.11, §7; UX.md §5). Adapters produce ABSOLUTE aims; the adapter that
 * produced input most recently sets `device` (drives hint copy). Gameplay commands are stamped
 * `playerId = state.activePlayer` only when a local seat controls that slot AND the sim would accept
 * them (`allowedCommands`). `setAim` is emitted only when the quantised aim changed since the last
 * emitted one, at most once per frame, and always BEFORE a `shoot` in the same frame. A `shoot`
 * requested during the turn delay is held as a pending shot (max PENDING_SHOOT_MS) and fires on the
 * first frame `isShotReady` (fixes audit #24: handoff no longer eats the Space press).
 */
import { allowedCommands, canControl, isShotReady } from '../../sim/sim';
import type { Aim, PlayerCommand, PlayerId, SimPhase, SimState, Vec } from '../../sim/types';
import { AIM_ANGLE_MAX, AIM_ANGLE_MIN, MAX_POWER, MIN_POWER, quantize1, quantize4 } from '../../sim/types';
import type { InputDevice, ViewState } from '../view';
import { createGamepad } from './gamepad';
import { createKeyboard } from './keyboard';
import { createPointer } from './pointer';

export type UiAction = 'pause' | 'toggleCamera' | 'toggleMute' | 'confirm' | 'back';

export type InputContext = {
  state: SimState;
  /** seats this browser controls: solo [0]; local [0,1]; online [seat] */
  seats: readonly PlayerId[];
  /** for screenToWorld */
  view: ViewState;
  /** CSS box of the canvas for pointer->logical mapping */
  canvasRect: DOMRect;
  /** seconds since last poll */
  dt: number;
  nowMs: number;
};

/** A live slingshot drag in LOGICAL screen px (the loop maps it to world space for `ViewState.drag`). */
export type PointerDrag = { pointer: Vec; cancel: boolean; clamped: boolean };

/**
 * A press that grabbed nothing (UX.md §5.2 "Miss feedback"): off the active ball, on the partner's
 * ball, or by a seat that is not aiming. View-only: the sim never sees it.
 */
export type MissKind = 'miss' | 'wrongBall' | 'notYourTurn';

export type InputFrame = {
  commands: PlayerCommand[];
  uiActions: UiAction[];
  device: InputDevice;
  drag: PointerDrag | null;
  /** Set on the frame a press was decided to be a miss. */
  miss: MissKind | null;
};

export type InputSystem = {
  attach(canvas: HTMLCanvasElement): void;
  detach(): void;
  /** once per animation frame */
  poll(ctx: InputContext): InputFrame;
  /** Live integrated local aim for the active slot when a local seat controls it (local echo); null otherwise. */
  localAim(): Aim | null;
  /** false while a React overlay has focus */
  setEnabled(enabled: boolean): void;
};

export type AdapterResult = {
  /** Absolute aim (clamped by the adapter; quantised here). */
  aim?: Aim;
  shoot?: boolean;
  ui: UiAction[];
  /** true when the adapter handled input since the last poll (drives `device`). */
  active: boolean;
  /** Pointer adapter: the drag in progress (rubber band / CANCEL / AIM UPWARD stickers). */
  drag?: PointerDrag;
  /** Pointer adapter: a press that grabbed nothing. */
  miss?: MissKind;
  /** Pointer adapters report 'touch' vs 'pointer'; others use their default. */
  device?: InputDevice;
};

export type DeviceAdapter = {
  attach(canvas: HTMLCanvasElement): void;
  detach(): void;
  /** Produces aim/shoot/ui intents for the frame; `aim` is absolute (adapter integrates rates itself). */
  poll(ctx: InputContext, currentAim: Aim): AdapterResult;
};

/** A shot requested while `turnDelayTicks > 0` waits this long for the sim to become ready (ARCH §7). */
export const PENDING_SHOOT_MS = 600;

/** The seat in `seats` that owns the active slot, or null when this browser is only watching. */
export function controllingSeat(state: SimState, seats: readonly PlayerId[]): PlayerId | null {
  for (const seat of seats) if (canControl(state.config, seat, state.activePlayer)) return seat;
  return null;
}

/** Clamp + quantise exactly as the sim stores it, so change detection matches what the sim will keep. */
export function normalizeAim(aim: Aim): Aim {
  return {
    angle: quantize4(Math.min(AIM_ANGLE_MAX, Math.max(AIM_ANGLE_MIN, aim.angle))),
    power: quantize1(Math.min(MAX_POWER, Math.max(MIN_POWER, aim.power))),
  };
}

function sameAim(a: Aim, b: Aim): boolean {
  return a.angle === b.angle && a.power === b.power;
}

/** UX §1.6 initial guess: touch when the device has touch points and no fine pointer. */
function detectInitialDevice(): InputDevice {
  if (typeof navigator === 'undefined' || navigator.maxTouchPoints === 0) return 'pointer';
  const fine = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
  return fine ? 'pointer' : 'touch';
}

/** The locally owned aim of the active slot. `emitted` is the last value handed to the sim/server. */
type LocalAim = { slot: PlayerId; aim: Aim; emitted: Aim };

type Adapters = readonly { adapter: DeviceAdapter; device: InputDevice }[];

export function createInputSystem(): InputSystem {
  const adapters: Adapters = [
    { adapter: createKeyboard(), device: 'keyboard' },
    { adapter: createGamepad(), device: 'gamepad' },
    { adapter: createPointer(), device: 'pointer' },
  ];
  let enabled = true;
  let device: InputDevice = detectInitialDevice();
  let local: LocalAim | null = null;
  let prevPhase: SimPhase | null = null;
  let prevTurnDelay = 0;
  let pendingShootUntil = 0;

  /** A new turn (hand-off, restart, intro dismissed) re-seeds the local aim from the sim's stored aim. */
  const syncLocalAim = (state: SimState, controls: boolean): void => {
    const newTurn = prevPhase !== 'aiming' || state.turnDelayTicks > prevTurnDelay;
    prevPhase = state.phase;
    prevTurnDelay = state.turnDelayTicks;
    if (!controls) {
      local = null;
      pendingShootUntil = 0;
      return;
    }
    if (local === null || local.slot !== state.activePlayer || newTurn) {
      const aim = state.players[state.activePlayer].aim;
      local = { slot: state.activePlayer, aim, emitted: aim };
      pendingShootUntil = 0;
    }
  };

  return {
    attach(canvas) {
      for (const a of adapters) a.adapter.attach(canvas);
    },
    detach() {
      for (const a of adapters) a.adapter.detach();
      local = null;
      pendingShootUntil = 0;
    },
    poll(ctx) {
      const { state, nowMs } = ctx;
      const seat = controllingSeat(state, ctx.seats);
      const allowed = seat === null ? [] : allowedCommands(state, seat);
      const canAim = allowed.includes('setAim');
      syncLocalAim(state, canAim);
      const currentAim = local?.aim ?? state.players[state.activePlayer].aim;

      let aim: Aim | null = null;
      let shootRequested = false;
      let drag: PointerDrag | null = null;
      let miss: MissKind | null = null;
      const uiActions: UiAction[] = [];
      for (const { adapter, device: fallback } of adapters) {
        const r = adapter.poll(ctx, currentAim);
        if (!r.active) continue;
        device = r.device ?? fallback;
        if (r.aim !== undefined) aim = r.aim;
        if (r.shoot === true) shootRequested = true;
        if (r.drag !== undefined) drag = r.drag;
        if (r.miss !== undefined) miss = r.miss;
        for (const action of r.ui) uiActions.push(action);
      }
      if (!enabled) return { commands: [], uiActions: [], device, drag: null, miss: null };

      const commands: PlayerCommand[] = [];
      if (local !== null && canAim) {
        const slot = local.slot;
        if (aim !== null) local.aim = normalizeAim(aim);
        if (!sameAim(local.aim, local.emitted)) {
          local.emitted = local.aim;
          commands.push({ type: 'setAim', playerId: slot, angle: local.aim.angle, power: local.aim.power });
        }
        if (shootRequested && !isShotReady(state)) pendingShootUntil = nowMs + PENDING_SHOOT_MS;
        if (pendingShootUntil !== 0 && nowMs >= pendingShootUntil) pendingShootUntil = 0;
        const pendingReady = pendingShootUntil !== 0 && isShotReady(state);
        if ((shootRequested && isShotReady(state)) || pendingReady) {
          pendingShootUntil = 0;
          commands.push({ type: 'shoot', playerId: slot });
        }
      }
      return { commands, uiActions, device, drag, miss };
    },
    localAim() {
      return local?.aim ?? null;
    },
    setEnabled(on) {
      enabled = on;
      if (!on) pendingShootUntil = 0;
    },
  };
}
