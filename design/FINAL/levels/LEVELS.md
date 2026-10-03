# World 1 "Teach" — FINAL level set (synthesis)

Files in this directory: `levels.ts` (exports `levels: Level[]`, `meta: LevelMeta[]`, `SHOT_SPEED_PER_POWER`;
built with the current project helpers so `tools/solver.ts` can verify it), `solver.json` + `solver-beam6.log`
(official solver, prescribed flags), `solver-beam120.json` + `.log` (official solver, `--depth 10 --beam 120`),
`verify-lines.ts/.json/.txt` (beat-by-beat replay of every intended line, partner stepped every tick),
`sweep.ts` + `sweep-results.txt` (human-range sweeps to power 100), `stall-check.ts/.txt` (decision-19 checks),
`exp-door.ts` (door-height experiment), `replay-paths.ts` (prints the solver's lines with rest positions),
`svg/level-{1..4}.svg|png` (overviews).

## Which proposal won, what was swapped in

**Winner: the FLOW proposal** (ranked first by two of the three judges). Its door/window wall vocabulary, its
"plate flush against the wall" forgiveness, its official-solver certification method and its `verify-lines`
replay structure are the spine of the final set. Changes:

| # | Final level | Provenance | What changed vs. the source |
|---|---|---|---|
| 1 | **First Fairway** | **swapped in from PUZZLE L1** (one-screen 1280×720 hill + bunker + raised green), replacing flow's 1680 px Rolling Start | bunker 140 px; green approach flattened; sand framed as a hazard to pitch over, never a landing pad |
| 2 | **Two Doors** | flow L2 | wall 380 → **420 px** (top y 200); both plates in **dishes** (puzzle graft; the door dish's far rim is the wall face so overshoots bounce back in); WINDOW dish starts right behind the wall; cup one full shot from the WINDOW plate; gentle humps; hint says RESTING |
| 3 | **Colour Keys** | flow L3's field-over-door walls **restructured into PUZZLE L3's mutual unlock** (the plate that opens MY door is behind YOUR colour's field) | removes the "tap in place on DOOR 2 to keep holding" beat that the judges flagged as untaught; fields 420 px; plates in bowls; blue goes first; the line is a leapfrog with no waiting stroke |
| 4 | **Plate & Bridge** | **swapped in from TEACH L3**, replacing flow's Sky Green (whose line was only verifiable under the pogo spring the brief forbids) | gap 660 → **720 px** (the drag-free rebuilt physics cannot fly 681 + 12); plate A in a dish whose far rim is the lip; **deck plate inset 24 px** from both lips (a ball resting at the lip must not hold the deck, which the solver found and exploited); tees on a flat 230 px behind the lip |

Curve: sand → held plate + blocker gate → colour field → bridge. Exactly one new idea per level; plates/doors are
reused from L2 onward. Spring, bumper and fan do not appear in World 1 (sim + renderer must still implement and
unit-test them for World 2, or ARCHITECTURE.md descopes them explicitly).

## Shot speed: `SHOT_SPEED_PER_POWER = 6.5` (every level, every solver run)

Measured with the real `stepBall` (gravity 620, 1/60 step, current 0.998/step air drag) at power 100: apex 335 px
(ball centre), 45° first landing 619 px, rest 661-985 px depending on surface. Vacuum (drag-free) values that the
rebuilt sim may approach: apex 341 px, range 681 px. Design margins were set against the VACUUM numbers:

- walls / colour fields are **420 px** above the fairway (top y 200 over floor 620): the ball centre would need to
  reach y 188, the measured best is y 265 (77 px margin), vacuum best y 267.
- the chasm is **720 px**: a ball needs centre travel of 681 + 12 (radius) = 693 px to catch the far lip; 27 px margin.
- First Fairway is 1110 px tee-to-cup with a bunker at 870-1010: no ace (0/207 continuous-aim shots at power 95-100
  and 0/162 human-range shots reach the green from the tee).

Why 6.5 and not 6.8: two of three proposals and two judges asked for 6.5; flow's 380 px walls had 25 px of margin
at 6.8 and 3 px at 7.0, and the 720 px chasm would be crossable at 6.8 (vacuum range 746). At 6.5 everything has
≥ 27 px of margin even against drag-free physics.

## Final solver table (official `tools/solver.ts`, current physics, 16 angles × 8 powers, top grid power 94.4)

```
                                         prescribed flags                  --depth 10 --beam 120                scripted line
#  Level           Size      Par   coop (--depth 8 --beam 6)  solo P1 / P2 (reachableX)   coop   solo P1 / P2        (verify-lines.ts)
1  First Fairway   1280x720   6    4 (2+2)   sand on path     2 / 2 (by design)           4      2 / 2               6 (3+3); 5 via the sand
2  Two Doors       1800x720   7    5 (3+2)   door on path     NO x 888 / NO x 888         5      NO 888 / NO 888     8 (4+4)
3  Colour Keys     1860x720   9    not found (heuristic)      NO x 428 / NO x 1148        7 (4+3) NO 428 / NO 1148  9 (4+5)
4  Plate & Bridge  1960x720   8    5 (3+2)   bridge on path   NO x 520 / NO x 519         5      NO 521 / NO 519     9 (5+4); deck line 9
Course par 30. Solver minima 4 / 5 / 7 / 5 = 21.
```

- "not found" for Colour Keys at `--beam 6` is the known blindness of the distance-to-cup beam (every proposal hit
  it on at least one level); the same unmodified tool finds the 7-stroke line at `--beam 120` (34 s), and
  `verify-lines.ts` replays the intended 9-stroke line beat by beat on the solver's own grid with the partner
  stepped every tick. Treat beam 120 + the replay as the co-op verdict and the solver's `reachableX` as the
  solo-bypass proof (it is reliable at every beam: lone balls stop at the first wall / lip).
- Solo mode (one player, both balls, alternating) uses exactly the same lines: nothing in any level needs two
  balls to move at once.

Best co-op lines found by the official solver (beam 120; degrees above horizontal / power; rest positions from
`replay-paths.ts`):
- L1: P1 29/94 → 925 (in the sand) · P2 40/94 → 1004 (sand) · P1 83/94 SINK · P2 83/94 SINK.
- L2: P1 29/94 → 800 (DOOR plate, door opens) · P2 40/94 → 1181 (rolls through the door, rests on the WINDOW
  plate, window opens) · P1 61/94 → 1498 (lob through the window) · P2 61/83 SINK from the plate · P1 83/94 SINK.
- L3: P1 136/94 → 414 (nudges up to wall 1) · P2 51/83 → 897 (lob through the blue field onto the DOOR 1 plate) ·
  P1 40/94 → 1087 (rolls through door 1, stops in front of wall 2) · P2 29/61 → 1148 (moves up to wall 2) ·
  P1 72/94 → 1562 (lob through the red field onto the DOOR 2 plate) · P2 19/83 SINK (rolls through door 2 and
  holes out) · P1 72/61 SINK.
- L4: P1 29/49 → 474 (plate A, bridge appears) · P2 40/94 → 1202 (crosses from the tee, rests on the deck near the
  far end: the deck holds the bridge) · P1 40/94 → 1446 (crosses from plate A onto plate B) · P2 40/94 SINK from
  the deck · P1 61/83 SINK.

Human-range sweeps (`sweep-results.txt`: angles 5-90 step 5 × power 20-100 step 10 = 162 shots per position; the
percentage of ALL those shots, so a "sensible" lob band of 45-75° × 70-100 power is 28 shots ≈ 17 % of the sweep):
- L1: tee drive → 7-11 % in the sand, 8-9 % fairway 600+, rest short; 0 aces. From the sand (x 940): 20 % on the
  green + 13 % sunk. From x 760: 13 % sunk, 9 % on the green, 59 % in the sand.
- L2: tee → DOOR plate 15-18 % (47 % from x 550); roll through the open door onto the WINDOW plate 12 %; window lob
  from the DOOR plate 11-12 %; stall taps on the DOOR plate keep it held 10/10; wall passes 0/1656.
- L3: blue tee lob through the field onto the DOOR 1 plate 7 % (10 % from x 250); red roll through door 1 (blue
  holding) 22 % (10 % stop in the bowl, 12 % beyond it); red lob through the red field onto the DOOR 2 plate 10 %
  from x 1050, 6 % from 950, 2 % from 850 (so red should finish its roll near wall 2 or take one positioning
  chip); blue roll through the open door 2 40 % from 1050, 25 % from the bowl; red field vs blue 0/1242 passes,
  blue field vs red 0/1242 passes; door 1 closed blocks 162/162 red shots.
- L4: gap with no holder 0/765 crossings at power 95-100; tee chip onto plate A 13 % (37 % overshoot into the gap:
  the level's recovery-cost beat, +1 and respawn); blue onto plate A with red already there 72 %; crossing with A
  held: from the tee 41 % rest on the deck / 2 % on plate B (power 90-100: 78 % / 8 %), from plate A 58 % deck /
  4 % B (power 90-100: 67 % / 17 %); chip from the deck onto plate B 20 % (15 % far side off plate); putt from
  plate B 10 % sunk + 8 % within 60 px; lip test: 162/162 balls resting at x 495-519 do NOT press the deck.

Decision-19 checks (`stall-check.txt`, every ball stepped every tick): 16/16 cases keep the bridge/door up
(0 bridge-down ticks) when a partner holds a plate or rests on the deck; a lone ball leaving plate A always drops
the bridge the tick it moves (77-119 ticks down) and falls; a ball on the deck with nobody else holding falls
unless it flies off (61°/83 reaches plate B); a holder's stall tap (90°/10-15, 80°/20, 100°/15) never drops a
partner on the deck.

## Par and medals

Par = the scripted intended line (a competent pair following the hint), rounded down to solver-minimum + 2 where
the first-grid-shot replay is clearly pessimistic: 6 / 7 / 9 / 8 (course 30). Gold (under par) needs one great
shot per level (a hole-out from the plate, a one-swing crossing onto plate B); silver = the intended line;
bronze (par + 2) absorbs one duff per ball. Re-derive after the physics retune (below): pars live in the registry.

## Vocabulary the rebuilt sim must provide (contract for `src/sim`)

| Thing | Final rule |
|---|---|
| Plate (pressure switch) | HELD: pressed while a RESTING ball's footprint overlaps the drawn plate (press zone == drawn plate, no +14 px margin); evaluated every tick from resting balls whether they rest on terrain or on a bridge; releases the tick the presser starts moving. Every plate sits on the flat floor of a dish. |
| Dish | 20 px deep, 50 px ramps (22°); flat bottom = the plate. Rest only on gentle slopes (≤ 12°), so a ball on a ramp rolls back onto the plate (in the current physics it can freeze on the ramp, which only makes today's verification conservative). |
| Wall | permanent solid rect (`kind: 'wall'` in the new type; `'gate'` without switchId here), top ≥ 420 px above the fairway. |
| Door / window | blocker gate (`activeWhen: false`): solid until its plate is held. Door = bottom 100 px of a wall (floor-100 .. floor+20), window = 170 px (350-520) above it. **Ejection rule:** a ball resting inside a doorway when its gate closes is pushed out toward the side it came from. |
| Colour field | hazard rect, player colour, whole upper part of the wall (200-520); passes the matching ball at any height, bounces the other with restitution ≤ 1 and emits `hazardBlock{color}` so the HUD can say "blue field - red bounces". |
| Bridge | floor segment that exists while ANY of `switchIds` is held (OR semantics; this file uses three coincident rects because the current type holds one switchId). Top 1 px below both lips. A parked ball whose bridge vanishes falls. |
| Deck plate | a plate strip along the bridge, inset 24 px from each lip, drawn as a yellow pressure strip on the deck only while the bridge exists; a ball fully on the bridge and at rest keeps it up. A moving ball presses nothing, so a lone ball never crosses. |
| Sand | flush surface zone: kills bounce and roll (drawn embedded; 1 px proud here only for the current physics). |
| Respawn | after a fall: last rest position on PERMANENT terrain (never on a bridge or inside a doorway), +1 stroke, on-screen callout. |
| `cupHoldsSwitch` | **adopted rule for the early-sink strand:** a sunk ball counts as resting on the cup, and a level may wire the cup to one switch. L2 → `window`, L3 → `door2`, L4 → `far`. The first ball home then holds the partner's way open ("P1 is holding the WINDOW from the cup"), so sinking early is a finale, not a restart. The solver verification above does NOT use this rule; it only removes the one restart-only failure every proposal had. |
| Stall tap | a holder who must shoot before the partner is through taps straight up at minimum power and lands back on the plate (verified safe for doors and, with the deck plate, for the bridge). Taught on L2 by the turn toast: "You are holding the DOOR for P2 - tap straight up (low power) to stay on the plate." If the architecture track adds a `wait` command (+1 stroke, ball unchanged) it replaces the tap; the levels are verified without it. |
| Gimme | start at 40 px; every plate is ≥ 500 px from its cup, so the gimme can never concede a holder. |
| Camera | L1 fits one screen; L2-L4 scroll horizontally only (all 720 tall); overview at 0.65-0.71×. |

Level registry fields (`meta` in `levels.ts`): `id, index, world, name, par, hint, aha, failureMode,
mechanicsIntroduced, mechanicsPresent, firstPlayer, cupHoldsSwitch?, axes, verifiedShotSpeed`.

---

## Level 1 — First Fairway (`w1-first-fairway`) — 1280×720, one screen

- **Par 6** (solver 2+2 = 4; lines 5-6). Red shoots first. New idea: aim + power, cup, gimme, turn order, SAND.
- **Hint:** "Pull back from your ball and let go. Sand stops a rolling ball dead, so pitch over the bunker."
- **Aha:** power is distance: a full swing carries over the hill and runs into the bunker, a softer swing stops
  short of it, and a short pitch over the sand lands on the green where a ball that stops next to the cup is
  conceded (GIMME).
- **Watch-out:** players hit every shot at full power, end up in the bunker and do not connect "the ball stopped
  dead" with the sand; the SAND label and the `enterSand` callout must carry it.
- **Geometry:** surface `[0,590] [200,590] [320,578] [440,552] [540,538] [640,554] [760,580] [840,590] [1020,590]
  [1060,578] [1120,562] [1280,562]`, baseY 720. Tees x 90 / 130 (y 590). Hill crest x 540 (52 px). Bunker (sand)
  x 870-1010 on the flat at y 590. Green flat 1120-1280 at y 562, cup x 1190.
- **Axes:** distance 2 · verticality 1 · cup-width 2 | par 6 · obstacles 1 · branching 1 · precision 1 |
  distinct 1 · new 1 · sequencing 1 | puzzles 0 · simultaneity 1 · communication 1 | hazard 1 · softlock 1.
- **Walkthrough:** drive over the hill (a full drive runs into the bunker and stops: the sand lesson; a ¾ swing
  stops at 600-860), pitch 250-400 px onto the green, putt or gimme. 3 + 3.

## Level 2 — Two Doors (`w1-two-doors`) — 1800×720

- **Par 7** (solver 3+2 = 5; scripted 8). Red shoots first and HOLDS first. New idea: the HELD plate + blocker gate.
- **Hint:** "A plate works only while a ball is RESTING on it. Park on the DOOR plate for your partner, then they
  open the WINDOW for you from the far side."
- **Aha:** a plate is held, not pressed: the door shuts the moment you leave, so the crosser goes first while the
  holder waits, and the holder follows later through the window the crosser holds open.
- **Watch-out:** the first ball through the door plays on toward the cup instead of settling on the WINDOW plate
  (the holder is stuck until it comes back, 2 strokes, or sinks: `cupHoldsSwitch: 'window'`); the holder must
  shoot before the partner is through and needs the stall tap (taught by the toast).
- **Geometry (floor 620):** surface `[0,620] [360,620] [460,606] [560,620] [690,620] [740,640] [850,640] [900,620]
  [940,620] [990,640] [1180,640] [1230,620] [1320,620] [1400,600] [1480,620] [1540,620] [1600,600]
  [1800,600]`. Tees 100 / 150. **Wall** x 900-940: solid 200-350, **WINDOW** gate 350-520 (switch `window`),
  **DOOR** gate 520-640 (switch `door`). **DOOR plate** x 740-850 on the dish floor (y 640), dish 690-900 with the
  wall as its far rim. **WINDOW plate** x 990-1180 (dish 940-1230, starts right behind the wall: where a ball that
  rolls through the door stops). Hump 1320-1480 (20 px). Green 1600-1800 at y 600, cup x 1680 (500 px from the
  WINDOW plate: one full shot).
- **Axes:** distance 3 · verticality 1 · cup-width 2 | par 7 · obstacles 2 · branching 1 · precision 2 |
  distinct 2 · new 1 · sequencing 2 | puzzles 2 · simultaneity 2 · communication 2 | hazard 1 · softlock 2.
- **Walkthrough:** red parks on the DOOR plate (15-18 % of tee shots; otherwise position to ~550 and chip, 47 %) →
  door opens. Blue rolls through the open door (low, 5-20°, power 70-90) and stops in the WINDOW dish → window
  opens. Red lobs through the window (50-60°, power 90-100) from the plate. Both approach the raised green and
  sink. Solver: 5; scripted 8; typical pair 7.

## Level 3 — Colour Keys (`w1-colour-keys`) — 1860×720

- **Par 9** (solver 4+3 = 7; scripted 9). **Blue shoots first.** New idea: colour field.
- **Hint:** "Blue: lob over the door, through the blue field, and rest on the plate behind it: that opens DOOR 1
  for red. Red: roll through low, then lob the red field onto the plate that opens DOOR 2 for blue."
- **Aha:** the plate that opens MY door is behind YOUR colour of field: blue unlocks red at wall 1, red unlocks blue
  at wall 2, and the colours dictate who goes first - a leapfrog, not a race.
- **Watch-out:** red tries to lob wall 1 and bounces off the blue field (door 1 must be rolled through, low); red
  lobs the red field from too far back (the lob works from within ~250 px of the wall: 10 % from x 1050, 2 % from
  850, so finish the roll near wall 2 or take one positioning chip); red leaves the DOOR 2 plate for the cup before
  blue has rolled through (red can come back through its own field; `cupHoldsSwitch: 'door2'`).
- **Geometry (floor 620):** surface `[0,620] [440,620] [480,620] [650,620] [700,640] [1000,640] [1050,620]
  [1160,620] [1200,620] [1220,620] [1270,640] [1560,640] [1610,620] [1660,600] [1720,596] [1860,596]`. Tees
  100 / 150. **Wall 1** x 440-480: BLUE field 200-520 over **DOOR 1** gate 520-640 (switch `door1`). **DOOR 1
  plate** x 700-1000 on the bowl floor (bowl 650-1050) BEHIND wall 1: where a blue lob from the tee rests.
  **Wall 2** x 1160-1200: RED field 200-520 over **DOOR 2** gate 520-640 (switch `door2`). **DOOR 2 plate**
  x 1270-1560 (bowl 1220-1610) behind wall 2. Green 1660-1860 at y 596, cup x 1740.
- **Axes:** distance 3 · verticality 1 · cup-width 2 | par 9 · obstacles 3 · branching 1 · precision 3 |
  distinct 3 · new 1 · sequencing 3 | puzzles 2 · simultaneity 2 · communication 3 | hazard 1 · softlock 2.
- **Walkthrough:** blue lobs from the tee (55-70°, power 80-100) over door 1 and through the blue field into the
  bowl → DOOR 1 opens. Red rolls through door 1 from the tee (5-20°, power 80-100), ideally finishing near wall 2.
  Blue moves up in front of wall 2. Red lobs the red field (45-70°, 80-100) into the far bowl → DOOR 2 opens. Blue
  rolls through door 2. Both chip to the green and sink. No stroke is spent waiting when red's roll finishes near
  wall 2; if it stops short, red chips up and blue stall-taps once (par absorbs it).

## Level 4 — Plate & Bridge (`w1-plate-and-bridge`) — 1960×720

- **Par 8** (solver 3+2 = 5; scripted 9). Red shoots first and HOLDS first. New idea: the bridge.
- **Hint:** "A resting ball on plate A holds the bridge up. Both chip onto plate A, then cross one at a time with a
  full swing; the bridge deck also holds itself while a ball rests on it."
- **Aha:** the bridge only exists while someone is resting on a plate, so one of us stays behind on plate A while
  the other crosses, and the landing plate across the chasm (or the bridge deck itself) lets the first crosser hold
  it for the partner: we swap roles instead of racing.
- **Watch-out:** the tee chip overshoots plate A into the chasm (37 % of all sweep shots: +1, respawn on the tee
  flat); a ball resting on the deck with nobody else holding tries to ROLL off instead of flying off (the bridge
  vanishes under it: +1); the ball on plate B putts out before the partner is across (`cupHoldsSwitch: 'far'`).
- **Geometry:** near piece `[0,624] [120,616] [220,630] [320,630] [350,620] [400,640] [470,640] [520,620]` (tee
  flat 220-320, plate A dish 350-520 with the lip as its far rim); **gap 520-1240 (720 px)** declared in
  `terrain.gaps`; far piece `[1240,620] [1256,620] [1272,628] [1540,628] [1560,620] [1700,616] [1760,590]
  [1800,584] [1920,584] [1960,590]`. Tees 250 / 290. **Plate A** (`near`) x 400-470 on the dish floor. **Plate B**
  (`far`) x 1272-1540 (the whole landing bowl). **Bridge** x 520-1240, top y 621 (1 px below both lips), h 18,
  active while `near` OR `far` OR `deck` is held. **Deck plate** (`deck`) x 544-1216, y 619. Green 1800-1920 at
  y 584, cup x 1860.
- **Axes:** distance 3 · verticality 1 · cup-width 2 | par 8 · obstacles 2 · branching 1 · precision 2 |
  distinct 2 · new 1 · sequencing 3 | puzzles 2 · simultaneity 2 · communication 2 | hazard 2 · softlock 1.
- **Walkthrough:** red chips onto plate A (bridge appears: cause and effect on screen). Blue takes a full swing from
  the tee: it lands on the bridge and either rolls into the far bowl onto plate B or stops on the deck (the deck
  holds the bridge, so red may now cross: a full swing from plate A reaches plate B 17 % of the time at power
  90-100, else the deck). Whoever is on the deck flies off to the far side next turn (the partner on B or the deck
  is holding). Both putt out (cup 320-590 px from plate B). Gold needs a one-swing crossing onto B and a hole-out
  from the deck/bowl (the solver's 5).

---

## How the four levels form a curve

L1 is pure feel on one unmoving screen: three arcs per ball, a bunker that teaches "sand = stop" by being where the
lazy drive lands, and the first GIMME. L2 adds the one idea the game is built on, the HELD plate, in its most
legible form (a door at the foot of a wall, a window above it, one plate each, both in dishes) and makes the
players talk once: "you first, I'll hold." L3 keeps the plate/door verb and adds colour: the plate that opens your
door is behind the other colour's field, so the same verb is used twice with the roles swapped and the order of
play falls out of the colours. L4 keeps the plate verb and spends its one new idea on the bridge: the first
obstacle where the held thing is the floor under your partner, with the self-holding deck and the landing bowl
keeping the recovery cost at one stroke. Axis by axis: distance 2→3→3→3, mechanic load 1→2→3→2, sequencing
1→2→3→3, co-op simultaneity 1→2→2→2, precision 1→2→3→2, softlock 1→2→2→1, par 6→7→9→8 (course 30, about
30-38 strokes for a typical pair ≈ 8-10 minutes). Every co-op level is unsolvable solo for BOTH balls (lone balls
stop at 888 / 428-1148 / 520), both balls always have a route (door then window; blue field then door 1, door 2
then red field; plate A then plate B/deck), and no mistake needs a restart once `cupHoldsSwitch` is in.

## Judges' concerns and how each is resolved

1. **Physics retune invalidates numbers** — every number here is current-physics. The vitest level-validity suite
   must BE `verify-lines.ts` + `sweep.ts` + `stall-check.ts` run against `src/sim` (plus the solver with the
   diverse-bucket frontier from `levels-puzzle/solver-diverse.ts` as a CI job). Margins were set against vacuum
   physics so geometry survives the drag/scrub removal; re-derive pars and hit rates after it.
2. **Early-sink strand** — `cupHoldsSwitch` per level (above) + HUD chip "holding WINDOW for P2" on the holder.
3. **Wall margin** — 420 px walls at 6.5: 77 px measured margin, ≥ 67 px even drag-free; assert in tests.
4. **Visual sameness** — three different wall silhouettes (grey stone with a hinged door + framed window; two
   colour-glass slabs over doors; a chasm with a plank bridge), dishes/bowls, humps and raised greens on every
   level; door/window/plate carry the same letter/label; inactive gates drawn in place; deck strip drawn only
   while the bridge exists.
5. **Stall tap untaught** — taught by the L2 holder toast; never on the main line of any level except as the L3
   fallback; safe with doors and (via the deck) with the bridge; `wait` command optional.
6. **Doorway closing on a ball / respawn on a vanished bridge** — ejection rule and permanent-ground respawn in
   the contract table.
7. **Data model** — `kind: 'wall'`, `switchIds: string[]` (OR), deck plate as an ordinary switch, registry fields
   listed above, press zone == drawn plate.
8. **Solo mode** — intro card names who goes first (`firstPlayer`) and who holds; every line alternates strictly.
9. **Gimme vs plates** — plates ≥ 500 px from the cup.
10. **Par calibration** — scripted line, min + 2 where the replay is pessimistic (6 / 7 / 9 / 8), recompute after
    the retune.
11. **Deck exploit** (judge 3: "a lone ball could chain plate A → deck") — found by the solver on the first draft
    (a ball frozen at the lip pressed the deck through the 14 px margin); fixed by the 24 px inset and the exact
    press zone; lip test 162/162, lone ball from plate A falls in 4/4 cases.
12. **Width / overview scale** — 1280 / 1800 / 1860 / 1960 px (overview ≥ 0.65×); L1 does not scroll.

## Re-verification recipe (run from the project directory)

```
npx tsx <scratch>/tools/solver.ts <this dir>/levels.ts --svg <this dir>/svg --json <this dir>/solver.json --depth 8 --beam 6 --shotSpeed 6.5
npx tsx <scratch>/tools/solver.ts <this dir>/levels.ts --json <this dir>/solver-beam120.json --depth 10 --beam 120 --shotSpeed 6.5
npx tsx <this dir>/tools/verify-lines.ts --json <this dir>/verify-lines.json
npx tsx <this dir>/tools/sweep.ts > <this dir>/sweep-results.txt
npx tsx <this dir>/tools/stall-check.ts > <this dir>/stall-check.txt
node <scratch>/pw/shot.mjs <this dir>/svg/level-N.svg <this dir>/svg/level-N.png 1280 720 300
```
Pass criteria: every level co-op solvable (beam 120 or replay), L2-L4 solo-unsolvable for both balls, 0 wall
passes and 0 gap crossings at power 100, 0 aces on L1, 0 partner falls in the stall checks, lip test clean.
