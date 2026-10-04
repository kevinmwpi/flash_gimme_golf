// OWNER: input-loop
/**
 * Gamepad adapter (ARCH.md §7; standard mapping): `navigator.getGamepads()` is polled each frame.
 * Left stick (dead zone STICK_DEAD_ZONE) sets the angle ABSOLUTELY as `atan2(-|y|, x)` so the stick
 * direction is the shot direction (always upward); the right trigger ramps power up and the left
 * trigger down at KEY_POWER_RATE * TRIGGER_POWER_FACTOR, as does the right stick Y. Rising edges:
 * A (0) shoot, B (1) back, X (2) camera, Y (3) mute, Start (9) pause. Local 2P maps pad index to
 * seat (pad 0 = P1, pad 1 = P2); solo/online treat every pad as the local seat. Only the pad whose
 * seat owns the active slot produces gameplay input; UI buttons work from any pad.
 */
import { canControl } from '../../sim/sim';
import type { Aim, PlayerId, SimConfig } from '../../sim/types';
import { AIM_ANGLE_MAX, AIM_ANGLE_MIN, KEY_POWER_RATE, MAX_POWER, MIN_POWER } from '../../sim/types';
import type { AdapterResult, DeviceAdapter, InputContext, UiAction } from './index';

export const STICK_DEAD_ZONE = 0.2;
export const TRIGGER_POWER_FACTOR = 2;

const BUTTON_A = 0;
const BUTTON_B = 1;
const BUTTON_X = 2;
const BUTTON_Y = 3;
const BUTTON_LT = 6;
const BUTTON_RT = 7;
const BUTTON_START = 9;
const AXIS_LEFT_X = 0;
const AXIS_LEFT_Y = 1;
const AXIS_RIGHT_Y = 3;

const UI_BUTTONS: Readonly<Record<number, UiAction>> = Object.freeze({
  [BUTTON_B]: 'back',
  [BUTTON_X]: 'toggleCamera',
  [BUTTON_Y]: 'toggleMute',
  [BUTTON_START]: 'pause',
});

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function pressed(pad: Gamepad, index: number): boolean {
  return pad.buttons[index]?.pressed === true;
}

function value(pad: Gamepad, index: number): number {
  return pad.buttons[index]?.value ?? 0;
}

function axis(pad: Gamepad, index: number): number {
  const v = pad.axes[index] ?? 0;
  return Math.abs(v) < STICK_DEAD_ZONE ? 0 : v;
}

/** The seat a pad speaks for: local 2P by pad index, otherwise the (only) local seat. */
function seatOfPad(config: SimConfig, pad: Gamepad, seats: readonly PlayerId[]): PlayerId | null {
  if (config.mode === 'local') return pad.index === 0 || pad.index === 1 ? pad.index : null;
  return seats[0] ?? null;
}

function connectedPads(): Gamepad[] {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  const out: Gamepad[] = [];
  for (const pad of navigator.getGamepads()) if (pad !== null && pad.connected) out.push(pad);
  return out;
}

export function createGamepad(): DeviceAdapter {
  /** pad index -> button index -> was pressed last poll (for rising edges). */
  const wasPressed = new Map<number, boolean[]>();
  /** Raw power while a trigger / right stick ramps it; null re-seeds from the current aim. */
  let rawPower: number | null = null;

  const rose = (pad: Gamepad, index: number): boolean => {
    let prev = wasPressed.get(pad.index);
    if (prev === undefined) {
      prev = [];
      wasPressed.set(pad.index, prev);
    }
    const now = pressed(pad, index);
    const before = prev[index] === true;
    prev[index] = now;
    return now && !before;
  };

  const readAim = (pad: Gamepad, ctx: InputContext, currentAim: Aim, result: AdapterResult): void => {
    const x = axis(pad, AXIS_LEFT_X);
    const y = axis(pad, AXIS_LEFT_Y);
    const ramp = value(pad, BUTTON_RT) - value(pad, BUTTON_LT) - axis(pad, AXIS_RIGHT_Y);
    const stick = x !== 0 || y !== 0;
    if (!stick && ramp === 0) {
      rawPower = null;
      return;
    }
    result.active = true;
    const angle = stick ? clamp(Math.atan2(-Math.abs(y), x), AIM_ANGLE_MIN, AIM_ANGLE_MAX) : currentAim.angle;
    if (ramp === 0) rawPower = null;
    else {
      rawPower ??= currentAim.power;
      rawPower = clamp(rawPower + ramp * KEY_POWER_RATE * TRIGGER_POWER_FACTOR * ctx.dt, MIN_POWER, MAX_POWER);
    }
    result.aim = { angle, power: rawPower ?? currentAim.power };
  };

  return {
    attach() {},
    detach() {
      wasPressed.clear();
      rawPower = null;
    },
    poll(ctx, currentAim) {
      const result: AdapterResult = { ui: [], active: false };
      const { state } = ctx;
      for (const pad of connectedPads()) {
        for (const [button, action] of Object.entries(UI_BUTTONS)) {
          if (rose(pad, Number(button))) {
            result.ui.push(action);
            result.active = true;
          }
        }
        const seat = seatOfPad(state.config, pad, ctx.seats);
        const owns = seat !== null && canControl(state.config, seat, state.activePlayer);
        const shoot = rose(pad, BUTTON_A);
        if (!owns) continue;
        readAim(pad, ctx, currentAim, result);
        if (shoot) {
          result.shoot = true;
          result.active = true;
        }
      }
      return result;
    },
  };
}
