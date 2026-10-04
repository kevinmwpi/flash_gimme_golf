// OWNER: input-loop
/**
 * UX.md §4.6 "downward pull room" / locked decision 10 (fully playable with touch only): every
 * LEVELS.md intended line must be completable with pointer pulls that stay inside the stage. Each
 * beat of every scripted line is replayed on the solver grid taking the FIRST satisfying shot that
 * `pullReachable` accepts from the shooter's resting ball as the real follow camera shows it
 * (cameraFor: zoom 1, y 0, clamped to the level with no overscan per BUILD_DECISIONS D7, so a ball
 * near a level edge sits near the stage edge, which is the hard case for pull room).
 */
import { describe, expect, it } from 'vitest';
import { SCRIPTED_LINES, cellGrid, newGame, takeShot, aimOf, type Game, type Shot } from '../../../scripts/solver';
import { LEVELS } from '../../sim/levels/index';
import type { Level, Vec } from '../../sim/types';
import { pullReachable } from '../input/pointer';
import { cameraFor } from '../view';

const GRID = cellGrid(16, 8);

function gridShots(): Shot[] {
  const out: Shot[] = [];
  for (const deg of GRID.angles) for (const power of GRID.powers) out.push({ deg, power });
  return out;
}

const SHOTS = gridShots();

type Line = (typeof SCRIPTED_LINES)[number];
type Replay = { bothSunk: boolean; failedAt: string | null; shots: string[] };

/** The shooter's ball on the stage under the follow camera the game shows for this turn. */
function pressFor(level: Level, game: Game): Vec {
  const cam = cameraFor(level, game.state, 'follow');
  const pos = game.state.balls[game.state.activePlayer].pos;
  return { x: (pos.x - cam.x) * cam.zoom, y: (pos.y - cam.y) * cam.zoom };
}

/** Replays a scripted line with touch-reachable shots only. */
function replayReachable(level: Level, line: Line): Replay {
  let game = newGame(level);
  const shots: string[] = [];
  for (const beat of line.beats) {
    if (game.state.balls[beat.who].sunk) continue;
    if (game.state.activePlayer !== beat.who) return { bothSunk: false, failedAt: `${beat.what} (turn order)`, shots };
    const press = pressFor(level, game);
    let found: Game | null = null;
    for (const shot of SHOTS) {
      if (!pullReachable(press, aimOf(shot))) continue;
      const r = takeShot(game, shot);
      if (r === null || !beat.ok(r.summary)) continue;
      found = r.game;
      shots.push(`P${beat.who + 1} ${Math.round(shot.deg)}°/${Math.round(shot.power)} from y ${Math.round(press.y)}`);
      break;
    }
    if (found === null) return { bothSunk: false, failedAt: beat.what, shots };
    game = found;
  }
  return { bothSunk: game.state.balls.every((b) => b.sunk), failedAt: null, shots };
}

describe('every LEVELS.md intended line is completable with pointer pulls that stay inside the stage', () => {
  for (const level of LEVELS) {
    const lines = SCRIPTED_LINES.filter((l) => l.order === level.order);
    it(`hole ${level.order}: ${level.name} (${lines.length} scripted lines)`, () => {
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const replay = replayReachable(level, line);
        expect(replay.failedAt, `${line.name}: ${replay.shots.join(' · ')}`).toBeNull();
        expect(replay.bothSunk, line.name).toBe(true);
      }
    }, 120_000);
  }
});
