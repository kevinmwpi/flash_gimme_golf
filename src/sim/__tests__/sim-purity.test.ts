// OWNER: sim
// ARCH.md §3.1 / §4: the determinism grep rules for src/sim (comments are stripped before matching).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as types from '../types';

const SIM_DIR = fileURLToPath(new URL('..', import.meta.url));
const SRC_DIR = resolve(SIM_DIR, '..');

function listFiles(dir: string, skipDirs: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!skipDirs.includes(name)) out.push(...listFiles(full, skipDirs));
    } else if (/\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Removes line and block comments. String literals keep their quotes; their contents are kept only
 * when `keepStrings` is set (import specifiers need them; a DOM global can never hide inside one).
 */
function stripComments(source: string, keepStrings: boolean): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i] ?? '';
    const next = source[i + 1] ?? '';
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          if (keepStrings) out += source[i] ?? '';
          i += 1;
        }
        if (keepStrings) out += source[i] ?? '';
        i += 1;
      }
      out += source[i] ?? '';
      i += 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

const simFiles = listFiles(SIM_DIR, ['__tests__']).map((file) => {
  const source = readFileSync(file, 'utf8');
  return { file: relative(SIM_DIR, file), code: stripComments(source, false), codeWithStrings: stripComments(source, true) };
});

function offenders(patterns: readonly RegExp[]): string[] {
  const hits: string[] = [];
  for (const { file, code } of simFiles) {
    for (const re of patterns) if (re.test(code)) hits.push(`${file}: ${re.source}`);
  }
  return hits;
}

describe('sim purity', () => {
  it('scans the real sim sources', () => {
    const names = simFiles.map((f) => f.file.split(sep).join('/'));
    expect(names).toEqual(expect.arrayContaining(['sim.ts', 'physics.ts', 'terrain.ts', 'rng.ts', 'serialize.ts', 'types.ts']));
  });

  it('no file under src/sim (excluding __tests__) contains Math.random, Date., performance., window, document, navigator, setTimeout or import.meta', () => {
    expect(
      offenders([
        /\bMath\.random\b/,
        /\bDate\s*\./,
        /\bperformance\s*\./,
        /\bwindow\b/,
        /\bdocument\b/,
        /\bnavigator\b/,
        /\bsetTimeout\b/,
        /\bimport\s*\.\s*meta\b/,
      ]),
    ).toEqual([]);
  });

  it('no file under src/sim contains Math.hypot, Math.pow, the ** operator or toFixed', () => {
    expect(offenders([/\bMath\.hypot\b/, /\bMath\.pow\b/, /\*\*/, /\.toFixed\b/])).toEqual([]);
  });

  it('no file under src/sim imports from outside src/sim', () => {
    const outside: string[] = [];
    for (const { file, codeWithStrings } of simFiles) {
      for (const match of codeWithStrings.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        const spec = match[1] ?? '';
        const target = spec.startsWith('.') ? resolve(dirname(join(SIM_DIR, file)), spec) : null;
        if (target === null || relative(SIM_DIR, target).startsWith('..')) outside.push(`${file} -> ${spec}`);
      }
    }
    expect(outside).toEqual([]);
  });

  it('types.ts exports every constant listed in ARCH.md', () => {
    const numeric = [
      'TICK_RATE',
      'DT',
      'VIEWPORT_W',
      'VIEWPORT_H',
      'BALL_RADIUS',
      'GRAVITY',
      'MIN_POWER',
      'MAX_POWER',
      'SHOT_SPEED_PER_POWER',
      'AIM_ANGLE_MIN',
      'AIM_ANGLE_MAX',
      'TURN_DELAY_TICKS',
      'GIMME_RADIUS',
      'NEAR_CUP_RADIUS',
      'SINK_MAX_SPEED',
      'SINK_INSET',
      'LIP_OUT_DAMP',
      'HOLE_RADIUS',
      'SUNK_BALL_DROP',
      'FALL_PENALTY',
      'KILL_MARGIN',
      'CEILING_Y',
      'MAX_BALL_SPEED',
      'SUBSTEP_MAX_MOVE',
      'MAX_SUBSTEPS',
      'GROUND_RESTITUTION',
      'WALL_RESTITUTION',
      'GATE_RESTITUTION',
      'BRIDGE_RESTITUTION',
      'ROLL_DAMP',
      'ROLL_FRICTION',
      'SAND_ROLL_DAMP',
      'AIR_DRAG',
      'SLOPE_GRAVITY_SCALE',
      'REST_SPEED',
      'REST_MAX_SLOPE',
      'REST_TICKS',
      'SUPPORT_TOLERANCE',
      'GROUND_SEARCH_SLACK',
      'PAD_MIN_IMPACT',
      'BOUNCE_EVENT_MIN_IMPACT',
      'BUMPER_SPEED',
      'BUMPER_SIDE_KICK',
      'FAN_FORCE',
      'FAN_MAX_LIFT',
      'SWITCH_CONTACT_TOLERANCE',
      'BRIDGE_LIP_TOLERANCE',
      'OVERHANG_MIN_CLEARANCE',
      'STACK_SEAM_TOLERANCE',
      'MIN_WALL_HEIGHT',
      'MAX_LEVEL_WIDTH',
      'RESTABLE_MAX_SLOPE',
      'MIN_TEE_SEPARATION',
      'KEY_ANGLE_RATE',
      'KEY_POWER_RATE',
      'DRAG_FULL_POWER_PX',
      'DRAG_DEAD_ZONE_PX',
      'DRAG_CANCEL_RADIUS_PX',
      'DRAG_GRAB_RADIUS_PX',
      'DRAG_GRAB_RADIUS_TOUCH_PX',
      'SNAPSHOT_VERSION',
      'BALL_FLAG_ASLEEP',
      'BALL_FLAG_SUNK',
      'BALL_FLAG_GROUNDED',
    ] as const;
    const exported = types as Record<string, unknown>;
    for (const name of numeric) expect(typeof exported[name], name).toBe('number');
    expect(types.DEFAULT_AIM).toEqual({ angle: -0.7854, power: 55 });
    expect(types.PLAYER_COLOURS[0]).toBe('#ff5d73');
    expect(types.PLAYER_GATE_COLOUR).toEqual({ 0: 'red', 1: 'blue' });
  });

  it('no level-id literal appears outside src/sim/levels/', () => {
    const files = listFiles(SRC_DIR, ['__tests__', 'levels', 'node_modules']);
    const hits: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'), true);
      if (/\bw1-\d{2}-[a-z0-9-]+/.test(code)) hits.push(relative(SRC_DIR, file));
    }
    expect(hits).toEqual([]);
  });
});
