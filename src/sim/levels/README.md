# World 1 "Teach" — levels (owner: LEVELS group)

One file per level, `w1-0N-<slug>.ts`, each `export const level: Level = compileLevel({...})`. The id is the
file name without `.ts` and equals `w1-0N-<slug of the name>`; `index.ts` registers the four in campaign
order (`LEVELS`, `WORLD1_IDS`, `levelById`, `hasLevel`, `coursePar`, `campaignFrom`, `worldTitle`).
Level-id literals live ONLY in this directory; the UI and storage go through `WORLD1_IDS` / `LEVELS`.

| # | id | name | size | par | first | holds | new idea |
|---|---|---|---|---|---|---|---|
| 1 | `w1-01-first-fairway` | First Fairway | 1280 × 720 | 6 | red | — | sand (aim, power, cup, gimme, turns) |

Every hole also carries a BACK BUNKER: a sand band from 50-60 px behind the cup to the right level edge
(`back-bunker` in each file), so an overhit approach stops in sand to be pitched back instead of banking off
the level edge (WALL_RESTITUTION 0.45, 90-120 px behind every cup) into the hole; `mechanicsPresent` therefore
lists `sand` on all four holes.
| 2 | `w1-02-two-doors` | Two Doors | 1800 × 720 | 7 | red | cup → `window` | held plate + blocker gate |
| 3 | `w1-03-colour-keys` | Colour Keys | 1860 × 720 | 8 | **blue** | cup → `door2` | colour gate |
| 4 | `w1-04-plate-and-bridge` | Plate & Bridge | 1960 × 720 | 7 | red | cup → `far` | bridge (typed `switch`, see below) |

Course par 28 (LEVELS.md authored 6 / 7 / 9 / 8 = 30; the re-verification against the real sim moved Colour Keys
and Plate & Bridge down one each, see "Pars" at the end). Everything is verified for `SHOT_SPEED_PER_POWER = 6.5` (max launch 650 px/s, vacuum range
681 px, apex 341 px): walls are 420 px above the fairway (ball centre would need y 188, best reachable ≈ 265)
and the chasm is 720 px (needs 693 px of carry). Source: `design/FINAL/levels/LEVELS.md`, reconciled by
`design/FINAL/BUILD_DECISIONS.md` (D1, D2).

## Authoring vocabulary (`authoring.ts`)

`compileLevel(def)` resolves the designer's description against the **fairway** (the lowest terrain piece at
an x), quantises compiled y values with `quantize2` and derives `mechanicsPresent`; it throws with every
`validateLevel` message when a definition is invalid, so a bad level fails at module load, not in play.

