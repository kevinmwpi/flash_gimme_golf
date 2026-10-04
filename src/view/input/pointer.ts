// OWNER: input-loop
/**
 * Pointer adapter (ARCH.md §7; UX.md §5.2; constants DRAG_* in sim/types.ts per D1). Pointer Events
 * unify mouse, touch and pen into one drag-to-aim slingshot:
 * - a press within DRAG_GRAB_RADIUS_PX (DRAG_GRAB_RADIUS_TOUCH_PX on touch) of the active ball's
 *   screen position starts a drag when a local seat is aiming, and nowhere else (UX.md §5.2: stray
 *   taps and swipes never cost a stroke); the canvas captures the pointer so the drag survives
 *   leaving the canvas;
 * - d = press - current (pull back, shoot forward); angle = clamp(atan2(d.y, d.x));
 *   power = MIN + |d| / fullPx * (MAX - MIN) where fullPx is DRAG_FULL_POWER_PX (120 px => 55)
 *   unless the stage edge lies closer than that along the pull: then the pull reads full power
 *   DRAG_EDGE_MARGIN_PX before the edge (never shorter than DRAG_MIN_FULL_POWER_PX), so a steep lob
 *   from a ball resting low on the stage is still reachable with the pointer inside the stage
 *   (UX.md §4.6 "downward pull room"); below DRAG_DEAD_ZONE_PX nothing is emitted (armed);
 * - release inside DRAG_CANCEL_RADIUS_PX of the press cancels (a tap, under 8 px / 250 ms, always
 *   ends inside that ring, so a tap never shoots); release outside => final aim + shoot in one frame;
 * - pointercancel, a second touch point, the secondary button, window blur or leaving the aiming
 *   phase cancel without a shot. EVERY cancel re-emits the aim held when the grab started, so the
 *   half-pulled values the drag passed through never stick (UX.md §5.2 "previous aim kept");
 * - a press that grabs nothing is reported as a `miss` ('miss' off the ball, 'wrongBall' on the
 *   partner's ball, 'notYourTurn' while another seat aims) so the view can answer it (UX.md §5.2).
 * Events record client coordinates; the poll maps them to logical 1280x720 px with ctx.canvasRect,
 * so the geometry test always uses the frame's camera and canvas box.
 */
import { canControl } from '../../sim/sim';
import type { Aim, PlayerId, SimState, Vec } from '../../sim/types';
import {
  AIM_ANGLE_MAX,
  AIM_ANGLE_MIN,
  DRAG_CANCEL_RADIUS_PX,
  DRAG_DEAD_ZONE_PX,
  DRAG_FULL_POWER_PX,
  DRAG_GRAB_RADIUS_PX,
  DRAG_GRAB_RADIUS_TOUCH_PX,
  MAX_POWER,
  MIN_POWER,
  VIEWPORT_H,
  VIEWPORT_W,
} from '../../sim/types';
import type { InputDevice } from '../view';
import { worldToScreen } from '../view';
import type { AdapterResult, DeviceAdapter, InputContext, MissKind } from './index';

/** The pull length that reads full power never shrinks below this, however little stage room there is. */
export const DRAG_MIN_FULL_POWER_PX = 80;
/** Logical px kept between a full-power pull and the stage edge (pointer events stop about a CSS px short of it). */
export const DRAG_EDGE_MARGIN_PX = 6;
/** PointerEvent.buttons bit of the secondary (right) mouse button / pen barrel button. */
const SECONDARY_BUTTON_MASK = 2;

type Press = {
  pointerId: number;
  device: InputDevice;
  downClient: Vec;
  client: Vec;
  /** null until the first poll decides whether the press grabbed the ball. */
  grabbed: boolean | null;
  /** The aim held when the grab was decided; re-emitted on every cancel path. */
  aimAtGrab: Aim | null;
  released: boolean;
};

function toLogical(client: Vec, rect: DOMRect): Vec {
  const scale = rect.width > 0 ? VIEWPORT_W / rect.width : 1;
  return { x: (client.x - rect.left) * scale, y: (client.y - rect.top) * scale };
}

