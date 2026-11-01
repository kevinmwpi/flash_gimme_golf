// OWNER: levels
/**
 * The intended lines (scripts/solver.ts): every hole's "How it plays" from LEVELS.md (World 1) and
 * design/proposals/worlds-2-3/LEVELS.md (worlds 2-3) as beat predicates, keyed by level id (D10.1). A line is
 * replayed on the shot grid taking the FIRST shot that satisfies each beat, so every beat is tight enough that
 * the first satisfying shot never strands the next one; the sim's turn order (the WAITING rule included) must
 * match the line's. Each hole's line marked `golden` is recorded into src/sim/__tests__/levels-golden.ts.
 */
import type { RecordedGolden } from '../../src/sim/__tests__/levels-golden';
import { levelById } from '../../src/sim/levels/index';
import { encodeSnapshot } from '../../src/sim/serialize';
import type { GateColour, Level, PlayerId } from '../../src/sim/types';
import { heldList, newGame, shotsOf, takeShot, type Game, type Grid, type Shot, type ShotOutcome, type ShotSummary } from './game';

export type Beat = { readonly who: PlayerId; readonly what: string; readonly ok: (s: ShotSummary) => boolean };
export type ScriptedLine = {
  readonly levelId: string;
  readonly name: string;
  /** The hole's golden line (exactly one per hole): recorded by `recordGolden`. */
  readonly golden?: true;
  readonly beats: readonly Beat[];
};

const RED: PlayerId = 0;
const BLUE: PlayerId = 1;

/** No fall, no BACK +1, no watchdog, no stalled hand-off: an intended line never pays a penalty stroke. */
const clean = (s: ShotSummary): boolean => !s.fell && !s.partnerFell && !s.timedOut && s.resets === 0 && s.teeResets === 0 && s.timeouts === 0;
const past = (x: number) => (s: ShotSummary): boolean => clean(s) && s.restX > x;
const between = (a: number, b: number) => (s: ShotSummary): boolean => clean(s) && s.restX > a && s.restX < b;
const near = (x: number, d: number) => (s: ShotSummary): boolean => clean(s) && Math.abs(s.restX - x) < d;
const on = (id: string) => (s: ShotSummary): boolean => clean(s) && !s.sunk && s.switches[id] === true;
const sunk = (s: ShotSummary): boolean => s.sunk && !s.partnerFell && s.resets === 0 && s.teeResets === 0 && s.timeouts === 0;
/** The shooter rests caught in an armed trap / loaded in a cold cannon (D10.4). */
const caught = (s: ShotSummary): boolean => clean(s) && s.waiting === 'caught';
const loaded = (s: ShotSummary): boolean => clean(s) && s.waiting === 'loaded';
/** The shooter flew from a lit breech. */
const fired = (s: ShotSummary): boolean => clean(s) && s.fired;
/** The shooter's landing fired its LOADED partner. */
const firedPartner = (s: ShotSummary): boolean => clean(s) && s.partnerFired && s.partnerWaiting === null;
/** The shooter's landing opened its partner's trap (or the cup did). */
const freedPartner = (s: ShotSummary): boolean => clean(s) && s.partnerFreed && s.partnerWaiting === null;
const gate = (colour: GateColour) => (s: ShotSummary): boolean => s.gatePass.includes(colour);
const either = (...fns: ((s: ShotSummary) => boolean)[]) => (s: ShotSummary): boolean => fns.some((fn) => fn(s));
const both = (...fns: ((s: ShotSummary) => boolean)[]) => (s: ShotSummary): boolean => fns.every((fn) => fn(s));
const onGreenNoSand = (greenX: number) => (s: ShotSummary): boolean => past(greenX)(s) && !s.sand;

