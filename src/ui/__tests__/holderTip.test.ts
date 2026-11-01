// OWNER: ui
// The holder tip names a plate only when a stall tap really keeps the partner's way open (BUILD_DECISIONS D2),
// and never while a ball waits in a device or for a plate that only drives traps or cannons (D10.10).
import { describe, expect, it } from 'vitest';
import { GOLDEN_LINES, goldenConfig, type GoldenLine } from '../../sim/__tests__/levels-golden';
import { LEVELS } from '../../sim/levels/index';
import { runReplay } from '../../sim/sim';
import { BALL_RADIUS } from '../../sim/types';
import type { Level, LevelRect, PlayerId, ReplayEntry, SimEvent } from '../../sim/types';
import { COPY, switchLabel } from '../copy';
import { UNKNOWN_SPOTS, advanceSpots, holderTipSwitch, spotsOf, teeSpots, type BallSpot, type Spots } from '../holderTip';

const RED: PlayerId = 0;
const BLUE: PlayerId = 1;

function hole(order: number): Level {
  const level = LEVELS.find((l) => l.order === order);
  if (level === undefined) throw new Error(`no hole ${order}`);
  return level;
}

/** Every golden line, whether the solver keys GOLDEN_LINES by position or by level id (each line keeps its `order`). */
function goldenLines(): GoldenLine[] {
  return Object.values(GOLDEN_LINES);
}

function driversOf(r: LevelRect): readonly string[] {
  return r.switchIds ?? (r.switchId === undefined ? [] : [r.switchId]);
}

function rect(level: Level, kind: LevelRect['kind'], driver: string): LevelRect {
  const found = level.rects.find((r) => r.kind === kind && driversOf(r).includes(driver));
  if (found === undefined) throw new Error(`no ${kind} driven by ${driver}`);
  return found;
}

/** A ball resting on plate `id`, `dx` px from the plate's centre. */
function onPlate(level: Level, id: string, dx = 0): BallSpot {
  const sw = level.switches.find((s) => s.id === id);
  if (sw === undefined) throw new Error(`no plate ${id}`);
  return { pos: { x: sw.x + sw.w / 2 + dx, y: sw.surfaceY - BALL_RADIUS }, sunk: false, waiting: false };
}

/** A ball resting at the bottom middle of device rect `id` (caught in a trap, loaded on a breech). */
function inDevice(level: Level, id: string): BallSpot {
  const r = level.rects.find((d) => d.id === id);
  if (r === undefined) throw new Error(`no device ${id}`);
  const floor = r.kind === 'cannon' ? r.y : r.y + r.h;
  return { pos: { x: r.x + r.w / 2, y: floor - BALL_RADIUS }, sunk: false, waiting: true };
}

const at = (x: number, y = 600): BallSpot => ({ pos: { x, y }, sunk: false, waiting: false });
const sunk: BallSpot = { pos: { x: 0, y: 0 }, sunk: true, waiting: false };
const spots = (red: BallSpot | null, blue: BallSpot | null): Spots => [red, blue];

/** Replays a log through the real sim and returns every tip the App would show (once per hole). */
function tipsAlong(levelId: string, log: readonly ReplayEntry[], untilTick: number): { tick: number; slot: PlayerId; plate: string }[] {
  const level = LEVELS.find((l) => l.id === levelId);
  if (level === undefined) throw new Error(`no level ${levelId}`);
  const { events } = runReplay(goldenConfig(levelId), log, untilTick);
  let now: Spots = UNKNOWN_SPOTS;
  let shown = false;
  const tips: { tick: number; slot: PlayerId; plate: string }[] = [];
  for (const e of events as SimEvent[]) {
    now = advanceSpots(now, e);
    if (e.type !== 'turnStart' || shown) continue;
    const plate = holderTipSwitch(level, now, e.playerId);
    if (plate !== null) {
      tips.push({ tick: e.tick, slot: e.playerId, plate });
      shown = true;
    }
  }
  return tips;
}

