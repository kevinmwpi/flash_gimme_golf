// OWNER: ui
// The holder tip names a plate only when a stall tap really keeps the partner's way open (BUILD_DECISIONS D2).
import { describe, expect, it } from 'vitest';
import { GOLDEN_LINES, goldenConfig } from '../../sim/__tests__/levels-golden';
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

function rect(level: Level, kind: LevelRect['kind'], driver: string): LevelRect {
  const found = level.rects.find((r) => r.kind === kind && (r.switchId === driver || (r.switchIds ?? []).includes(driver)));
  if (found === undefined) throw new Error(`no ${kind} driven by ${driver}`);
  return found;
}

/** A ball resting on plate `id`, `dx` px from the plate's centre. */
function onPlate(level: Level, id: string, dx = 0): BallSpot {
  const sw = level.switches.find((s) => s.id === id);
  if (sw === undefined) throw new Error(`no plate ${id}`);
  return { pos: { x: sw.x + sw.w / 2 + dx, y: sw.surfaceY - BALL_RADIUS }, sunk: false };
}

const at = (x: number, y = 600): BallSpot => ({ pos: { x, y }, sunk: false });
const sunk: BallSpot = { pos: { x: 0, y: 0 }, sunk: true };
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
    expect(s[BLUE]).toEqual({ pos: { x: 900, y: 609 }, sunk: false });
    s = advanceSpots(s, { type: 'fellOffWorld', playerId: RED, pos: { x: 700, y: 900 }, respawnPos: { x: 250, y: 618 }, strokes: 2, tick: 3 });
    expect(s[RED]).toEqual({ pos: { x: 250, y: 618 }, sunk: false });
    s = advanceSpots(s, { type: 'sink', playerId: BLUE, pos: { x: 1860, y: 594 }, strokes: 3, speed: 10, tick: 4 });
    expect(s[BLUE]?.sunk).toBe(true);
    expect(advanceSpots(s, { type: 'turnStart', playerId: RED, readyInTicks: 0, sameAsBefore: false, tick: 5 })).toBe(s);
  });

  it('spotsOf reads a known state (local mounts, shared links)', () => {
    const { state } = runReplay(goldenConfig(plateAndBridge.id), [], 1);
    expect(spotsOf(state.balls)).toEqual([
      { pos: state.balls[0].pos, sunk: false },
      { pos: state.balls[1].pos, sunk: false },
    ]);
  });

  it('the golden intended lines never show the tip (no stall tap is needed on them)', () => {
    for (const line of GOLDEN_LINES) {
      const level = hole(line.order);
      expect(tipsAlong(level.id, line.log, line.finalTick), line.name).toEqual([]);
    }
  });

  it('a crosser that falls short gets the holder the tip on the next turn', () => {
    const twoDoorsLine = GOLDEN_LINES.find((l) => l.order === 2);
    const bridgeLine = GOLDEN_LINES.find((l) => l.order === 4);
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

  it('every tippable plate opens a door or raises a bridge (the rule assumes it; a new level must not break it silently)', () => {
    for (const level of LEVELS) {
      for (const sw of level.switches) {
        if (sw.id === level.cupHoldsSwitch || sw.onRectId !== undefined) continue;
        for (const r of level.rects) {
          if (!(r.switchIds ?? (r.switchId === undefined ? [] : [r.switchId])).includes(sw.id)) continue;
          const opensDoor = r.kind === 'blocker' && r.activeWhen !== true;
          const raisesBridge = r.kind === 'bridge' && r.activeWhen !== false;
          expect(opensDoor || raisesBridge, `${level.id}: ${r.id} driven by ${sw.id}`).toBe(true);
        }
      }
    }
  });
});