export const SCRIPTED_LINES: readonly ScriptedLine[] = [
  {
    levelId: 'w1-01-first-fairway',
    name: 'First Fairway',
    golden: true,
    beats: [
      // The main line asks for "over the hill, short of the green": a 3/4 swing lays up on the shelf
      // 580-800 and a full swing runs off its lip into the bunker (800-1010). The sand line below is the
      // strict "stops dead in the bunker" variant of the same hole.
      { who: RED, what: 'drive over the hill, short of the green (540-1120)', ok: between(540, 1120) },
      { who: BLUE, what: 'drive over the hill, short of the green (540-1120)', ok: between(540, 1120) },
      { who: RED, what: 'pitch over the sand onto the green or sink', ok: either(sunk, onGreenNoSand(1120)) },
      { who: BLUE, what: 'pitch over the sand onto the green or sink', ok: either(sunk, onGreenNoSand(1120)) },
      { who: RED, what: 'putt / gimme', ok: sunk },
      { who: BLUE, what: 'putt / gimme', ok: sunk },
    ],
  },
  {
    levelId: 'w1-01-first-fairway',
    name: 'First Fairway (sand line)',
    beats: [
      { who: RED, what: 'full drive runs into the bunker and stops dead (800-1010)', ok: both((s) => s.sand, between(790, 1020)) },
      { who: BLUE, what: 'full drive runs into the bunker and stops dead', ok: both((s) => s.sand, between(790, 1020)) },
      { who: RED, what: 'pitch out of the sand onto the green or sink', ok: either(sunk, past(1120)) },
      { who: BLUE, what: 'pitch out of the sand onto the green or sink', ok: either(sunk, past(1120)) },
      { who: RED, what: 'putt / gimme', ok: sunk },
      { who: BLUE, what: 'putt / gimme', ok: sunk },
    ],
  },
  {
    levelId: 'w1-02-two-doors',
    name: 'Two Doors',
    golden: true,
    beats: [
      { who: RED, what: 'red: park on the DOOR plate from the tee (dish 690-900): door opens', ok: on('door') },
      { who: BLUE, what: 'blue: roll through the open door and settle on the WINDOW plate', ok: both(past(940), on('window')) },
      { who: RED, what: 'red: lob through the open window from the plate (land past the wall)', ok: past(940) },
      { who: BLUE, what: 'blue: approach the cup (within 160 px) or sink', ok: either(sunk, near(1680, 160)) },
      { who: RED, what: 'red: approach the cup (within 160 px) or sink', ok: either(sunk, near(1680, 160)) },
      { who: BLUE, what: 'blue: sink', ok: sunk },
      { who: RED, what: 'red: sink', ok: sunk },
    ],
  },
  {
    levelId: 'w1-03-colour-keys',
    name: 'Colour Keys',
    golden: true,
    beats: [
      { who: BLUE, what: 'blue: lob through the BLUE field onto the DOOR 1 plate (bowl 650-1050)', ok: both(gate('blue'), on('door1')) },
      { who: RED, what: 'red: roll through the open door 1, finish close to wall 2 (900-1150)', ok: between(900, 1150) },
      { who: BLUE, what: 'blue: move up in front of wall 2 (1000-1150)', ok: between(1000, 1150) },
      { who: RED, what: 'red: lob through the RED field onto the DOOR 2 plate (bowl 1220-1610)', ok: both(gate('red'), on('door2')) },
      { who: BLUE, what: 'blue: roll through the open door 2 (x > 1200)', ok: past(1200) },
      { who: RED, what: 'red: approach / sink', ok: either(sunk, near(1740, 160)) },
      { who: BLUE, what: 'blue: approach / sink', ok: either(sunk, near(1740, 160)) },
      { who: RED, what: 'sink', ok: sunk },
      { who: BLUE, what: 'sink', ok: sunk },
    ],
  },
  {
    levelId: 'w1-04-plate-and-bridge',
    name: 'Plate & Bridge',
    golden: true,
    beats: [
      { who: RED, what: 'red: chip onto plate A (dish 350-520): bridge appears', ok: on('near') },
      { who: BLUE, what: 'blue: full swing from the tee across the bridge, rest on the deck or plate B', ok: both(past(544), either(on('deck'), on('far'))) },
      { who: RED, what: 'red: full swing from plate A, rest on plate B or the deck', ok: both(past(544), either(on('far'), on('deck'))) },
      { who: BLUE, what: 'blue: on to the far side (x > 1240) or sink', ok: either(sunk, past(1240)) },
      { who: RED, what: 'red: on to the far side or sink', ok: either(sunk, past(1240)) },
      { who: BLUE, what: 'blue: approach / sink', ok: either(sunk, near(1860, 160)) },
      { who: RED, what: 'red: approach / sink', ok: either(sunk, near(1860, 160)) },
      { who: BLUE, what: 'sink', ok: sunk },
      { who: RED, what: 'sink', ok: sunk },
    ],
  },
  {
    levelId: 'w1-04-plate-and-bridge',
    name: 'Plate & Bridge (deck line)',
    beats: [
      { who: RED, what: 'chip onto plate A: bridge appears', ok: on('near') },
      { who: BLUE, what: 'cross from the tee and rest ON THE DECK (544-1216)', ok: both(between(544, 1216), on('deck')) },
      { who: RED, what: 'stall tap: stay on plate A (partner on the deck must not fall)', ok: on('near') },
      { who: BLUE, what: 'from the deck onto plate B', ok: on('far') },
      { who: RED, what: 'cross the bridge (held by B)', ok: past(1240) },
      { who: BLUE, what: 'approach / sink', ok: either(sunk, near(1860, 160)) },
      { who: RED, what: 'approach / sink', ok: either(sunk, near(1860, 160)) },
      { who: BLUE, what: 'sink', ok: sunk },
      { who: RED, what: 'sink', ok: sunk },
    ],
  },
  {
    levelId: 'w2-05-spring-step',
    name: 'Spring Step',
    golden: true,
    beats: [
      { who: RED, what: 'red: park on the DOOR plate (dish 440-650): the door opens', ok: on('door') },
      { who: BLUE, what: 'blue: roll through the door onto the SPRING, land on TOP (holds the door)', ok: both(past(1200), on('top')) },
      { who: RED, what: 'red: leave DOOR (TOP holds it), roll through and ride the spring onto TOP', ok: both(past(1200), on('top')) },
      { who: BLUE, what: 'blue: chip down to the terrace or sink', ok: either(sunk, past(1461)) },
      { who: RED, what: 'red: chip down to the terrace or sink', ok: either(sunk, past(1461)) },
      { who: BLUE, what: 'blue: sink', ok: sunk },
      { who: RED, what: 'red: sink', ok: sunk },
    ],
  },
  {
    levelId: 'w2-06-booby-trap',
    name: 'Booby Trap',
    golden: true,
    beats: [
      { who: RED, what: 'red: lob LEFT onto the PERCH (bowl 170-330): the door opens', ok: on('perch') },
      { who: BLUE, what: 'blue: roll through the door into the FAR dish (holds the door, opens the trap)', ok: both(past(1020), on('far')) },
      { who: RED, what: 'red: drop off the perch and roll through the door', ok: past(1020) },
      { who: BLUE, what: 'blue: putt out about 400 px (the cup keeps FAR held)', ok: sunk },
      { who: RED, what: 'red: putt out', ok: sunk },
    ],
  },
  {
    levelId: 'w2-06-booby-trap',
    name: 'Booby Trap (rescue line)',
    beats: [
      { who: RED, what: 'red: a short lob LEFT rolls into the TRAP at the perch foot: CAUGHT', ok: caught },
      { who: BLUE, what: 'blue: rest on FREE: red is freed where it sits', ok: both(on('free'), freedPartner) },
      { who: RED, what: 'red: lob from the trap dish onto the PERCH', ok: on('perch') },
      { who: BLUE, what: 'blue: leave FREE, roll through the door into the FAR dish', ok: both(past(1020), on('far')) },
      { who: RED, what: 'red: drop off the perch and roll through the door', ok: past(1020) },
      { who: BLUE, what: 'blue: putt out (the cup keeps FAR held)', ok: sunk },
      { who: RED, what: 'red: putt out', ok: sunk },
    ],
  },
  {
    levelId: 'w2-07-load-and-fire',
    name: 'Load & Fire',
    golden: true,
    beats: [
      { who: RED, what: 'red: move up to the approach (650-790)', ok: between(650, 790) },
      { who: BLUE, what: 'blue: rest on the FIRE plate (dish 450-650): the cannon is lit', ok: on('fire') },
      { who: RED, what: 'red: lob into the funnel: BOOM, onto the far FIRE plate', ok: both(fired, on('fire-far')) },
      { who: BLUE, what: 'blue: leave FIRE (the far plate keeps the cannon lit), move up (650-790)', ok: between(650, 790) },
      { who: RED, what: 'red: putt out from the far plate (the cup keeps the cannon lit)', ok: sunk },
      { who: BLUE, what: 'blue: lob into the funnel: BOOM, across the chasm', ok: both(fired, past(1520)) },
      { who: BLUE, what: 'blue: putt out', ok: sunk },
    ],
  },
  {
    levelId: 'w2-07-load-and-fire',
    name: 'Load & Fire (load line)',
    beats: [
      { who: RED, what: 'red: move up to the approach (650-790)', ok: between(650, 790) },
      { who: BLUE, what: 'blue: move toward the FIRE dish (300-450)', ok: between(300, 450) },
      { who: RED, what: 'red: lob into the cold cannon: LOADED', ok: loaded },
      { who: BLUE, what: 'blue: rest on FIRE: red fires onto the far FIRE plate', ok: both(on('fire'), firedPartner, on('fire-far')) },
      { who: RED, what: 'red: putt out from the far plate (the cup keeps the cannon lit)', ok: sunk },
      { who: BLUE, what: 'blue: leave FIRE, move up (650-790)', ok: between(650, 790) },
      { who: BLUE, what: 'blue: lob into the funnel: BOOM, across the chasm', ok: both(fired, past(1520)) },
      { who: BLUE, what: 'blue: putt out', ok: sunk },
    ],
  },
  {
    levelId: 'w2-08-colour-lift',
    name: 'Colour Lift',
    golden: true,
    beats: [
      { who: BLUE, what: 'blue: lob through its field into the hopper: the SPRING bounces it off the red wall onto WINDOW', ok: both(gate('blue'), on('window')) },
      { who: RED, what: 'red: lob through the open WINDOW: the SPRING flies it through the red wall onto DOOR', ok: both(gate('red'), on('door')) },
      { who: BLUE, what: 'blue: roll through the open door (x > 1240)', ok: past(1240) },
      { who: RED, what: 'red: chip down to the terrace or sink', ok: either(sunk, past(1681)) },
      { who: BLUE, what: 'blue: chip down to the terrace or sink', ok: either(sunk, past(1681)) },
      { who: RED, what: 'sink', ok: sunk },
      { who: BLUE, what: 'sink', ok: sunk },
    ],
  },
  {
    levelId: 'w3-09-bait',
    name: 'Bait',
    golden: true,
    beats: [
      { who: RED, what: 'red: roll onto the BAIT plate in the channel: CAUGHT, the door is open', ok: both(on('bait'), caught) },
      { who: BLUE, what: 'blue: roll through the door past red into the yard (800-960)', ok: between(800, 960) },
      { who: BLUE, what: 'blue: lob into the raised spring: TOP frees red and holds the door', ok: both(on('top'), freedPartner) },
      { who: RED, what: 'red: roll out through the door into the yard (800-960)', ok: between(800, 960) },
      { who: BLUE, what: 'blue: chip down to the terrace or sink', ok: either(sunk, past(1561)) },
      { who: RED, what: 'red: lob into the raised spring up the cliff', ok: past(1241) },
      { who: BLUE, what: 'sink', ok: sunk },
      { who: RED, what: 'red: chip down / sink', ok: either(sunk, past(1561)) },
      { who: RED, what: 'sink', ok: sunk },
    ],
  },
  {
    levelId: 'w3-10-sky-bridge',
    name: 'Sky Bridge',
    golden: true,
    beats: [
      { who: BLUE, what: 'blue: chip LEFT into the cold cannon: LOADED', ok: loaded },
      { who: RED, what: 'red: ride the SPRING onto A: bridge up, cannon lit, blue fired onto B', ok: both(between(640, 820), on('a'), firedPartner, on('b')) },
      { who: BLUE, what: 'blue: putt out from B (the cup keeps B held)', ok: sunk },
      { who: RED, what: 'red: cross the bridge from A onto the far spire', ok: past(1580) },
      { who: RED, what: 'red: putt out', ok: sunk },
    ],
  },
  {
    levelId: 'w3-10-sky-bridge',
    name: 'Sky Bridge (spring route)',
    beats: [
      { who: BLUE, what: 'blue: ride the SPRING onto A: the bridge appears', ok: both(between(640, 820), on('a')) },
      { who: RED, what: 'red: ride the SPRING onto A too', ok: both(between(640, 820), on('a')) },
      { who: BLUE, what: 'blue: cross onto B or the DECK', ok: both(past(860), either(on('b'), on('deck'))) },
      { who: RED, what: 'red: cross the bridge onto the far spire', ok: past(1580) },
      { who: BLUE, what: 'blue: off the deck onto the far spire (the far ball holds the bridge) or sink', ok: either(sunk, past(1580)) },
      { who: RED, what: 'red: putt out', ok: sunk },
      { who: BLUE, what: 'blue: putt out', ok: sunk },
    ],
  },
  {
    levelId: 'w3-11-crossfire',
    name: 'Crossfire',
    golden: true,
    beats: [
      { who: RED, what: 'red: move up toward the red field (590-690)', ok: between(590, 690) },
      { who: BLUE, what: 'blue: lob LEFT through its field onto the FIRE ledge: the cannon is lit', ok: both(gate('blue'), on('fire')) },
      { who: RED, what: 'red: lob through the red field into the cannon: BOOM, onto FAR (the door opens)', ok: both(gate('red'), fired, on('far')) },
      { who: BLUE, what: 'blue: drop off the ledge toward the door (270-700)', ok: between(270, 700) },
      { who: RED, what: 'red: approach / sink', ok: either(sunk, near(1860, 160)) },
      { who: BLUE, what: 'blue: roll through the door into the cannon: BOOM, across', ok: both(fired, past(1460)) },
      { who: RED, what: 'sink', ok: sunk },
      { who: BLUE, what: 'approach / sink', ok: either(sunk, near(1860, 160)) },
      { who: BLUE, what: 'sink', ok: sunk },
    ],
  },
  {
    levelId: 'w3-12-grand-machine',
    name: 'Grand Machine (fly)',
    golden: true,
    beats: [
      { who: RED, what: 'red: lob LEFT into the cold cannon: LOADED', ok: loaded },
      { who: BLUE, what: 'blue: rest on FIRE: red fires onto TOP', ok: both(on('fire'), firedPartner, on('top')) },
      { who: RED, what: 'red: chip down from TOP and sink (the cup keeps the cannon lit)', ok: sunk },
      { who: BLUE, what: 'blue: lob LEFT into the cannon: BOOM, onto TOP', ok: both(fired, on('top')) },
      { who: BLUE, what: 'blue: chip down from TOP and sink', ok: sunk },
    ],
  },
  {
    levelId: 'w3-12-grand-machine',
    name: 'Grand Machine (climb)',
    beats: [
      { who: RED, what: 'red: roll onto the DOOR plate in its seat: CAUGHT, the door is open', ok: both(on('door'), caught) },
      { who: BLUE, what: 'blue: roll through the door onto the SPRING, land on TOP: red is freed', ok: both(past(1215), freedPartner) },
      { who: RED, what: 'red: roll through the door (TOP holds it) and climb', ok: past(1215) },
      { who: BLUE, what: 'blue: approach / sink', ok: either(sunk, near(1850, 160)) },
      { who: RED, what: 'red: approach / sink', ok: either(sunk, near(1850, 160)) },
      { who: BLUE, what: 'sink', ok: sunk },
      { who: RED, what: 'sink', ok: sunk },
    ],
  },
];

