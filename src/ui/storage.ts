// OWNER: ui
/**
 * localStorage for bests, onboarding and UI settings (ARCH.md §1.13; UX.md §7; BUILD_DECISIONS D4:
 * keys `fg.v1.*`; mute / music / volume are persisted by view/audio.ts and are NOT here). Every call is
 * wrapped in try/catch so blocked storage degrades to defaults silently; level ids are validated with
 * `hasLevel` on load and unknown ids are dropped. The medal is stored for convenience but callers
 * recompute it with `medalFor(best.teamStrokes, level.par)` at read time, so a par change never lies.
 */
import { hasLevel } from '../sim/levels/index';
import type { Medal, SimMode } from '../sim/types';
import type { InputDevice } from '../view/view';

export type LevelBest = { teamStrokes: number; medal: Medal; at: number };
export type BestTable = Record<string, LevelBest>;

export type ReducedMotion = 'system' | 'on' | 'off';
export type HintDevice = 'auto' | InputDevice;
export type UiSettings = {
  reducedMotion: ReducedMotion;
  hintDevice: HintDevice;
  hints: boolean;
  lastMode: SimMode;
};

const BEST_KEY = 'fg.v1.best';
const ONBOARDED_KEY = 'fg.v1.onboarded';
const SETTINGS_KEY = 'fg.v1.settings';

const MEDALS: readonly Medal[] = ['gold', 'silver', 'bronze', 'none'];
const MOTION: readonly ReducedMotion[] = ['system', 'on', 'off'];
const HINT_DEVICES: readonly HintDevice[] = ['auto', 'keyboard', 'pointer', 'touch', 'gamepad'];
const MODES: readonly SimMode[] = ['solo', 'local', 'online'];

export const DEFAULT_SETTINGS: Readonly<UiSettings> = Object.freeze({
  reducedMotion: 'system',
  hintDevice: 'auto',
  hints: true,
  lastMode: 'solo',
});

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: degrade silently */
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isLevelBest(v: unknown): v is LevelBest {
  if (!isRecord(v)) return false;
  return (
    typeof v.teamStrokes === 'number' &&
    Number.isInteger(v.teamStrokes) &&
    v.teamStrokes >= 0 &&
    typeof v.at === 'number' &&
    Number.isFinite(v.at) &&
    MEDALS.includes(v.medal as Medal)
  );
}

export function loadBests(): BestTable {
  const parsed = read(BEST_KEY);
  if (!isRecord(parsed)) return {};
  const out: BestTable = {};
  for (const [id, best] of Object.entries(parsed)) {
    if (hasLevel(id) && isLevelBest(best)) out[id] = best;
  }
  return out;
}

/** Writes only when the team strokes improve (or no record exists). Returns the table after the call. */
export function saveBest(levelId: string, teamStrokes: number, medal: Medal): BestTable {
  const bests = loadBests();
  const current = bests[levelId];
  if (!hasLevel(levelId) || (current !== undefined && current.teamStrokes <= teamStrokes)) return bests;
  bests[levelId] = { teamStrokes, medal, at: Date.now() };
  write(BEST_KEY, bests);
  return bests;
}

export function clearBests(): void {
  try {
    localStorage.removeItem(BEST_KEY);
  } catch {
    /* storage blocked: degrade silently */
  }
}

export function loadOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, '1');
  } catch {
    /* storage blocked: degrade silently */
  }
}

export function loadSettings(): UiSettings {
  const parsed = read(SETTINGS_KEY);
  if (!isRecord(parsed)) return { ...DEFAULT_SETTINGS };
  return {
    reducedMotion: MOTION.includes(parsed.reducedMotion as ReducedMotion) ? (parsed.reducedMotion as ReducedMotion) : DEFAULT_SETTINGS.reducedMotion,
    hintDevice: HINT_DEVICES.includes(parsed.hintDevice as HintDevice) ? (parsed.hintDevice as HintDevice) : DEFAULT_SETTINGS.hintDevice,
    hints: typeof parsed.hints === 'boolean' ? parsed.hints : DEFAULT_SETTINGS.hints,
    lastMode: MODES.includes(parsed.lastMode as SimMode) ? (parsed.lastMode as SimMode) : DEFAULT_SETTINGS.lastMode,
  };
}

export function saveSettings(settings: UiSettings): void {
  write(SETTINGS_KEY, settings);
}
