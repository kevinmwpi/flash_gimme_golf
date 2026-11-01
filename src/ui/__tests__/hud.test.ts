// @vitest-environment jsdom
// OWNER: ui
// VISUAL.md §11 / D10.10: a ball resting on a pressed plate reads HOLDS <label>, the cup-wired plate included. On
// holes 5-12 the cup holds each hole's key landing plate (TOP, FAR, FIRE, DOOR, B): a ball resting there is the
// one holding the way open, and its chip used to read WAITING. A sunk ball keeps CUP HOLDS <label>.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LEVELS } from '../../sim/levels/index';
import type { Level, PlayerId } from '../../sim/types';
import type { FrameSummary } from '../../view/GameCanvas';
import { switchLabel } from '../copy';
import Hud from '../Hud';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Red aiming; blue at rest, sunk or not, holding the plates in `holds` (what GameCanvas derives from SimState). */
function summaryOf(level: Level, holds: Record<string, PlayerId>, blueSunk: boolean): FrameSummary {
  return {
    phase: 'aiming',
    tick: 600,
    activePlayer: 0,
    turnReady: true,
    strokes: [1, 1],
    aim: { angle: -0.8, power: 50 },
    device: 'pointer',
    cameraMode: 'overview',
    levelId: level.id,
    seatIsActive: true,
    paused: false,
    sunk: [false, blueSunk],
    turnDelayTicks: 0,
    holds,
    waiting: [null, null],
    miss: null,
  };
}

function blueStatus(level: Level, holds: Record<string, PlayerId>, blueSunk = false): string {
  const summary = summaryOf(level, holds, blueSunk);
  act(() =>
    root.render(
      React.createElement(Hud, {
        summary,
        level,
        holeNumber: level.order,
        holeCount: LEVELS.length,
        seat: null,
        mode: 'local',
        holds: summary.holds,
        muted: false,
        audioLocked: false,
        compact: false,
        showHint: false,
        device: 'pointer',
        onPause: () => {},
        onToggleMute: () => {},
        onToggleCamera: () => {},
        onToggleHint: () => {},
      }),
    ),
  );
  return host.querySelector('.chip.blue .status')?.textContent ?? '';
}

describe('HUD player chip', () => {
  const cupWired = LEVELS.filter((l): l is Level & { cupHoldsSwitch: string } => l.cupHoldsSwitch !== undefined);

  it('every hole from 5 on wires the cup to a plate (the check below covers them all)', () => {
    expect(cupWired.filter((l) => l.order >= 5).map((l) => l.order)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it.each(cupWired.map((l) => [l.order, l] as const))('hole %i: a ball resting on the cup-wired plate HOLDS it; sunk, the cup does', (_, level) => {
    const label = switchLabel(level, level.cupHoldsSwitch);
    expect(blueStatus(level, { [level.cupHoldsSwitch]: 1 })).toBe(`HOLDS ${label}`);
    expect(blueStatus(level, {}, true)).toBe(`CUP HOLDS ${label}`);
    expect(blueStatus(level, {})).toBe('WAITING');
  });
});