export function scriptedLinesOf(level: Level): readonly ScriptedLine[] {
  return SCRIPTED_LINES.filter((l) => l.levelId === level.id);
}

export type ScriptedBeatResult = { readonly who: PlayerId; readonly what: string; readonly shot: Shot | null; readonly candidates: number; readonly restX: number | null; readonly sunk: boolean; readonly held: readonly string[] };
export type ScriptedResult = {
  readonly name: string;
  readonly bothSunk: boolean;
  readonly strokes: readonly [number, number];
  readonly total: number;
  readonly beats: readonly ScriptedBeatResult[];
  readonly failedAt: string | null;
  /** The finished game: its `log` replays the line (golden replays in levels.test.ts). */
  readonly game: Game;
};

/** Replays an intended line: each beat takes the FIRST grid shot satisfying its predicate (an upper bound on the line). */
export function replayScripted(level: Level, line: ScriptedLine, grid: Grid): ScriptedResult {
  let game = newGame(level);
  const beats: ScriptedBeatResult[] = [];
  let failedAt: string | null = null;
  for (const beat of line.beats) {
    if (game.state.balls[beat.who].sunk) continue;
    if (game.state.activePlayer !== beat.who) {
      failedAt = `${beat.what} (sim says P${game.state.activePlayer + 1} is up, line says P${beat.who + 1})`;
      break;
    }
    let found: ShotOutcome | null = null;
    let candidates = 0;
    for (const shot of shotsOf(grid)) {
      const r = takeShot(game, shot);
      if (r === null || !beat.ok(r.summary)) continue;
      candidates += 1;
      if (found === null) found = r;
    }
    if (found === null) {
      beats.push({ who: beat.who, what: beat.what, shot: null, candidates: 0, restX: null, sunk: false, held: [] });
      failedAt = beat.what;
      break;
    }
    game = found.game;
    beats.push({ who: beat.who, what: beat.what, shot: found.summary.shot, candidates, restX: Math.round(found.summary.restX), sunk: found.summary.sunk, held: heldList(found.summary.switches) });
  }
  const strokes = game.state.players.map((p) => p.strokes) as [number, number];
  return { name: line.name, bothSunk: game.state.balls.every((b) => b.sunk), strokes, total: strokes[0] + strokes[1], beats, failedAt, game };
}

