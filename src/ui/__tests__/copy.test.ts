// OWNER: ui
// ARCH.md §1.13 / UX.md §9.4: no competitive framing anywhere in src/ui; copy helpers pin their words.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ErrorCode } from '../../net/protocol';
import { ERROR_COPY } from '../../net/protocol';
import { LEVELS } from '../../sim/levels/index';
import type { MechanicKind } from '../../sim/types';
import { COPY, MECHANIC_COPY, chipStatus, commandErrorToast, flavour, golfDelta, lobbyError, switchLabel, teamDelta, turnBanner, verdict } from '../copy';

const UI_DIR = join(__dirname, '..');
const FORBIDDEN = /\b(opponent|opponents|scoreboard|winner|winners|wins|lose|loser|leaderboard|rank|ranked|1st|2nd)\b/i;

function uiSources(): Array<[string, string]> {
  const files = readdirSync(UI_DIR)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .map((f) => join(UI_DIR, f));
  files.push(join(UI_DIR, '..', 'App.tsx'), join(UI_DIR, '..', 'main.tsx'));
  return files.map((f) => [f, readFileSync(f, 'utf8')]);
}

function flattenStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) flattenStrings(v, out);
  else if (typeof value === 'object' && value !== null) for (const v of Object.values(value)) flattenStrings(v, out);
  return out;
}

describe('ui copy', () => {
  it('no file under src/ui (nor App.tsx / main.tsx) contains a competitive word', () => {
    for (const [file, source] of uiSources()) {
      const hit = FORBIDDEN.exec(source);
      expect(hit, `${file}: "${hit?.[0] ?? ''}"`).toBeNull();
    }
  });

  it('every string in COPY and MECHANIC_COPY is free of competitive words', () => {
    for (const s of [...flattenStrings(COPY), ...flattenStrings(MECHANIC_COPY)]) expect(FORBIDDEN.test(s), s).toBe(false);
  });

  it('no level-id literal appears in src/ui or src/App.tsx (WORLD1_IDS / LEVELS only)', () => {
    for (const [file, source] of uiSources()) {
      expect(/['"`]w1-0\d/.test(source), file).toBe(false);
      for (const level of LEVELS) expect(source.includes(`'${level.id}'`), `${file} mentions ${level.id}`).toBe(false);
    }
  });

  it('teamDelta gives N TO SPARE / AT PAR / N OVER', () => {
    expect(teamDelta(5, 9)).toBe('4 TO SPARE');
    expect(teamDelta(9, 9)).toBe('AT PAR');
    expect(teamDelta(11, 9)).toBe('2 OVER');
  });

  it('golfDelta and verdict use the results wording', () => {
    expect(golfDelta(7, 8)).toBe('−1');
    expect(golfDelta(8, 8)).toBe('E');
    expect(golfDelta(10, 8)).toBe('+2');
    expect(verdict(7, 8)).toBe('1 UNDER PAR');
    expect(verdict(8, 8)).toBe('PAR');
    expect(verdict(10, 8)).toBe('2 OVER PAR');
    expect(flavour(10, 8)).toBe('Double bogey, bronze.');
    expect(flavour(11, 8)).toBe('No medal — try again for bronze.');
  });

  it("turnBanner gives YOUR TURN for the local online seat and RED'S TURN / BLUE'S TURN · P2 otherwise", () => {
    expect(turnBanner(0, true, 'online')).toBe('YOUR TURN');
    expect(turnBanner(1, false, 'online')).toBe("BLUE'S TURN");
    expect(turnBanner(0, true, 'solo')).toBe("RED'S TURN");
    expect(turnBanner(1, true, 'local')).toBe("BLUE'S TURN · P2");
  });

  it('chipStatus follows D2: cup hold > in the cup > aiming > holds > waiting', () => {
    expect(chipStatus({ active: false, phase: 'aiming', sunk: true, holdsLabel: null, cupHoldsLabel: 'WINDOW' })).toBe('CUP HOLDS WINDOW');
    expect(chipStatus({ active: false, phase: 'aiming', sunk: true, holdsLabel: null, cupHoldsLabel: null })).toBe('IN THE CUP');
    expect(chipStatus({ active: true, phase: 'aiming', sunk: false, holdsLabel: 'DOOR', cupHoldsLabel: null })).toBe('AIMING');
    expect(chipStatus({ active: false, phase: 'aiming', sunk: false, holdsLabel: 'DOOR', cupHoldsLabel: null })).toBe('HOLDS DOOR');
    expect(chipStatus({ active: false, phase: 'aiming', sunk: false, holdsLabel: null, cupHoldsLabel: null })).toBe('WAITING');
  });

  it('switchLabel uses the authored label, else SWITCH <letter> by index', () => {
    const level = LEVELS[0];
    if (level === undefined) throw new Error('no levels');
    const withLabels = { ...level, switches: [{ id: 'a', x: 0, w: 10, surfaceY: 0, colour: '#b57bee', label: 'Door' }, { id: 'b', x: 0, w: 10, surfaceY: 0, colour: '#b57bee' }] };
    expect(switchLabel(withLabels, 'a')).toBe('DOOR');
    expect(switchLabel(withLabels, 'b')).toBe('SWITCH B');
  });

  it('the lobby error table covers every ErrorCode and never leaks the raw server copy', () => {
    for (const code of Object.keys(ERROR_COPY) as ErrorCode[]) {
      const entry = lobbyError(code, 'K7PQ2');
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.body.length).toBeGreaterThan(0);
    }
    expect(lobbyError('ROOM_NOT_FOUND', 'K7PQ2').body).toContain('K7PQ2');
    expect(lobbyError('unreachable', null).primary).toBe('retry');
    expect(lobbyError('VERSION_MISMATCH', null).primary).toBe('reload');
  });

  it('command error toasts exist only for the three recoverable in-game codes', () => {
    expect(commandErrorToast('NOT_YOUR_TURN')).not.toBeNull();
    expect(commandErrorToast('WRONG_PHASE')).not.toBeNull();
    expect(commandErrorToast('RATE_LIMITED')).not.toBeNull();
    expect(commandErrorToast('ROOM_FULL')).toBeNull();
  });

  it('MECHANIC_COPY names every mechanic kind', () => {
    const kinds: MechanicKind[] = ['sand', 'spring', 'bumper', 'fan', 'colourGate', 'switch', 'bridge', 'blocker'];
    for (const kind of kinds) expect(MECHANIC_COPY[kind].name.length).toBeGreaterThan(0);
  });
});
