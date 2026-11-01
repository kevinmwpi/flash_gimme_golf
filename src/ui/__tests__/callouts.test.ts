// @vitest-environment jsdom
// OWNER: ui
// BUILD_DECISIONS D10.10: every turn the WAITING rule hands over (`turnSkipped`, same tick as and just before its
// `turnStart`) shows the turn banner with "Red is caught — Blue shoots again" under the short main line, and the
// live region reads the whole sentence. A turn that only follows a sunk partner is no skip.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlayerId, SimEvent, SimMode } from '../../sim/types';
import Callouts from '../Callouts';
import { createEventBus, type EventBus } from '../eventBus';

const RED: PlayerId = 0;
const BLUE: PlayerId = 1;

let host: HTMLDivElement;
let root: Root;
let bus: EventBus;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  bus = createEventBus();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(seats: readonly PlayerId[], mode: SimMode): void {
  act(() => root.render(React.createElement(Callouts, { bus, seats, mode, toasts: [], onToastDone: () => undefined })));
}

function push(...events: SimEvent[]): void {
  act(() => bus.push(events));
}

const skipped = (tick: number, playerId: PlayerId, nextPlayer: PlayerId, reason: 'caught' | 'loaded' = 'caught'): SimEvent => ({
  type: 'turnSkipped',
  playerId,
  reason,
  rectId: reason === 'caught' ? 'snare' : 'cannon',
  nextPlayer,
  tick,
});
const turn = (tick: number, playerId: PlayerId, sameAsBefore: boolean): SimEvent => ({ type: 'turnStart', playerId, readyInTicks: 27, sameAsBefore, tick });

/** The banner as drawn (main line, sub-line) and the banner live region. */
function shown(): { text: string | null; sub: string | null; live: string } {
  const banner = host.querySelector('.banner');
  return {
    text: banner?.querySelector('.banner-text')?.textContent ?? null,
    sub: banner?.querySelector('small')?.textContent ?? null,
    live: host.querySelector('.sr-only')?.textContent ?? '',
  };
}

describe('skip banner (D10.10)', () => {
  it('a skipped turn keeps the short main line, carries the sentence under it and reads it out', () => {
    mount([RED], 'solo');
    push(skipped(100, RED, BLUE), turn(100, BLUE, true));
    expect(shown()).toEqual({ text: "BLUE'S TURN", sub: 'Red is caught — Blue shoots again', live: "BLUE'S TURN. Red is caught — Blue shoots again" });
  });

  it('every skipped turn shows it, a loaded ball included', () => {
    mount([RED, BLUE], 'local');
    push(skipped(100, RED, BLUE), turn(100, BLUE, true));
    expect(shown().sub).toBe('Red is caught — Blue shoots again');
    push(skipped(400, RED, BLUE, 'loaded'), turn(400, BLUE, true));
    expect(shown()).toEqual({ text: "BLUE'S TURN · P2", sub: 'Red is loaded — Blue shoots again', live: "BLUE'S TURN · P2. Red is loaded — Blue shoots again" });
  });

  it('the same player again because the partner is sunk is no skip', () => {
    mount([RED], 'solo');
    push(turn(100, BLUE, true));
    expect(shown()).toEqual({ text: "BLUE'S TURN", sub: null, live: "BLUE'S TURN" });
  });

  it('a skip never labels a turn of another tick or of another player', () => {
    mount([RED], 'solo');
    push(skipped(100, RED, BLUE));
    push(turn(160, BLUE, true));
    expect(shown().sub).toBeNull();
    push(skipped(200, BLUE, RED), turn(200, BLUE, false));
    expect(shown().sub).toBeNull();
  });

  it('online: the waiting seat reads its own ball, the shooter keeps YOUR TURN', () => {
    mount([RED], 'online');
    push(skipped(100, RED, BLUE), turn(100, BLUE, true));
    expect(shown()).toEqual({ text: "BLUE'S TURN", sub: 'Your ball is caught — Blue shoots again', live: "BLUE'S TURN. Your ball is caught — Blue shoots again" });
    act(() => root.unmount());
    root = createRoot(host);
    mount([BLUE], 'online');
    push(skipped(100, RED, BLUE), turn(100, BLUE, true));
    expect(shown()).toEqual({ text: 'YOUR TURN', sub: 'Red is caught — Blue shoots again', live: 'YOUR TURN. Red is caught — Blue shoots again' });
  });

  it('online without a skip keeps "your partner" under the partner turn', () => {
    mount([RED], 'online');
    push(turn(100, BLUE, false));
    expect(shown()).toEqual({ text: "BLUE'S TURN", sub: 'your partner', live: "BLUE'S TURN" });
  });
});