// ---------------------------------------------------------------------------------------------
// Golden lines (src/sim/__tests__/levels-golden.ts owns their shape)
// ---------------------------------------------------------------------------------------------

/** The hole's golden line (the scripted line marked `golden`). */
export function goldenLineOf(level: Level): ScriptedLine {
  const lines = scriptedLinesOf(level).filter((l) => l.golden === true);
  const line = lines[0];
  if (line === undefined || lines.length > 1) throw new Error(`solver: ${level.id} needs exactly one golden scripted line (has ${lines.length})`);
  return line;
}

/** The golden entry of a finished replay of the hole's golden line, named after the hole. */
export function goldenOf(level: Level, replay: ScriptedResult): RecordedGolden {
  if (!replay.bothSunk || replay.failedAt !== null) throw new Error(`solver: the golden line of ${level.id} does not finish (${replay.failedAt ?? 'balls not sunk'})`);
  const state = replay.game.state;
  return { levelId: level.id, name: level.name, strokes: replay.strokes, finalTick: state.tick, snapshot: JSON.stringify(encodeSnapshot(state)), log: replay.game.log };
}

/** The golden recipe: replayScripted of the hole's golden line on `grid` (the 16 x 8 cell grid). */
export function recordGolden(level: Level, grid: Grid): RecordedGolden {
  return goldenOf(level, replayScripted(level, goldenLineOf(level), grid));
}

