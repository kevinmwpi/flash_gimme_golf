// OWNER: ui
// ARCH.md §1.13 / UX.md §9.4: no competitive framing anywhere in src/ui; copy helpers pin their words.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ErrorCode } from '../../net/protocol';
import { ERROR_COPY } from '../../net/protocol';
import { LEVELS, worldTitle } from '../../sim/levels/index';
import type { MechanicKind } from '../../sim/types';
import { COPY, MECHANIC_COPY, chipStatus, commandErrorToast, flavour, golfDelta, lobbyError, switchLabel, teamDelta, turnBanner, turnBannerLines, verdict, type ChipStatusInput } from '../copy';

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

  it('no level-id literal of any world appears in src/ui or src/App.tsx (the registry only)', () => {
    for (const [file, source] of uiSources()) {
      expect(/['"`]w\d-\d\d/.test(source), file).toBe(false);
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
    const chip = (o: Partial<ChipStatusInput>): string => chipStatus({ active: false, phase: 'aiming', sunk: false, holdsLabel: null, cupHoldsLabel: null, waiting: null, ...o });
    expect(chip({ sunk: true, cupHoldsLabel: 'WINDOW' })).toBe('CUP HOLDS WINDOW');
    expect(chip({ sunk: true })).toBe('IN THE CUP');
    expect(chip({ active: true, holdsLabel: 'DOOR' })).toBe('AIMING');
    expect(chip({ active: true, phase: 'flying' })).toBe('AIMING');
    expect(chip({ holdsLabel: 'DOOR' })).toBe('HOLDS DOOR');
    expect(chip({})).toBe('WAITING');
  });

  it('chipStatus names a waiting ball by its device and first release (D10.10), ahead of AIMING and HOLDS', () => {
    const chip = (o: Partial<ChipStatusInput>): string => chipStatus({ active: false, phase: 'aiming', sunk: false, holdsLabel: null, cupHoldsLabel: null, waiting: null, ...o });
    expect(chip({ waiting: { reason: 'caught', release: 'FREE' } })).toBe('CAUGHT · needs FREE');
    expect(chip({ waiting: { reason: 'loaded', release: 'FIRE' } })).toBe('LOADED · needs FIRE');
    // A caught ball on a seat plate (L9 BAIT) still holds it, but the chip names what the partner must do.
    expect(chip({ waiting: { reason: 'caught', release: 'TOP' }, holdsLabel: 'BAIT' })).toBe('CAUGHT · needs TOP');
    // A ball that comes to rest caught on its own shot reads CAUGHT before the hand-off ends the flight.
    expect(chip({ waiting: { reason: 'caught', release: 'FREE' }, active: true, phase: 'flying' })).toBe('CAUGHT · needs FREE');
    expect(chip({ waiting: { reason: 'loaded', release: 'A, B or DECK' } })).toBe('LOADED · needs A, B or DECK');
    expect(chip({ waiting: { reason: 'caught', release: 'FREE or FAR' } })).toBe('CAUGHT · needs FREE or FAR');
    expect(chip({ waiting: { reason: 'caught', release: 'FREE' }, sunk: true, cupHoldsLabel: 'FAR' })).toBe('CUP HOLDS FAR');
  });

  it('the D10.10 waiting copy keeps the design wording', () => {
    expect(COPY.hud.status.caught('FREE')).toBe('CAUGHT · needs FREE');
    expect(COPY.hud.status.loaded('FIRE')).toBe('LOADED · needs FIRE');
    expect(COPY.banner.skipped(0, 'caught', 1)).toBe('Red is caught — Blue shoots again');
    expect(COPY.banner.skipped(0, 'loaded', 1)).toBe('Red is loaded — Blue shoots again');
    expect(COPY.banner.skipped(1, 'caught', 0)).toBe('Blue is caught — Red shoots again');
    expect(COPY.banner.skippedYou('caught', 1)).toBe('Your ball is caught — Blue shoots again');
  });

  it('turnBannerLines: a plain turn keeps UX §4.4 (online partner sub-line "your partner", the live region reads the main line)', () => {
    expect(turnBannerLines(0, null, [0], 'solo')).toEqual({ text: "RED'S TURN", sub: null, say: "RED'S TURN" });
    expect(turnBannerLines(1, null, [0, 1], 'local')).toEqual({ text: "BLUE'S TURN · P2", sub: null, say: "BLUE'S TURN · P2" });
    expect(turnBannerLines(1, null, [1], 'online')).toEqual({ text: 'YOUR TURN', sub: null, say: 'YOUR TURN' });
    expect(turnBannerLines(1, null, [0], 'online')).toEqual({ text: "BLUE'S TURN", sub: 'your partner', say: "BLUE'S TURN" });
  });

  it('turnBannerLines: every skipped turn keeps the short main line, carries the sentence below it and reads it out', () => {
    const caught = { playerId: 0, reason: 'caught' } as const;
    expect(turnBannerLines(1, caught, [0], 'solo')).toEqual({
      text: "BLUE'S TURN",
      sub: 'Red is caught — Blue shoots again',
      say: "BLUE'S TURN. Red is caught — Blue shoots again",
    });
    expect(turnBannerLines(1, { playerId: 0, reason: 'loaded' }, [0, 1], 'local').sub).toBe('Red is loaded — Blue shoots again');
    // Online: the shooter reads the plain sentence under YOUR TURN; the waiting seat reads its own ball.
    expect(turnBannerLines(1, caught, [1], 'online')).toMatchObject({ text: 'YOUR TURN', sub: 'Red is caught — Blue shoots again' });
    expect(turnBannerLines(1, caught, [0], 'online')).toEqual({
      text: "BLUE'S TURN",
      sub: 'Your ball is caught — Blue shoots again',
      say: "BLUE'S TURN. Your ball is caught — Blue shoots again",
    });
    // Short enough for the 500 px ribbon (28 px main line; the sentence is the 15 px line).
    for (const mode of ['solo', 'local', 'online'] as const) expect(turnBannerLines(1, caught, [1], mode).text.length).toBeLessThanOrEqual(16);
  });

  it('world copy: results eyebrow, the continue button and the guest line carry the world; the tray picker reads the registry titles', () => {
    expect(COPY.campaign.title(2)).toBe('WORLD 2 COMPLETE');
    expect(COPY.campaign.nextWorld(3)).toBe('Continue to World 3');
    expect(COPY.lobby.startingAt(worldTitle(2), 5)).toBe('World 2 — Lift & Lock · starting at Hole 5');
    expect(COPY.intro.hole(6, LEVELS.length)).toBe('HOLE 6 OF 12');
    expect(COPY.hud.hole(12, LEVELS.length)).toBe('HOLE 12/12');
  });

  it('D10.9 copy teaches the press-anywhere drag and drops the off-ball miss line', () => {
    expect(COPY.hint.aim.pointer).toBe('Drag back anywhere, release to shoot · drag back to the start to cancel');
    expect(COPY.hint.aim.touch).toBe('Pull back anywhere, let go to shoot');
    expect(COPY.coach.step1.pointer).toBe('Drag back from anywhere…');
    expect(COPY.coach.step1.touch).toBe('Pull back from anywhere…');
    expect(COPY.hint.wrongBall(0)).toBe("That's the blue ball — red is up · drag from anywhere else");
    expect(COPY.lobby.preteach(1)).toBe('While you wait: you play the blue ball. On your turn, pull back anywhere to shoot it.');
    expect('miss' in COPY.hint).toBe(false);
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
    // A Record keeps this list exhaustive: a new MechanicKind fails to compile here until it is listed.
    const kinds: Record<MechanicKind, true> = { sand: true, spring: true, bumper: true, fan: true, colourGate: true, switch: true, bridge: true, blocker: true, trap: true, cannon: true };
    for (const kind of Object.keys(kinds) as MechanicKind[]) {
      expect(MECHANIC_COPY[kind].name.length, kind).toBeGreaterThan(0);
      expect(MECHANIC_COPY[kind].blurb.length, kind).toBeGreaterThan(0);
    }
    expect(MECHANIC_COPY.trap).toEqual({ name: 'TRAP', blurb: 'Stop in its jaws and you wait for your partner.' });
    expect(MECHANIC_COPY.cannon).toEqual({ name: 'CANNON', blurb: 'Rest inside it; a ball on FIRE shoots you across.' });
  });
});
