// @vitest-environment jsdom
// OWNER: ui
// Every card (Pause.tsx Modal) ignores presses for its first CARD_INPUT_GRACE_MS and never acts on a held Enter or
// Space. A card opened by a press on another card used to take the second half of a doubled click, tap or Enter on
// that card: a doubled "Next hole" or "Continue to World N+1" teed off the next intro card, the only place that
// teaches a hole, before anyone read it, and online, where the first continue from either seat counts (D6), for both.
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEVELS, levelsOfWorld } from '../../sim/levels/index';
import type { Level } from '../../sim/types';
import { COPY } from '../copy';
import LevelIntro from '../LevelIntro';
import { CARD_INPUT_GRACE_MS, Modal } from '../Pause';

let host: HTMLDivElement;
let root: Root;
let clock = 0;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  clock = 5_000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
});

/** World 3's first hole: its intro card is the only place that says "take the bait on purpose". */
function worldThreeEntry(): Level {
  const level = levelsOfWorld(3)[0];
  if (level === undefined) throw new Error('World 3 has no holes');
  return level;
}

function intro(onContinue: () => void): React.ReactElement {
  const level = worldThreeEntry();
  return React.createElement(LevelIntro, { level, holeNumber: level.order, holeCount: LEVELS.length, firstPlayer: level.firstPlayer, mode: 'local', seat: null, device: 'pointer', onboarding: false, onContinue });
}

/** A hole's results card whose "Next hole" opens the next intro card, as App swaps them. */
function ResultsThenIntro({ onTeeOff }: { onTeeOff(): void }): React.ReactElement {
  const [next, setNext] = useState(false);
  if (next) return intro(onTeeOff);
  return React.createElement(Modal, {
    labelledBy: 'results',
    children: [
      React.createElement('h2', { id: 'results', key: 'h' }, 'Hole complete'),
      React.createElement('button', { type: 'button', 'data-autofocus': true, onClick: () => setNext(true), key: 'b' }, COPY.results.next),
    ],
  });
}

function buttonNamed(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent === label);
  if (button === undefined) throw new Error(`no "${label}" button`);
  return button;
}

/** The intro card's scrim: the overlay around the card (a tap there continues, UX.md §3.4). */
function introScrim(): HTMLElement {
  const scrim = document.querySelector('.intro-card')?.parentElement;
  if (scrim === null || scrim === undefined) throw new Error('no intro card');
  return scrim;
}

function pointerDown(target: Element): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
  });
}

/** The click that ends a press: `detail` counts mouse/touch clicks in a row; a key press or element.click() reads 0. */
function clickOnly(target: Element, detail: number): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
  });
}

/**
 * One mouse or touch press as the browser delivers it: pointerdown, mousedown, click. Returns whether the card
 * cancelled the mousedown, which keeps focus where it was (a browser moves focus to, or off, what a mousedown hits).
 */
function press(target: Element, detail: number): { focusKept: boolean } {
  pointerDown(target);
  let focusKept = false;
  act(() => {
    focusKept = !target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail }));
  });
  clickOnly(target, detail);
  return { focusKept };
}

/** A keydown on the focused element; true when the card cancelled it, so the browser never activates the button. */
function keyCancelled(key: string, repeat = false): boolean {
  const target = document.activeElement ?? document.body;
  let cancelled = false;
  act(() => {
    cancelled = !target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, repeat }));
  });
  return cancelled;
}

describe('a card ignores the second half of the press that opened it (CARD_INPUT_GRACE_MS)', () => {
  it('a doubled click, tap or Enter on "Next hole" does not tee off the intro card it opened; a press after the grace does', () => {
    const teeOff = vi.fn();
    act(() => root.render(React.createElement(ResultsThenIntro, { onTeeOff: teeOff })));
    clock += CARD_INPUT_GRACE_MS;
    press(buttonNamed(COPY.results.next), 1);
    expect(document.querySelector('.intro-card h2')?.textContent).toBe(worldThreeEntry().name);
    expect(document.activeElement?.textContent).toBe(COPY.intro.teeOff);

    clock += 150;
    // The ignored presses leave focus on Tee off, so Enter after the grace still tees off.
    expect(press(introScrim(), 2).focusKept).toBe(true);
    expect(press(buttonNamed(COPY.intro.teeOff), 2).focusKept).toBe(true);
    expect(keyCancelled('Enter')).toBe(true);
    expect(keyCancelled(' ')).toBe(true);
    expect(teeOff).not.toHaveBeenCalled();

    clock += CARD_INPUT_GRACE_MS;
    expect(keyCancelled('Enter')).toBe(false);
    expect(press(buttonNamed(COPY.intro.teeOff), 1).focusKept).toBe(false);
    expect(teeOff).toHaveBeenCalledTimes(1);
    press(introScrim(), 1);
    expect(teeOff).toHaveBeenCalledTimes(2);
  });

  it('a held Enter or Space never acts on a card, however long it has been open', () => {
    act(() => root.render(intro(() => {})));
    clock += 10 * CARD_INPUT_GRACE_MS;
    expect(keyCancelled('Enter', true)).toBe(true);
    expect(keyCancelled(' ', true)).toBe(true);
    expect(keyCancelled('Enter')).toBe(false);
    expect(keyCancelled(' ')).toBe(false);
  });

  it('a click counts from its press: pressed inside the grace, it stays ignored when released after it', () => {
    const teeOff = vi.fn();
    act(() => root.render(intro(teeOff)));
    const button = buttonNamed(COPY.intro.teeOff);
    clock += CARD_INPUT_GRACE_MS - 50;
    pointerDown(button);
    clock += 100;
    clickOnly(button, 1);
    expect(teeOff).not.toHaveBeenCalled();
    press(button, 1);
    expect(teeOff).toHaveBeenCalledTimes(1);
    // A key press is a press of its own: an earlier pointer press inside the grace does not hold it back.
    act(() => root.render(null));
    act(() => root.render(intro(teeOff)));
    pointerDown(buttonNamed(COPY.intro.teeOff));
    clock += CARD_INPUT_GRACE_MS;
    clickOnly(buttonNamed(COPY.intro.teeOff), 0);
    expect(teeOff).toHaveBeenCalledTimes(2);
  });

  it('an ignored click never reaches React, so a capture handler above the card (the UI click sound) never hears it', () => {
    const heard = vi.fn();
    const teeOff = vi.fn();
    act(() => root.render(React.createElement('div', { onClickCapture: heard }, intro(teeOff))));
    clock += 150;
    clickOnly(buttonNamed(COPY.intro.teeOff), 0);
    expect(heard).not.toHaveBeenCalled();
    clock += CARD_INPUT_GRACE_MS;
    clickOnly(buttonNamed(COPY.intro.teeOff), 0);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(teeOff).toHaveBeenCalledTimes(1);
  });

  it('Escape closes a card at once', () => {
    const onClose = vi.fn();
    act(() =>
      root.render(
        React.createElement(Modal, {
          labelledBy: 'menu',
          onClose,
          children: [React.createElement('h2', { id: 'menu', key: 'h' }, 'Menu'), React.createElement('button', { type: 'button', 'data-autofocus': true, key: 'b' }, COPY.pause.resume)],
        }),
      ),
    );
    expect(keyCancelled('Escape')).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
