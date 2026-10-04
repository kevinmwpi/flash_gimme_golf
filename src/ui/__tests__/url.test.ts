// @vitest-environment jsdom
// OWNER: ui
// UX.md §2 / §3.2: ?room= normalisation, mangled links still reach the lobby, pasted URLs yield their code.
import { describe, expect, it } from 'vitest';
import { isRoomCode, normaliseRoomCode, readRoomParam } from '../url';

function visit(search: string): void {
  window.history.replaceState(null, '', `/${search}`);
}

describe('room links', () => {
  it('a complete code is normalised and recognised', () => {
    visit('?room=k7pq2');
    expect(readRoomParam()).toBe('K7PQ2');
    expect(isRoomCode('K7PQ2')).toBe(true);
  });

  it('a mangled code is kept (prefilled in the lobby) but does not auto-join', () => {
    visit('?room=abc');
    expect(readRoomParam()).toBe('ABC');
    expect(isRoomCode('ABC')).toBe(false);
    visit('?room=---');
    expect(readRoomParam()).toBeNull();
    visit('?other=1');
    expect(readRoomParam()).toBeNull();
  });

  it('a whole invite URL inserted into the code field (drag-drop, IME commit) yields its code', () => {
    expect(normaliseRoomCode('https://flash-golf.vercel.app/?room=K7PQ2')).toBe('K7PQ2');
    expect(normaliseRoomCode('k7pq2extra')).toBe('K7PQ2');
  });
});
