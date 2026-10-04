// @vitest-environment jsdom
// OWNER: ui
// UX.md §3.6: a card opened from a HUD button returns focus to the stage canvas on close, so the next
// Space/Enter shoots instead of re-firing the button; a card opened from another card returns to it.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { blurAfterPointerClick, speakerState } from '../Hud';
import { Modal, restoreTarget } from '../Pause';

let host: HTMLDivElement;
let root: Root;

function stage(): { canvas: HTMLCanvasElement; hudButton: HTMLButtonElement; cardButton: HTMLButtonElement } {
  const canvas = document.createElement('canvas');
  canvas.className = 'stage-canvas';
  canvas.tabIndex = 0;
  const hud = document.createElement('div');
  hud.className = 'hud';
  const hudButton = document.createElement('button');
  hud.appendChild(hudButton);
  const card = document.createElement('div');
  card.className = 'card';
  const cardButton = document.createElement('button');
  card.appendChild(cardButton);
  document.body.append(canvas, hud, card, host);
  return { canvas, hudButton, cardButton };
}

const modal = (): React.ReactElement =>
  React.createElement(Modal, {
    labelledBy: 'm',
    children: [React.createElement('h2', { id: 'm', key: 'h' }, 'Card'), React.createElement('button', { type: 'button', 'data-autofocus': true, key: 'b' }, 'Resume')],
  });

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
});

describe('Modal focus restore', () => {
  it('opened from a HUD button, closing focuses the stage canvas', () => {
    const { canvas, hudButton } = stage();
    hudButton.focus();
    act(() => root.render(modal()));
    expect(document.activeElement?.textContent).toBe('Resume');
    act(() => root.render(null));
    expect(document.activeElement).toBe(canvas);
  });

  it('opened from inside another card, closing returns to that card', () => {
    const { cardButton } = stage();
    cardButton.focus();
    act(() => root.render(modal()));
    act(() => root.render(null));
    expect(document.activeElement).toBe(cardButton);
  });

  it('restoreTarget maps HUD elements to the canvas and leaves others alone', () => {
    const { canvas, hudButton, cardButton } = stage();
    expect(restoreTarget(hudButton)).toBe(canvas);
    expect(restoreTarget(cardButton)).toBe(cardButton);
    expect(restoreTarget(null)).toBeNull();
  });
});

describe('HUD buttons and the keyboard', () => {
  it('blurAfterPointerClick drops focus after a mouse click but keeps it for keyboard activation', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    blurAfterPointerClick({ detail: 1, currentTarget: button } as unknown as React.MouseEvent<HTMLElement>);
    expect(document.activeElement).not.toBe(button);
    button.focus();
    blurAfterPointerClick({ detail: 0, currentTarget: button } as unknown as React.MouseEvent<HTMLElement>);
    expect(document.activeElement).toBe(button);
  });

  it('speakerState lets a persisted mute win over the locked glyph', () => {
    expect(speakerState(true, true).icon).toBe('mute');
    expect(speakerState(true, false).icon).toBe('soundLocked');
    expect(speakerState(false, false).icon).toBe('unmute');
    expect(speakerState(false, true).pressed).toBe(true);
    expect(speakerState(true, false).pressed).toBeUndefined();
  });
});
