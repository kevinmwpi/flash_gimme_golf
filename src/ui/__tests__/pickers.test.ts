// @vitest-environment jsdom
// OWNER: ui
// The hole and world pickers' keyboard (D10.1 / D10.2, UX.md §6): the lobby's START AT rows follow the ARIA radio
// pattern the Title tray uses (one tab stop per group, arrows move the choice and the focus, wrapping), and the
// Title's 1/2/3 mode accelerators never fire inside the tray, whose radios read WORLD 1/2/3.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientStatus, GameClient } from '../../net/GameClient';
import { WORLD_IDS } from '../../sim/levels/index';
import { COPY } from '../copy';
import Lobby from '../Lobby';
import { DEFAULT_SETTINGS } from '../storage';
import Title from '../Title';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function press(target: Element, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function radiosOf(group: string): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>(`[role="radiogroup"][aria-label="${group}"] [role="radio"]`)];
}

function first(world: 1 | 2 | 3): string {
  const id = WORLD_IDS[world][0];
  if (id === undefined) throw new Error(`world ${world} has no holes`);
  return id;
}

describe('lobby START AT (host card)', () => {
  const setLevel = vi.fn<(levelId: string) => void>();
  const client = { setLevel, start: () => {}, leave: () => {}, joinRoom: async () => {}, createRoom: async () => {} } as unknown as GameClient;

  function render(levelId: string): void {
    const status: ClientStatus = { kind: 'waiting', code: 'KPQ27', inviteUrl: 'https://example.test/?room=KPQ27', peerConnected: false, lobby: { levelId, players: [true, false], names: ['Red', 'Blue'] } };
    act(() => root.render(React.createElement(Lobby, { client, status, initialCode: null, autoJoin: false, autoCreate: false, onBack: () => {}, onPlaySolo: () => {} })));
  }

  const worlds = (): HTMLButtonElement[] => radiosOf(COPY.lobby.world);
  const holes = (): HTMLButtonElement[] => radiosOf(COPY.lobby.startAt);
  const tabStops = (radios: HTMLButtonElement[]): string[] => radios.filter((r) => r.tabIndex === 0).map((r) => r.textContent ?? '');

  beforeEach(() => setLevel.mockClear());

  it('each row is one tab stop: the chosen world and the chosen hole', () => {
    render(WORLD_IDS[2][1] ?? '');
    expect(worlds()).toHaveLength(3);
    expect(holes()).toHaveLength(4);
    expect(tabStops(worlds())).toEqual([worlds()[1]?.textContent]);
    expect(tabStops(holes())).toEqual([COPY.lobby.hole(6)]);
    // A start hole this build does not know shows World 1, still reachable from its first hole.
    render('w9-99-unknown');
    expect(tabStops(holes())).toEqual([COPY.lobby.hole(1)]);
  });

  it('arrow keys move the world choice and the focus at once, wrapping, without waiting for the server echo', () => {
    render(first(1));
    const [w1] = worlds();
    if (w1 === undefined) throw new Error('no world radios');
    w1.focus();
    press(w1, 'ArrowRight');
    expect(document.activeElement).toBe(worlds()[1]);
    expect(setLevel).toHaveBeenLastCalledWith(first(2));
    // A second press before lobbyState comes back steps on from the focused radio.
    press(document.activeElement as Element, 'ArrowRight');
    expect(document.activeElement).toBe(worlds()[2]);
    expect(setLevel).toHaveBeenLastCalledWith(first(3));
    // Back onto the world the stale echo still shows as chosen: it is sent all the same.
    press(document.activeElement as Element, 'ArrowLeft');
    press(document.activeElement as Element, 'ArrowUp');
    expect(document.activeElement).toBe(worlds()[0]);
    expect(setLevel).toHaveBeenLastCalledWith(first(1));
    // The server echo: World 3 is chosen and is the row's tab stop; Down wraps to World 1, Left wraps back.
    render(first(3));
    worlds()[2]?.focus();
    expect(worlds()[2]?.getAttribute('aria-checked')).toBe('true');
    expect(worlds()[2]?.tabIndex).toBe(0);
    press(document.activeElement as Element, 'ArrowDown');
    expect(document.activeElement).toBe(worlds()[0]);
    expect(setLevel).toHaveBeenLastCalledWith(first(1));
    press(document.activeElement as Element, 'ArrowLeft');
    expect(document.activeElement).toBe(worlds()[2]);
    // A click on the shown world keeps its hole; a click on another world starts at its first hole.
    setLevel.mockClear();
    act(() => worlds()[2]?.click());
    expect(setLevel).not.toHaveBeenCalled();
    act(() => worlds()[1]?.click());
    expect(setLevel).toHaveBeenLastCalledWith(first(2));
  });

  it("arrow keys walk the shown world's holes, wrapping inside the world; other keys do nothing", () => {
    render(first(2));
    const row = holes();
    row[0]?.focus();
    press(row[0] as Element, 'ArrowLeft');
    expect(document.activeElement).toBe(row[3]);
    expect(setLevel).toHaveBeenLastCalledWith(WORLD_IDS[2][3]);
    press(row[3] as Element, 'ArrowRight');
    expect(document.activeElement).toBe(row[0]);
    expect(setLevel).toHaveBeenLastCalledWith(WORLD_IDS[2][0]);
    setLevel.mockClear();
    press(row[0] as Element, 'Home');
    expect(setLevel).not.toHaveBeenCalled();
  });
});

describe('Title mode accelerators', () => {
  const onSolo = vi.fn<(id: string) => void>();
  const onLocal = vi.fn<(id: string) => void>();
  const onOnline = vi.fn<() => void>();

  beforeEach(() => {
    onSolo.mockClear();
    onLocal.mockClear();
    onOnline.mockClear();
    act(() =>
      root.render(
        React.createElement(Title, {
          bests: {},
          settings: { ...DEFAULT_SETTINGS },
          shared: null,
          onlineAvailable: true,
          healthUrl: null,
          version: 'test',
          muted: false,
          audioLocked: false,
          focusTray: false,
          onToggleMute: () => {},
          onSolo,
          onLocal,
          onOnline,
          onOpenSettings: () => {},
          onContinueShared: () => {},
          onDismissShared: () => {},
        }),
      ),
    );
  });

  it('typing a world number on the WORLD 1/2/3 picker or a hole tile is no mode pick', () => {
    const tab = document.querySelector<HTMLElement>('.world-tab.on');
    const tile = document.querySelector<HTMLElement>('.tile.cur');
    if (tab === null || tile === null) throw new Error('no tray');
    for (const target of [tab, tile]) {
      target.focus();
      for (const key of ['1', '2', '3']) press(target, key);
    }
    expect(onSolo).not.toHaveBeenCalled();
    expect(onLocal).not.toHaveBeenCalled();
    expect(onOnline).not.toHaveBeenCalled();
  });

  it('outside the tray 1/2/3 still pick Solo, Local 2P and Online on the selected hole', () => {
    const mode = document.querySelector<HTMLElement>('.mode-btn.solo');
    if (mode === null) throw new Error('no mode buttons');
    mode.focus();
    press(mode, '2');
    expect(onLocal).toHaveBeenCalledWith(first(1));
    press(document.body, '1');
    expect(onSolo).toHaveBeenCalledWith(first(1));
    press(document.body, '3');
    expect(onOnline).toHaveBeenCalledTimes(1);
  });
});