function dist(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Only the active player's seat may drag, and only while the sim is in `aiming`. */
function localSeatAiming(state: SimState, seats: readonly PlayerId[]): boolean {
  if (state.phase !== 'aiming') return false;
  return seats.some((seat) => canControl(state.config, seat, state.activePlayer));
}

/** atan2 of a pull vector; pulls that would aim downward clamp to the nearer horizontal bound. */
export function pullAngle(d: Vec): number {
  const a = Math.atan2(d.y, d.x);
  if (a > 0) return a > Math.PI / 2 ? AIM_ANGLE_MIN : AIM_ANGLE_MAX;
  return Math.min(AIM_ANGLE_MAX, Math.max(AIM_ANGLE_MIN, a));
}

/** Distance (logical px) from `from` to the stage edge along the unit direction `dir`. */
export function stageRoom(from: Vec, dir: Vec): number {
  let room = Infinity;
  if (dir.x > 0) room = Math.min(room, (VIEWPORT_W - from.x) / dir.x);
  else if (dir.x < 0) room = Math.min(room, -from.x / dir.x);
  if (dir.y > 0) room = Math.min(room, (VIEWPORT_H - from.y) / dir.y);
  else if (dir.y < 0) room = Math.min(room, -from.y / dir.y);
  return Math.max(0, room);
}

/** The pull length that reads full power given the stage room along the pull. */
export function fullPowerPx(room: number): number {
  return Math.min(DRAG_FULL_POWER_PX, Math.max(DRAG_MIN_FULL_POWER_PX, room - DRAG_EDGE_MARGIN_PX));
}

export function pullPower(length: number, fullPx: number = DRAG_FULL_POWER_PX): number {
  return Math.min(MAX_POWER, Math.max(MIN_POWER, MIN_POWER + (length / fullPx) * (MAX_POWER - MIN_POWER)));
}

/** Pointer direction (opposite to the shot) and the pull length that reads full power from `down`. */
function fullPowerPxFor(down: Vec, now: Vec, length: number): number {
  if (length <= 0) return DRAG_FULL_POWER_PX;
  return fullPowerPx(stageRoom(down, { x: (now.x - down.x) / length, y: (now.y - down.y) / length }));
}

/**
 * Whether a pointer pull starting at `press` (logical px, inside the stage) can produce `aim` without
 * leaving the stage: the pointer moves opposite to the shot and must stop DRAG_EDGE_MARGIN_PX short
 * of the edge. The level-validity test runs every scripted line through this.
 */
export function pullReachable(press: Vec, aim: Aim): boolean {
  const dir = { x: -Math.cos(aim.angle), y: -Math.sin(aim.angle) };
  const room = stageRoom(press, dir);
  const needed = ((aim.power - MIN_POWER) / (MAX_POWER - MIN_POWER)) * fullPowerPx(room);
  return needed <= room - DRAG_EDGE_MARGIN_PX;
}

function deviceOf(e: PointerEvent): InputDevice {
  return e.pointerType === 'touch' ? 'touch' : 'pointer';
}

type Grab = { grabbed: boolean; miss: MissKind | null };

export function createPointer(): DeviceAdapter {
  let canvas: HTMLCanvasElement | null = null;
  let press: Press | null = null;
  let hover: Vec | null = null;
  let touched = false;
  let cursor = '';
  /** Aim to restore on the next poll after an event-driven cancel (second pointer, pointercancel, blur). */
  let restoreAim: Aim | null = null;

  const releaseCapture = (): void => {
    if (canvas !== null && press !== null && canvas.hasPointerCapture(press.pointerId)) canvas.releasePointerCapture(press.pointerId);
  };

  const cancel = (): void => {
    releaseCapture();
    if (press?.grabbed === true) restoreAim = press.aimAtGrab;
    press = null;
  };

  /** Cancels a press that is still held; a released press already carries its shot to the next poll. */
  const cancelLive = (): void => {
    if (press !== null && !press.released) {
      cancel();
      touched = true;
    }
  };

  const onDown = (e: PointerEvent): void => {
    if (canvas === null) return;
    canvas.focus({ preventScroll: true });
    touched = true;
    if (press !== null) {
      // A second finger or the secondary button while dragging cancels the shot.
      cancel();
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    press = {
      pointerId: e.pointerId,
      device: deviceOf(e),
      downClient: { x: e.clientX, y: e.clientY },
      client: { x: e.clientX, y: e.clientY },
      grabbed: null,
      aimAtGrab: null,
      released: false,
    };
  };

  const onMove = (e: PointerEvent): void => {
    hover = { x: e.clientX, y: e.clientY };
    if (press === null || press.pointerId !== e.pointerId || press.released) return;
    if ((e.buttons & SECONDARY_BUTTON_MASK) !== 0) {
      // A chorded secondary press (right button while the primary is held) arrives as a pointermove.
      cancelLive();
      return;
    }
    press.client = hover;
    if (press.grabbed === true) touched = true;
  };

  const onUp = (e: PointerEvent): void => {
    if (press === null || press.pointerId !== e.pointerId) return;
    press.client = { x: e.clientX, y: e.clientY };
    press.released = true;
    touched = true;
    releaseCapture();
  };

  const onCancel = (e: PointerEvent): void => {
    if (press !== null && press.pointerId === e.pointerId) cancel();
  };

  const onContextMenu = (e: Event): void => {
    e.preventDefault();
    cancelLive();
  };
  const onBlur = (): void => cancel();

  const setCursor = (value: string): void => {
    if (canvas === null || cursor === value) return;
    cursor = value;
    canvas.style.cursor = value;
  };

  /** Decides a fresh press: a grab within the device's radius of the active ball, else what it missed. */
  const decideGrab = (p: Press, ctx: InputContext): Grab => {
    const { state } = ctx;
    if (state.phase !== 'aiming') return { grabbed: false, miss: null };
    if (!localSeatAiming(state, ctx.seats)) return { grabbed: false, miss: ctx.seats.length > 0 ? 'notYourTurn' : null };
    const down = toLogical(p.downClient, ctx.canvasRect);
    const radius = p.device === 'touch' ? DRAG_GRAB_RADIUS_TOUCH_PX : DRAG_GRAB_RADIUS_PX;
    const ball = worldToScreen(ctx.view, state.balls[state.activePlayer].pos);
    if (dist(down, ball) <= radius) return { grabbed: true, miss: null };
    const other = state.activePlayer === 0 ? 1 : 0;
    const otherBall = state.balls[other];
    const onOther = !otherBall.sunk && dist(down, worldToScreen(ctx.view, otherBall.pos)) <= radius;
    return { grabbed: false, miss: onOther ? 'wrongBall' : 'miss' };
  };

  const hoverCursor = (ctx: InputContext): void => {
    if (press?.grabbed === true) {
      setCursor('grabbing');
      return;
    }
    if (hover === null || !localSeatAiming(ctx.state, ctx.seats)) {
      setCursor('');
      return;
    }
    const ball = worldToScreen(ctx.view, ctx.state.balls[ctx.state.activePlayer].pos);
    setCursor(dist(toLogical(hover, ctx.canvasRect), ball) <= DRAG_GRAB_RADIUS_PX ? 'grab' : '');
  };

  /** The live or releasing grab: band + aim while held, final aim + shoot (or the restored aim) on release. */
  const pollGrab = (p: Press, ctx: InputContext, result: AdapterResult): void => {
    const down = toLogical(p.downClient, ctx.canvasRect);
    const now = toLogical(p.client, ctx.canvasRect);
    const length = dist(down, now);
    const pull: Vec = { x: down.x - now.x, y: down.y - now.y };
    const aim: Aim = { angle: pullAngle(pull), power: pullPower(length, fullPowerPxFor(down, now, length)) };
    if (!p.released) {
      // A pull whose raw angle points downward (y-down: atan2 > 0) is snapped by pullAngle => AIM UPWARD.
      result.drag = { pointer: now, cancel: length < DRAG_CANCEL_RADIUS_PX, clamped: Math.atan2(pull.y, pull.x) > 0 };
      if (length >= DRAG_DEAD_ZONE_PX) result.aim = aim;
      return;
    }
    if (length >= DRAG_CANCEL_RADIUS_PX) {
      result.aim = aim;
      result.shoot = true;
    } else if (p.aimAtGrab !== null) result.aim = p.aimAtGrab;
    press = null;
  };

  return {
    attach(target) {
      canvas = target;
      const s = canvas.style;
      s.touchAction = 'none';
      s.userSelect = 'none';
      s.setProperty('-webkit-user-select', 'none');
      s.setProperty('-webkit-touch-callout', 'none');
      s.setProperty('-webkit-tap-highlight-color', 'transparent');
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onCancel);
      canvas.addEventListener('contextmenu', onContextMenu);
      window.addEventListener('blur', onBlur);
    },
    detach() {
      if (canvas !== null) {
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onCancel);
        canvas.removeEventListener('contextmenu', onContextMenu);
      }
      window.removeEventListener('blur', onBlur);
      cancel();
      restoreAim = null;
      hover = null;
      canvas = null;
    },
    poll(ctx, currentAim) {
      // A live grab is input every frame (the band must follow a pointer that is held still).
      const result: AdapterResult = { ui: [], active: touched || press?.grabbed === true || restoreAim !== null };
      touched = false;
      if (restoreAim !== null) {
        result.aim = restoreAim;
        restoreAim = null;
      }
      if (press !== null) {
        result.device = press.device;
        if (press.grabbed === null) {
          const grab = decideGrab(press, ctx);
          press.grabbed = grab.grabbed;
          if (grab.grabbed) press.aimAtGrab = currentAim;
          if (grab.miss !== null) result.miss = grab.miss;
        }
        if (press.grabbed && ctx.state.phase !== 'aiming') {
          cancel();
          if (restoreAim !== null) result.aim = restoreAim;
          restoreAim = null;
        }
      }
      if (press !== null && !press.grabbed) {
        if (press.released) press = null;
      } else if (press !== null) pollGrab(press, ctx, result);
      hoverCursor(ctx);
      return result;
    },
  };
}