| LEVELS.md word | types.ts | PropDef / SwitchDef |
|---|---|---|
| wall | `blocker` without a switch (permanent) | `{ kind: 'blocker', centerX, h, bottom }` |
| door / window | `blocker` with `switchId`, `activeWhen: false` (solid until held) | `{ kind: 'blocker', ..., switchId, activeWhen: false, label }` |
| colour field | `colourGate` | `{ kind: 'colourGate', centerX, h, bottom, colour }` |
| plate | `PressureSwitch` (HELD: pressed while a RESTING (asleep) ball's centre is inside `[x, x+w]`; released the tick the holder moves, so a moving ball presses nothing) | `{ id, centerX, w, colour: SWITCH_COLOUR, label }` |
| deck plate | `PressureSwitch.onRectId` = the bridge; `surfaceY` = the bridge top | `{ ..., onRectId: 'bridge' }` |
| dish / bowl | ordinary terrain polyline, 20 px deep, 50 px ramps (≈ 22°, above `REST_MAX_SLOPE`, so balls roll back onto the flat plate) | surface points |
| bridge | one `bridge` rect, `x = gap.x1`, `w = gap width`, top = mean lip height, `switchIds` (OR) | `{ kind: 'bridge', gap, switchIds, label: 'BRIDGE' }` |
| sand | flush `sand` range | `{ kind: 'sand', x1, x2 }` |

Walls are stacked: the field (200–520) stands on the door (520–640), the L2 cap (200–350) on the window
(350–520) on the door. A wall foot sinks `WALL_EMBED_PX` (20) below the fairway so a door that closes on a
resting ball ejects it SIDEWAYS (nearest face) and never down into the dirt (D2). `validateLevel` accepts a
wall that stands on the fairway (foot within `[fairway − 2, fairway + 20]`) or on another wall rect.

### Validity rules (`validateLevel`, all tested in `levels.test.ts`)

height 720 · 1280 ≤ width ≤ `MAX_LEVEL_WIDTH` · wind 0 in world 1 · par ≥ 3 · non-empty name/hint/aha/watchOut ·
exactly one `mechanicsIntroduced`, present in `mechanicsPresent`, which equals the kinds actually present
(switches ⇒ `switch`) · `cupHoldsSwitch` resolves · pieces: strictly increasing x, ≥ 2 points, `baseY` below
the surface; overlapping pieces are consistently STACKED (seam ≤ 1 px) or an OVERHANG (clearance ≥ 48) ·
gaps: nothing covers the inside, a piece ends at `x1` and one starts at `x2` · tees, plates and the cup sit on
the fairway (not under a stacked piece), slope ≤ `RESTABLE_MAX_SLOPE`, outside gaps and fans; tees ≥ 50 px
apart; a plate's `surfaceY` matches the fairway along its whole width · every `switchId`/`switchIds` resolves
and every switch is referenced by a rect or the cup · a bridge starts at a gap, spans it, sits within 3 px of
both lips and has `switchId` or a non-empty `switchIds` · a deck plate's `onRectId` is a bridge/blocker, the
plate lies inside it and `surfaceY` equals its top · walls ≥ `MIN_WALL_HEIGHT`, grounded or stacked · pads
not in gaps and not overlapping; springs launch upward within `MAX_BALL_SPEED` · ids kebab-case and unique.
`levelWarnings` carries the non-fatal "spring launches straight up" advice.

### Why L4 introduces `bridge`

`IntroducedMechanic` originally stopped at `'switch'` (the bridge being an effect of a plate), which made the
title tray and the intro card say "NEW: PRESSURE SWITCH" on both hole 2 and hole 4. Integration widened the
union additively with `'bridge'`, so Plate & Bridge is typed `mechanicsIntroduced: ['bridge']` (with `switch`
and `bridge` in `mechanicsPresent`) and the four levels introduce four distinct ideas; the intro-card copy is
`MECHANIC_COPY.bridge`.

### Deviations from LEVELS.md numbers

- Tees: L1 90/140 (was 90/130) and L4 245/295 (was 250/290) because `MIN_TEE_SEPARATION` is 50 px; both pairs
  stay on their flats. L2/L3 (100/150) were already 50 apart.
- L1 shelf 580–810 (LEVELS.md: a straight downslope 540 → 840). Every segment of that slope was steeper than
  the friction-equivalent slope `ROLL_FRICTION / (GRAVITY · SLOPE_GRAVITY_SCALE)` = tan 0.114, so no ball could
  come to rest between the crest and the sand and the "¾ swing stops at 600–860" lay-up did not exist (0 of
  162 human-grid drives and 0 of 729 fine-sweep drives rested on 600–840; rest x jumped from ~530 to ~875
  at one power step). The crest (540, 52 px) now drops 18 px onto a flat shelf 580–810 whose lip falls 34 px
  into the bunker. Human grid from the tees: 8 / 11 of 162 lay up on the shelf outside the sand, 32–35 run
  off the lip into the bunker, 43–44 rest on the hill, 0 reach the green; the fine sweep lays up at power
  69–77 at 10–45° (a ¾ swing) and runs into the sand from 78 up. Flat shelves with a 34–48 px drop and
  up-sloping shelves were tried first: the big drop rolls every crester to the sand, the up-slope lofts a
  bouncing full drive over it (3–9 aces).
- L1 bunker 800–1010 (LEVELS.md 870–1010; the first rebuild 840–1010): the sand starts 10 px before the
  shelf lip at 810 so the lip bounces with sand restitution. With a grass lip a 26–27° full drive from the
  blue tee skipped once off it, cleared the sand and ran in (1 ace in 858); with the sandy lip 0/858 from
  both tees.
- Back bunkers (all four holes, see the table): L1 1240–1280, L2 1740–1800, L3 1800–1860, L4 1910–1960.
  Measured on the human grid from each hole's natural approach position, the level edge returned 45 / 47 /
  36 / 33 of the 70 / 72 / 56 / 53 hole-outs as bank-ins and only 3 / 3 / 3 / 23 of 162 approaches rested
  within 90 px of the cup; with the back sand those approaches sink 40 / 38 / 27 / 36, rest within 90 px
  33 / 17 / 19 / 40 and stop in the back sand 26 / 36 / 32 / 30 (a pitch back). The edge is still a wall
  (physics-notes keeps `levelEdge` at 0.45; an airborne ball can still bank off it and land past the sand),
  but it no longer rescues the long miss. Every back bunker starts > `GIMME_RADIUS` from the cup and within
  `NEAR_CUP_RADIUS` (asserted in `levels.test.ts`).
- Pars: Colour Keys 9 → 8 and Plate & Bridge 8 → 7 (the ±1 BUILD_DECISIONS D2 allows), with the evidence in
  "Pars" at the end of this file. First Fairway 6 and Two Doors 7 stand.
- Bridge top = mean of the two lip heights (620), not "1 px below the lips": the new terrain is solid and
  the ARCH formula wins. Plank thickness 18 (VISUAL.md).
- `watchOut` is player-facing copy (the pause menu "Stuck?" tip): the LEVELS.md watch-outs, which carry
  solver percentages, are summarised below and in the file comments.
- Plate-to-cup distance: D1 says "≥ 500 px"; the geometry gives 830 / 500 (L2), 740 / 180 (L3), 1390 / 644 /
  320 (L4). The test asserts the property that matters: every plate edge is further than
  `GIMME_RADIUS + NEAR_CUP_RADIUS` from the cup, so a holder can never be conceded.

## Walkthroughs

### 1 · First Fairway (par 6, red first, no switches)

Surface `[0,590] … [540,538] (crest) [580,556] [810,556] (shelf) [840,590] [1020,590] (bunker 800–1010)
[1060,578] [1120,562] [1280,562] (green, back bunker 1240–1280)`, cup 1190. Drive over the hill: a full swing
runs across the shelf, off its lip and into the bunker where it stops dead (the sand lesson); a ¾ swing
(power ~70–77) lays up on the shelf; a softer swing rests on the hill. Pitch 300–550 px over the sand onto
the green, putt or gimme; a blasted putt stops in the back bunker. 3 + 3. Solver minimum 2 + 2 (a sand or
shelf landing then a hole-out). Watch-out: full power every time lands in the sand without connecting
"stopped dead" to the bunker; the SAND sticker and `enterSand` callout carry it. Aces: 0/429 shots from
either tee (267 continuous-aim at power 95–100 + the 162-shot human grid).

### 2 · Two Doors (par 7, red first and HOLDS first, cup holds `window`)

Floor 620. Wall x 900–940: permanent cap 200–350, WINDOW gate 350–520 (switch `window`), DOOR gate 520–640
(switch `door`). DOOR plate 740–850 on the floor of the dish 690–900 (far rim = the wall). WINDOW plate
990–1180 in the dish 940–1230 right behind the wall (where a ball rolling through the door stops). Humps at
460 (14 px) and 1400 (20 px); raised green 1600–1800 at y 600, cup 1680 (500 px from the WINDOW plate).
Line: red parks on the DOOR plate → door opens → blue rolls through low (5–20°, power 70–90) and settles on
the WINDOW plate → window opens → red lobs through the window (50–60°, 90–100) → both approach and sink.
Watch-outs: the first ball through plays on toward the cup instead of settling on the WINDOW plate (the
holder is stuck until it comes back or sinks: `cupHoldsSwitch`); the holder must shoot before the partner is
through → stall tap (straight up, low power), taught by the L2 holder toast (UX).

### 3 · Colour Keys (par 8, BLUE first, cup holds `door2`)

Floor 620. Wall 1 x 440–480: BLUE field 200–520 over DOOR 1 gate 520–640 (switch `door1`, plate 700–1000 in
the bowl 650–1050 BEHIND the wall). Wall 2 x 1160–1200: RED field over DOOR 2 gate (switch `door2`, plate
1270–1560 in the bowl 1220–1610). Green 1660–1860 at y 596, cup 1740. Line: blue lobs from the tee (55–70°,
80–100) through the blue field into the first bowl → DOOR 1 opens → red rolls through door 1 (5–20°, 80–100)
finishing near wall 2 → blue moves up → red lobs the red field (45–70°, 80–100) into the far bowl → DOOR 2
opens → blue rolls through → both chip and sink. Watch-outs: red tries to lob wall 1 and bounces off the
blue field (roll low); red lobs the red field from too far back (works within ~250 px of the wall); red
leaves the DOOR 2 plate early (red can come back through its own field; a sunk red holds door 2).

### 4 · Plate & Bridge (par 7, red first and HOLDS first, cup holds `far`)

Near piece `[0,624] … [220,630] [320,630] (tee flat) [350,620] [400,640] [470,640] [520,620]` (plate A dish
350–520, lip 520); gap 520–1240 (720 px); far piece `[1240,620] [1256,620] [1272,628] [1540,628] (plate B
bowl) [1560,620] … [1800,584] [1920,584] (green, cup 1860) [1960,590]`. Plate A `near` 400–470, plate B `far`
1272–1540, bridge 520–1240 top 620 active while `near` OR `far` OR `deck` is held, DECK plate 544–1216
(inset 24 px from both lips) on top of the bridge. Line: red chips onto plate A (bridge appears) → blue takes
a full swing from the tee and rests on the deck or in the far bowl → red crosses from plate A → whoever is
on the deck flies off (the partner on B or the deck holds) → both putt out. Watch-outs: the tee chip
overshoots plate A into the chasm (+1, respawn on the tee flat); a deck ball tries to ROLL off while nobody
else holds: the deck is held only while that ball is parked, so the planks vanish the tick it moves and it
must FLY all the way to the far lip (from the deck centre a 45° lob at power 80+ carries; every roll of
≤ 7° drops into the chasm, `deck-lone-roll-falls`); the ball on plate B putts out before the partner is
across (`cupHoldsSwitch: 'far'`).

## Verification recipe (`scripts/solver.ts`, built on the real sim)

```
npm run solve -- all --json <out.json>                                   # every pass: beam 6 + wide beam 60, ~9 min
npm run solve -- w1-03-colour-keys --pass coop,wide --wideBeam 120       # a deeper co-op search
npm run solve -- w1-04-plate-and-bridge --pass gaps,stall,deck
npm run test:levels                                                      # levels-solver.test.ts (slow, ~12 min)
```

The solver drives full two-ball games with `createSim` / `stepSim` (turn order, held plates, `cupHoldsSwitch`,
partners falling off a vanished bridge), proves every solved line with `runReplay`, sweeps single shots with
`predictShot` (the partner passed as `otherBalls`) and asks `evaluateSwitches` who presses what. Shots are
designer units (degrees above the horizontal, power 10–100) quantised through `aimOf` exactly like the client.
Passes and pass criteria (exit code 1 when any fails):

- `coop` — bucketed beam search over `stepSim` (16 angles × 8 powers, beam 6 per bucket, depth ≥ 8; buckets =
  sunk flags × held switches × active player): both balls sunk within par + 3; the solved line's command log
  re-run through `runReplay` reproduces the state exactly (`replay-deterministic`).
- `wide` — the same search at beam 60 (`--wideBeam`); its minimum calibrates par: `par − 2 ≤ minimum ≤ par`
  (`par-calibrated`, the LEVELS.md rule "par = scripted line, at most solver minimum + 2"; `PAR_SLACK_BY_ORDER`
  in the solver carries the one documented exception, hole 3 at slack 3, shared with the test).
- `solo` — `predictShot` chains (depth 10, beam 40) with the partner parked on its tee: holes 2–4 unsolved
  for both balls and 0 first-shot sinks; hole 1 solvable (reference).
- `aces` — 0 one-shot sinks or gimmes from either tee: the full fine sweep (1–89° step 1 × power 95/97/100 =
  267 shots) plus the 162-shot human grid (5–90° step 5 × power 20–100 step 10).
- `walls` — with every switch off, the blocked ball never passes a wall column (fine + human grids from the
  tee and from 600/400/250/120/60 px short of the wall); the report prints the highest ball-centre y reached.
- `gaps` — with no plate held, 0 crossings of the chasm from the tee and from 300/200/100/40 px short of the
  lip; a lone ball leaving plate A drops the bridge the tick it moves (a plate is held only by a resting
  ball) and never rests beyond the far lip.
- `scripted` — the LEVELS.md intended lines (plus the L1 sand line and the L4 deck line) replay beat by beat:
  each beat takes the FIRST grid shot satisfying its predicate (an upper bound on the line) and both balls
  must be sunk within par + 2.
- `stall` — holder taps (90/10, 90/15, 80/20, 100/15) re-hold the plate; a partner parked on its tee, on
  another plate or on the bridge deck never falls.
- `deck` — balls resting 1–24 px outside either lip never press DECK; every on-deck rest does; a lone deck
  ball (`{deck}` held, partner on its tee) shot from the near end, the centre and 240 px short of the far lip
  drops into the chasm on every roll of ≤ 7° at power 40–100 (`deck-lone-roll-falls`) and at least one 45°
  lob at power 80–100 reaches the far side (`deck-lone-lob-crosses`): the rule the L4 watchOut teaches.

`src/sim/__tests__/levels-solver.test.ts` runs `verifyLevel` once per level and asserts each criterion in its
own `it` (`npm run test:levels`); `levels.test.ts` (fast) replays each hole's scripted line from the frozen log
in `levels-golden.ts` through `runReplay` and compares the final snapshot bit for bit.

### Final table (re-verification against the SIM delivery of 2026-10-02, `npm run solve -- all`)

| hole | par | co-op beam 6 | wide beam 60 | solo P1 / P2 (reachableX) | aces | walls | gaps | scripted | stall | deck |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 First Fairway | 6 | 4 (2+2) | 4 (2+2), 22 021 shots | 2 / 2 by design (1190) | 0/429 · 0/429 | — | — | 4 · sand line 4 | — | — |
| 2 Two Doors | 7 | 5 (3+2) | 5 (3+2), 86 020 shots | NO 850 / NO 850 | 0/429 · 0/429 | 0/6006, highest y 264 | — | 5 | 16/16 | — |
| 3 Colour Keys | 8 | 5 (2+3) | 5 (2+3), 60 550 shots | NO 428 / NO 1148 | 0/429 · 0/429 | 0/5577, highest y 273 | — | 7 | 16/16 | — |
| 4 Plate & Bridge | 7 | 5 (3+2) | 5 (3+2), 93 572 shots | NO 470 / NO 469 | 0/429 · 0/429 | — | 0/4290 crossings, lone ball falls 5/5 | 9 · deck line 8 | 24/24 (8 with a partner on the deck, 8 with one on the other plate) | 0/48 lip, 15/15 deck |

Every criterion passes on every hole (`par-calibrated` on Colour Keys with the documented slack, below); every
solved co-op line and every scripted line replays bit-exactly through `runReplay`. Highest ball centre against
a 420 px wall: y 264 (wall top 200, the centre would need y 188): 76 px of margin. Gap: 3361 falls, 0
crossings, with the bridge absent.

Solver lines (degrees/power → rest x; `[held]`):

- L1: P1 18/94 → 909 · P2 29/94 → 944 · P1 7/72 SINK · P2 7/61 SINK.
- L2: P1 7/61 → 844 [door] · P2 29/83 → 1111 [door, window] · P1 73/72 → 1123 [window] · P2 7/72 SINK · P1 7/72 SINK.
- L3: P2 62/83 → 928 [door1] · P1 151/94 → 999 (a bank off the LEFT level edge through the open door 1) ·
  P2 73/61 → 1142 · P1 51/94 SINK (the red-field lob holes out; the cup now holds DOOR 2) · P2 7/72 SINK.
- L4: P1 7/38 → 434 [near] · P2 18/72 → 1190 [deck] · P1 18/94 → 1668 · P2 7/83 SINK [far] · P1 7/49 SINK.

Scripted lines (first grid shot per beat): L1 7/83 → 889 (sand) · 7/72 → 880 (sand) · 7/83 SINK · 7/83 SINK.
L2 red 7/61 → 844 [door] · blue 7/83 → 1057 [window] · red 73/72 → 1123 · blue 7/83 SINK · red 7/72 SINK.
L3 blue 40/94 → 744 [door1] · red 7/49 → 952 · blue 7/61 → 1054 · red 51/83 → 1359 [door2] · blue 7/16 → 1502 ·
red 7/72 SINK · blue 7/61 SINK. L4 red 7/38 → 434 [near] · blue 7/49 → 716 [deck] · red 7/38 → 649 [deck] ·
blue 7/49 → 1519 [far] · red 7/49 → 1482 [far] · blue 7/61 → 1779 · red 7/61 → 1780 · blue 7/16 SINK · red 7/16 SINK.

### Pars

LEVELS.md's rule: par is the scripted intended line, at most solver minimum + 2, never below the minimum
(gold = one great shot, silver = the line, bronze absorbs a duff per ball). Every solver minimum below is
STRUCTURAL (turn order and the mechanics force it; beam 6 and beam 60 agree and no geometry change within
the 1960 px overview width can raise it):

| hole | minimum | why it is the floor | scripted | LEVELS.md par | shipped par |
|---|---|---|---|---|---|
| 1 | 4 | no ace from either tee, so 2 + 2 (sand landing, hole-out from the sand) | 4 | 6 | **6** (4 ∈ 4..6) |
| 2 | 5 | red parks, lobs the window, sinks (3); blue rolls through onto the WINDOW plate, sinks (2) | 5 | 7 | **7** (5 ∈ 5..7) |
| 3 | 5 | blue lobs onto DOOR 1 plate, must shoot once while DOOR 2 is shut, rolls in (3); red rolls through DOOR 1, lobs the red field and holes out, which holds DOOR 2 from the cup (2) | 7 | 9 | **8** (D2's −1; 5 is par − 3) |
| 4 | 5 | red chips onto A, crosses, sinks (3); blue crosses, sinks (2) | 9 · deck 8 | 8 | **7** (5 ∈ 5..7) |

Colour Keys is the one hole where the rule cannot be met inside BUILD_DECISIONS D2's ±1: the real roll
(twice the old build's) collapses "chip to the green, then putt" into one roll-in from either bowl, and
`cupHoldsSwitch: 'door2'` (D2) lets red's field lob hole out instead of resting on the DOOR 2 plate. The
rule's answer is par 7 (the scripted line); D2 caps the change at 8. `scripts/solver.ts` encodes the exception
explicitly (`PAR_SLACK_BY_ORDER`, slack 3 for hole 3; the test and the CLI criterion share it) so a lead
decision to waive the cap is a one-line change there plus `par: 7` in the level file. Human play is slower
than the grid: the blue lob onto the DOOR 1 plate succeeds for about 7 % of human-grid shots, so a typical pair
still finishes Colour Keys around 9–10 and the pars read as "silver for a clean pair, gold for one hole-out".
