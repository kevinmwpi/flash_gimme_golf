// @vitest-environment jsdom
// OWNER: ui
// ARCH.md §1.13 storage rules (keys fg.v1.* per BUILD_DECISIONS D4; audio.ts owns mute persistence).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEVELS } from '../../sim/levels/index';
import * as storage from '../storage';
import { DEFAULT_SETTINGS, clearBests, loadBests, loadOnboarded, loadSettings, saveBest, saveOnboarded, saveSettings } from '../storage';

const levelId = LEVELS[0]?.id ?? '';

describe('storage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('loadBests drops unknown level ids and malformed entries', () => {
    localStorage.setItem(
      'fg.v1.best',
      JSON.stringify({
        [levelId]: { teamStrokes: 7, medal: 'gold', at: 1 },
        'no-such-level': { teamStrokes: 3, medal: 'gold', at: 1 },
        [`${levelId}-x`]: 'garbage',
      }),
    );
    expect(loadBests()).toEqual({ [levelId]: { teamStrokes: 7, medal: 'gold', at: 1 } });
    localStorage.setItem('fg.v1.best', JSON.stringify({ [levelId]: { teamStrokes: 7.5, medal: 'platinum', at: 1 } }));
    expect(loadBests()).toEqual({});
    localStorage.setItem('fg.v1.best', 'not json');
    expect(loadBests()).toEqual({});
  });

  it('saveBest writes only when the team strokes improve', () => {
    saveBest(levelId, 9, 'bronze');
    expect(loadBests()[levelId]?.teamStrokes).toBe(9);
    saveBest(levelId, 11, 'none');
    expect(loadBests()[levelId]?.teamStrokes).toBe(9);
    saveBest(levelId, 9, 'bronze');
    expect(loadBests()[levelId]?.teamStrokes).toBe(9);
    const after = saveBest(levelId, 6, 'gold');
    expect(after[levelId]?.medal).toBe('gold');
    expect(loadBests()[levelId]?.teamStrokes).toBe(6);
    saveBest('no-such-level', 1, 'gold');
    expect(loadBests()['no-such-level']).toBeUndefined();
    clearBests();
    expect(loadBests()).toEqual({});
  });

  it('every call survives a throwing localStorage (returns defaults)', () => {
    const boom = (): never => {
      throw new Error('blocked');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);
    expect(loadBests()).toEqual({});
    expect(() => saveBest(levelId, 5, 'gold')).not.toThrow();
    expect(() => clearBests()).not.toThrow();
    expect(loadOnboarded()).toBe(false);
    expect(() => saveOnboarded()).not.toThrow();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
  });

  it('loadOnboarded / saveOnboarded round-trip through fg.v1.onboarded', () => {
    expect(loadOnboarded()).toBe(false);
    saveOnboarded();
    expect(localStorage.getItem('fg.v1.onboarded')).toBe('1');
    expect(loadOnboarded()).toBe(true);
  });

  it('settings round-trip through fg.v1.settings and reject unknown values', () => {
    saveSettings({ reducedMotion: 'on', hintDevice: 'gamepad', hints: false, lastMode: 'local' });
    expect(loadSettings()).toEqual({ reducedMotion: 'on', hintDevice: 'gamepad', hints: false, lastMode: 'local' });
    localStorage.setItem('fg.v1.settings', JSON.stringify({ reducedMotion: 'sometimes', hintDevice: 'wheel', hints: 'yes', lastMode: 'lan', muted: true }));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('storage.ts has no loadMuted / saveMuted and never touches an audio key (audio.ts owns mute persistence)', () => {
    expect('loadMuted' in storage).toBe(false);
    expect('saveMuted' in storage).toBe(false);
    saveSettings(DEFAULT_SETTINGS);
    saveBest(levelId, 5, 'gold');
    saveOnboarded();
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i) ?? '';
      expect(key.startsWith('fg.v1.')).toBe(true);
      expect(key).not.toMatch(/mute|audio|music|volume/i);
    }
  });
});