/** A JS literal in the repo's house style (single quotes, spaces inside braces); the values here are plain data. */
function literal(value: unknown): string {
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
  if (typeof value === 'object' && value !== null) {
    const fields = Object.entries(value).map(([k, v]) => `${k}: ${literal(v)}`);
    return fields.length === 0 ? '{}' : `{ ${fields.join(', ')} }`;
  }
  throw new Error(`solver: cannot write ${typeof value} into levels-golden.ts`);
}

export const GOLDEN_BEGIN = '// @generated-begin: npm run solve -- all --write-goldens (scripts/solver.ts); never edit by hand';
export const GOLDEN_END = '// @generated-end';

/** The generated block of levels-golden.ts: `RECORDED` in campaign (registry) order. */
export function goldenBlock(goldens: readonly RecordedGolden[]): string {
  const sorted = [...goldens].sort((a, b) => levelById(a.levelId).order - levelById(b.levelId).order);
  const entries = sorted.map((g) =>
    [
      '  {',
      `    levelId: ${literal(g.levelId)},`,
      `    name: ${literal(g.name)},`,
      `    strokes: ${literal(g.strokes)},`,
      `    finalTick: ${g.finalTick},`,
      `    snapshot: ${literal(g.snapshot)},`,
      '    log: [',
      ...g.log.map((e) => `      ${literal(e)},`),
      '    ],',
      '  },',
    ].join('\n'),
  );
  return [GOLDEN_BEGIN, 'const RECORDED: readonly RecordedGolden[] = [', ...entries, '];', GOLDEN_END].join('\n');
}

/** levels-golden.ts with its generated block replaced (everything outside the markers is kept verbatim). */
export function withGoldenBlock(source: string, goldens: readonly RecordedGolden[]): string {
  const begin = source.indexOf(GOLDEN_BEGIN);
  const end = source.indexOf(GOLDEN_END);
  if (begin < 0 || end < begin) throw new Error('solver: levels-golden.ts has no generated block (markers missing)');
  return `${source.slice(0, begin)}${goldenBlock(goldens)}${source.slice(end + GOLDEN_END.length)}`;
}