describe('holder tip', () => {
  const twoDoors = hole(2);
  const colourKeys = hole(3);
  const plateAndBridge = hole(4);

  it('Two Doors: the DOOR holder gets the tip while the partner is still in front of the door', () => {
    const door = rect(twoDoors, 'blocker', 'door');
    expect(holderTipSwitch(twoDoors, spots(onPlate(twoDoors, 'door'), teeSpots(twoDoors)[BLUE]), RED)).toBe('door');
    expect(holderTipSwitch(twoDoors, spots(onPlate(twoDoors, 'door'), at(door.x - 20)), RED)).toBe('door');
    // Inside the doorway but short of its middle: a closing door pushes the ball back.
    expect(holderTipSwitch(twoDoors, spots(onPlate(twoDoors, 'door'), at(door.x + 5)), RED)).toBe('door');
  });

  it('Two Doors: no tip once the partner is through, past the doorway middle, or sunk', () => {
    const door = rect(twoDoors, 'blocker', 'door');
    expect(holderTipSwitch(twoDoors, spots(onPlate(twoDoors, 'door'), onPlate(twoDoors, 'window')), RED)).toBeNull();
    expect(holderTipSwitch(twoDoors, spots(onPlate(twoDoors, 'door'), at(door.x + door.w - 5)), RED)).toBeNull();
    expect(holderTipSwitch(twoDoors, spots(onPlate(twoDoors, 'door'), sunk), RED)).toBeNull();
  });

  it('no tip when the partner rests on the same plate (it keeps the door open)', () => {
    expect(holderTipSwitch(twoDoors, spots(onPlate(twoDoors, 'door', -20), onPlate(twoDoors, 'door', 20)), RED)).toBeNull();
    expect(holderTipSwitch(plateAndBridge, spots(onPlate(plateAndBridge, 'near', -10), onPlate(plateAndBridge, 'near', 10)), RED)).toBeNull();
  });

  it('no tip unless the holder itself rests on the plate, and never with an unknown spot', () => {
    expect(holderTipSwitch(twoDoors, spots(at(300), teeSpots(twoDoors)[BLUE]), RED)).toBeNull();
    expect(holderTipSwitch(twoDoors, spots(null, teeSpots(twoDoors)[BLUE]), RED)).toBeNull();
    expect(holderTipSwitch(twoDoors, spots(onPlate(twoDoors, 'door'), null), RED)).toBeNull();
  });

  it('the cup-wired plate never gets the tip (sinking holds it too)', () => {
    expect(twoDoors.cupHoldsSwitch).toBe('window');
    expect(holderTipSwitch(twoDoors, spots(onPlate(twoDoors, 'door'), onPlate(twoDoors, 'window')), BLUE)).toBeNull();
    expect(colourKeys.cupHoldsSwitch).toBe('door2');
    const door2 = rect(colourKeys, 'blocker', 'door2');
    expect(holderTipSwitch(colourKeys, spots(onPlate(colourKeys, 'door2'), at(door2.x - 30)), RED)).toBeNull();
  });

  it('Colour Keys: DOOR 1 holder gets the tip while red is behind wall 1', () => {
    const door1 = rect(colourKeys, 'blocker', 'door1');
    expect(holderTipSwitch(colourKeys, spots(teeSpots(colourKeys)[RED], onPlate(colourKeys, 'door1')), BLUE)).toBe('door1');
    expect(holderTipSwitch(colourKeys, spots(at(door1.x + door1.w + 200), onPlate(colourKeys, 'door1')), BLUE)).toBeNull();
  });

  it('Colour Keys: blue needs no DOOR 1 with room to lob through its own field, but does against the wall', () => {
    const door1 = rect(colourKeys, 'blocker', 'door1');
    const red = onPlate(colourKeys, 'door1');
    expect(holderTipSwitch(colourKeys, spots(red, at(door1.x - 150)), RED)).toBeNull();
    // Pressed against the wall face or in the doorway's near half: no lob gets through, so red should stay.
    expect(holderTipSwitch(colourKeys, spots(red, at(door1.x - 5)), RED)).toBe('door1');
    expect(holderTipSwitch(colourKeys, spots(red, at(door1.x + 10)), RED)).toBe('door1');
  });

  it('Plate & Bridge: plate A matters only while nothing else holds the bridge and blue has not reached it', () => {
    const bridge = rect(plateAndBridge, 'bridge', 'near');
    const holder = onPlate(plateAndBridge, 'near');
    expect(holderTipSwitch(plateAndBridge, spots(holder, teeSpots(plateAndBridge)[BLUE]), RED)).toBe('near');
    // Blue parked on the deck or on plate B holds the bridge itself, so red may cross.
    expect(holderTipSwitch(plateAndBridge, spots(holder, onPlate(plateAndBridge, 'deck')), RED)).toBeNull();
    expect(holderTipSwitch(plateAndBridge, spots(holder, onPlate(plateAndBridge, 'far')), RED)).toBeNull();
    // Blue on the planks outside the deck strip falls whatever red does, so a tap would only waste a stroke.
    expect(holderTipSwitch(plateAndBridge, spots(holder, at(bridge.x + 10, bridge.y - BALL_RADIUS)), RED)).toBeNull();
  });

  it('a deck plate is never named (a tap releases it and drops the bridge under the tapper)', () => {
    expect(holderTipSwitch(plateAndBridge, spots(teeSpots(plateAndBridge)[RED], onPlate(plateAndBridge, 'deck')), BLUE)).toBeNull();
    expect(holderTipSwitch(plateAndBridge, spots(onPlate(plateAndBridge, 'deck', 180), onPlate(plateAndBridge, 'deck', -180)), BLUE)).toBeNull();
  });

  it('advanceSpots follows the events: tees, rests, falls and sinks', () => {
    const lv = plateAndBridge;
    let s: Spots = UNKNOWN_SPOTS;
    s = advanceSpots(s, { type: 'levelStart', levelId: lv.id, levelIndex: 0, firstPlayer: 0, restarted: false, tick: 1 });
    expect(s).toEqual(teeSpots(lv));
    s = advanceSpots(s, { type: 'ballRest', playerId: BLUE, pos: { x: 900, y: 609 }, onPermanentGround: false, tick: 2 });
    expect(s[BLUE]).toEqual({ pos: { x: 900, y: 609 }, sunk: false, waiting: false });
    s = advanceSpots(s, { type: 'fellOffWorld', playerId: RED, pos: { x: 700, y: 900 }, respawnPos: { x: 250, y: 618 }, strokes: 2, tick: 3 });
    expect(s[RED]).toEqual({ pos: { x: 250, y: 618 }, sunk: false, waiting: false });
    s = advanceSpots(s, { type: 'sink', playerId: BLUE, pos: { x: 1860, y: 594 }, strokes: 3, speed: 10, tick: 4 });
    expect(s[BLUE]?.sunk).toBe(true);
    expect(advanceSpots(s, { type: 'turnStart', playerId: RED, readyInTicks: 0, sameAsBefore: false, tick: 5 })).toBe(s);
  });

  it('advanceSpots follows the devices: caught / loaded after the rest or teleport they belong to, freed, fired, sent back (D10.4)', () => {
    const lv = hole(6);
    const caughtAt = { x: 400, y: 628 };
    let s: Spots = teeSpots(lv);
    s = advanceSpots(s, { type: 'ballRest', playerId: RED, pos: caughtAt, onPermanentGround: true, tick: 2 });
    s = advanceSpots(s, { type: 'trapCaught', playerId: RED, pos: caughtAt, rectId: 'snare', tick: 2 });
    expect(s[RED]).toEqual({ pos: caughtAt, sunk: false, waiting: true });
    // The trap re-arms around a resting ball (its release let go) and opens again (a release is held).
    s = advanceSpots(s, { type: 'trapFreed', playerId: RED, pos: caughtAt, rectId: 'snare', tick: 3 });
    expect(s[RED]?.waiting).toBe(false);
    s = advanceSpots(s, { type: 'trapCaught', playerId: RED, pos: caughtAt, rectId: 'snare', tick: 4 });
    expect(s[RED]?.waiting).toBe(true);
    // The scoped reset (BACK +1) and the flight watchdog teleport a ball to its safe spot, free.
    s = advanceSpots(s, { type: 'trapReturn', playerId: RED, pos: caughtAt, respawnPos: { x: 540, y: 628 }, strokes: 3, toTee: false, tick: 5 });
    expect(s[RED]).toEqual({ pos: { x: 540, y: 628 }, sunk: false, waiting: false });
    s = advanceSpots(s, { type: 'flightTimeout', playerId: BLUE, pos: { x: 900, y: 100 }, respawnPos: { x: 590, y: 628 }, tick: 6 });
    expect(s[BLUE]).toEqual({ pos: { x: 590, y: 628 }, sunk: false, waiting: false });
    // A respawn into armed jaws is followed by its trapCaught in the same tick.
    s = advanceSpots(s, { type: 'fellOffWorld', playerId: BLUE, pos: { x: 900, y: 900 }, respawnPos: caughtAt, strokes: 2, tick: 7 });
    expect(s[BLUE]?.waiting).toBe(false);
    s = advanceSpots(s, { type: 'trapCaught', playerId: BLUE, pos: caughtAt, rectId: 'snare', tick: 7 });
    expect(s[BLUE]?.waiting).toBe(true);
    // A cannon: loaded after its rest on a cold breech, free again the tick it fires.
    const breech = { x: 910, y: 553 };
    s = advanceSpots(s, { type: 'ballRest', playerId: RED, pos: breech, onPermanentGround: false, tick: 8 });
    s = advanceSpots(s, { type: 'cannonLoad', playerId: RED, pos: breech, rectId: 'cannon', tick: 8 });
    expect(s[RED]).toEqual({ pos: breech, sunk: false, waiting: true });
    s = advanceSpots(s, { type: 'cannonFire', playerId: RED, pos: breech, rectId: 'cannon', launch: { x: 400, y: -700 }, tick: 9 });
    expect(s[RED]).toEqual({ pos: breech, sunk: false, waiting: false });
  });

  it('spotsOf reads a known state (local mounts, shared links), devices included', () => {
    const { state } = runReplay(goldenConfig(plateAndBridge.id), [], 1);
    expect(spotsOf(plateAndBridge, state)).toEqual([
      { pos: state.balls[0].pos, sunk: false, waiting: false },
      { pos: state.balls[1].pos, sunk: false, waiting: false },
    ]);
    // A resumed Booby Trap state with red resting in the armed snare (no release held) reads it as waiting.
    const boobyTrap = hole(6);
    const tee = runReplay(goldenConfig(boobyTrap.id), [], 1).state;
    const caught = inDevice(boobyTrap, 'snare');
    const red = { ...tee.balls[0], pos: caught.pos, asleep: true };
    expect(spotsOf(boobyTrap, { switches: tee.switches, balls: [red, tee.balls[1]] })).toEqual([caught, { pos: tee.balls[1].pos, sunk: false, waiting: false }]);
  });

  it('the golden intended lines never show the tip (no stall tap is needed on them)', () => {
    for (const line of goldenLines()) {
      const level = hole(line.order);
      expect(tipsAlong(level.id, line.log, line.finalTick), line.name).toEqual([]);
    }
  });

  it('a crosser that falls short gets the holder the tip on the next turn', () => {
    const twoDoorsLine = goldenLines().find((l) => l.order === 2);
    const bridgeLine = goldenLines().find((l) => l.order === 4);
    if (twoDoorsLine === undefined || bridgeLine === undefined) throw new Error('missing golden lines');
    // Keep red's opening shot onto the plate; blue's first shot is too weak to reach the door or the bridge.
    const weakBlue = (line: typeof twoDoorsLine): ReplayEntry[] => {
      const blueAim = line.log.findIndex((e) => e.cmd.type === 'setAim' && e.cmd.playerId === BLUE);
      const tick = line.log[blueAim]?.tick ?? 0;
      return [
        ...line.log.slice(0, blueAim),
        { tick, cmd: { type: 'setAim', playerId: BLUE, angle: -0.1262, power: 15 } },
        { tick, cmd: { type: 'shoot', playerId: BLUE } },
      ];
    };
    const twoDoorsTips = tipsAlong(twoDoors.id, weakBlue(twoDoorsLine), 1200);
    expect(twoDoorsTips).toEqual([expect.objectContaining({ slot: RED, plate: 'door' })]);
    const bridgeTips = tipsAlong(plateAndBridge.id, weakBlue(bridgeLine), 1200);
    expect(bridgeTips).toEqual([expect.objectContaining({ slot: RED, plate: 'near' })]);
  });

  it('copy: "plate A" for a one-letter label, "the DOOR plate" otherwise, an unlabelled switch as is', () => {
    expect(COPY.toast.holderTip(switchLabel(plateAndBridge, 'near'), BLUE)).toBe('Stay on plate A for Blue — tap straight up at low power');
    expect(COPY.toast.holderTip(switchLabel(twoDoors, 'door'), BLUE)).toBe('Stay on the DOOR plate for Blue — tap straight up at low power');
    expect(COPY.toast.holderTip(switchLabel(colourKeys, 'door1'), RED)).toBe('Stay on the DOOR 1 plate for Red — tap straight up at low power');
    expect(COPY.toast.holderTip('SWITCH B', BLUE)).toBe('Stay on SWITCH B for Blue — tap straight up at low power');
  });

  it('every tippable plate opens a door or raises a bridge, and every other plate consumer is a device (the rule assumes it; a new level must not break it silently)', () => {
    for (const level of LEVELS) {
      for (const sw of level.switches) {
        if (sw.id === level.cupHoldsSwitch || sw.onRectId !== undefined) continue;
        for (const r of level.rects) {
          if (!driversOf(r).includes(sw.id)) continue;
          const opensDoor = r.kind === 'blocker' && r.activeWhen !== true;
          const raisesBridge = r.kind === 'bridge' && r.activeWhen !== false;
          const device = r.kind === 'trap' || r.kind === 'cannon';
          expect(opensDoor || raisesBridge || device, `${level.id}: ${r.id} driven by ${sw.id}`).toBe(true);
        }
      }
    }
  });

  it('a plate whose only consumers are traps or cannons is never named, wherever the partner stands (D10.10)', () => {
    let deviceOnly = 0;
    for (const level of LEVELS) {
      for (const sw of level.switches) {
        const consumers = level.rects.filter((r) => driversOf(r).includes(sw.id));
        if (consumers.length === 0 || !consumers.every((r) => r.kind === 'trap' || r.kind === 'cannon')) continue;
        deviceOnly += 1;
        for (const holder of [RED, BLUE] as const) {
          const partner: PlayerId = holder === RED ? BLUE : RED;
          for (const x of [level.starts[partner].x, level.hole.x - 200, 40]) {
            const s: [BallSpot, BallSpot] = [at(x), at(x)];
            s[holder] = onPlate(level, sw.id);
            expect(holderTipSwitch(level, s, holder), `${level.id}: ${sw.id}`).toBeNull();
          }
        }
      }
    }
    // FREE (6), both FIRE plates (7), FIRE (11), FIRE (12).
    expect(deviceOnly).toBe(5);
  });

  it('no tip while either ball waits in a device: Booby Trap PERCH holder with the partner caught (D10.10)', () => {
    const boobyTrap = hole(6);
    const perch = onPlate(boobyTrap, 'perch');
    // Free partner short of the door: the PERCH holds it, so the stall tap is the right move...
    expect(holderTipSwitch(boobyTrap, spots(perch, teeSpots(boobyTrap)[BLUE]), RED)).toBe('perch');
    // ...but a caught partner is freed by FREE, never by a stall tap, and its turns come to the holder anyway.
    expect(holderTipSwitch(boobyTrap, spots(perch, inDevice(boobyTrap, 'snare')), RED)).toBeNull();
    // The waiting ball itself never gets the tip either (L9 BAIT seat: caught on the plate that holds the door).
    const bait = hole(9);
    expect(holderTipSwitch(bait, spots({ ...onPlate(bait, 'bait'), waiting: true }, teeSpots(bait)[BLUE]), RED)).toBeNull();
    expect(holderTipSwitch(bait, spots(onPlate(bait, 'bait'), teeSpots(bait)[BLUE]), RED)).toBe('bait');
  });

  it('a loaded partner suppresses the tip: Sky Bridge plate A holder with blue in the cold cannon', () => {
    const skyBridge = hole(10);
    const a = onPlate(skyBridge, 'a');
    expect(holderTipSwitch(skyBridge, spots(a, inDevice(skyBridge, 'cannon')), RED)).toBeNull();
    // Plate A also raises the bridge: a free partner who still has to cross is told to keep it up.
    expect(holderTipSwitch(skyBridge, spots(a, teeSpots(skyBridge)[BLUE]), RED)).toBe('a');
  });

  it('the World 1 stall tap stays where no device is involved: Spring Step DOOR and Colour Lift WINDOW holders', () => {
    const springStep = hole(5);
    expect(holderTipSwitch(springStep, spots(onPlate(springStep, 'door'), teeSpots(springStep)[BLUE]), RED)).toBe('door');
    // Partner up on TOP holds the same door, so the holder may go.
    expect(holderTipSwitch(springStep, spots(onPlate(springStep, 'door'), onPlate(springStep, 'top')), RED)).toBeNull();
    const colourLift = hole(8);
    expect(holderTipSwitch(colourLift, spots(teeSpots(colourLift)[RED], onPlate(colourLift, 'window')), BLUE)).toBe('window');
    // Red through the window and up on DOOR: the window is behind red now.
    expect(holderTipSwitch(colourLift, spots(onPlate(colourLift, 'door'), onPlate(colourLift, 'window')), BLUE)).toBeNull();
  });
});
