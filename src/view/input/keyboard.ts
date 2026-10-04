// OWNER: input-loop
/**
 * Keyboard adapter (ARCH.md §7; UX.md §5.1): keys by `event.code` (layout independent).
 * ArrowLeft/KeyA and ArrowRight/KeyD integrate the angle at KEY_ANGLE_RATE (x FAST_SWEEP_FACTOR
 * after FAST_SWEEP_AFTER_MS held), ArrowUp/KeyW and ArrowDown/KeyS the power at KEY_POWER_RATE;
 * the raw float is kept here while a key is held and re-seeded from the current aim when none is.
 * Space/Enter shoot on keydown (not repeat); Escape pause; KeyC camera; KeyM mute. Tab is never
 * consumed: it moves focus natively from the canvas to the HUD buttons and back (UX.md §6 tab order;
 * a captured Tab was a keyboard trap). `preventDefault` only when the stage (body / canvas) has
 * focus so overlay buttons keep their native key handling. Held keys are cleared on blur /
 * visibilitychange; Ctrl/Meta/Alt combos and text fields are ignored.
 */
import type { Aim } from '../../sim/types';
import { AIM_ANGLE_MAX, AIM_ANGLE_MIN, KEY_ANGLE_RATE, KEY_POWER_RATE, MAX_POWER, MIN_POWER } from '../../sim/types';
import type { AdapterResult, DeviceAdapter, InputContext, UiAction } from './index';

/** Holding an aim key longer than this multiplies its rate (fast sweep). */
export const FAST_SWEEP_AFTER_MS = 600;
export const FAST_SWEEP_FACTOR = 1.6;

type AimKey = 'left' | 'right' | 'up' | 'down';

const AIM_KEYS: Readonly<Record<string, AimKey>> = Object.freeze({
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
});

const SHOOT_CODES: ReadonlySet<string> = new Set(['Space', 'Enter', 'NumpadEnter']);
const UI_CODES: Readonly<Record<string, UiAction>> = Object.freeze({ Escape: 'pause', KeyC: 'toggleCamera', KeyM: 'toggleMute' });
const TEXT_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isTextTarget(el: Element | null): boolean {
  return el !== null && (TEXT_TAGS.has(el.tagName) || (el as HTMLElement).isContentEditable);
}

/** The stage owns the key when nothing else is focused (body/html/canvas). */
function stageFocused(el: Element | null, canvas: HTMLCanvasElement | null): boolean {
  return el === null || el === document.body || el === document.documentElement || el === canvas;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function createKeyboard(): DeviceAdapter {
  let canvas: HTMLCanvasElement | null = null;
  /** key code -> keydown time (ms). */
  const held = new Map<string, number>();
  let shootPressed = false;
  let touched = false;
  let ui: UiAction[] = [];
  /** Raw (unquantised) aim while any aim key is held; null re-seeds from the current aim. */
  let raw: { angle: number; power: number } | null = null;

  const clearHeld = (): void => {
    held.clear();
    raw = null;
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const active = document.activeElement;
    if (isTextTarget(active)) return;
    const onStage = stageFocused(active, canvas);
    const aimKey = AIM_KEYS[e.code];
    if (aimKey !== undefined) {
      if (onStage) e.preventDefault();
      if (!held.has(e.code)) held.set(e.code, performance.now());
      touched = true;
      return;
    }
    if (SHOOT_CODES.has(e.code)) {
      if (!onStage) return;
      e.preventDefault();
      if (!e.repeat) shootPressed = true;
      touched = true;
      return;
    }
    const action = UI_CODES[e.code];
    if (action === undefined || e.repeat) return;
    if (onStage) e.preventDefault();
    ui.push(action);
    touched = true;
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    held.delete(e.code);
  };

  const onBlur = (): void => clearHeld();
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') clearHeld();
  };

  const direction = (key: AimKey, now: number): number => {
    let sum = 0;
    for (const [code, since] of held) {
      if (AIM_KEYS[code] !== key) continue;
      sum += now - since >= FAST_SWEEP_AFTER_MS ? FAST_SWEEP_FACTOR : 1;
    }
    return sum;
  };

  const integrate = (ctx: InputContext, currentAim: Aim): Aim | undefined => {
    if (held.size === 0) {
      raw = null;
      return undefined;
    }
    raw ??= { angle: currentAim.angle, power: currentAim.power };
    const now = ctx.nowMs;
    // Angles are radians with 0 = right and -PI = left, so "aim more left" DEcreases the angle.
    const angleDir = direction('right', now) - direction('left', now);
    const powerDir = direction('up', now) - direction('down', now);
    raw.angle = clamp(raw.angle + angleDir * KEY_ANGLE_RATE * ctx.dt, AIM_ANGLE_MIN, AIM_ANGLE_MAX);
    raw.power = clamp(raw.power + powerDir * KEY_POWER_RATE * ctx.dt, MIN_POWER, MAX_POWER);
    return { angle: raw.angle, power: raw.power };
  };

  return {
    attach(target) {
      canvas = target;
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      document.addEventListener('visibilitychange', onVisibility);
    },
    detach() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      clearHeld();
      shootPressed = false;
      ui = [];
      canvas = null;
    },
    poll(ctx, currentAim) {
      const result: AdapterResult = { ui, active: touched || held.size > 0 };
      const aim = integrate(ctx, currentAim);
      if (aim !== undefined) result.aim = aim;
      if (shootPressed) result.shoot = true;
      shootPressed = false;
      touched = false;
      ui = [];
      return result;
    },
  };
}
