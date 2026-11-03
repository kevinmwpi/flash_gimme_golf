# Levels — World 1 "Teach", World 2 "Lift & Lock", World 3 "Sky Machines" (owner: LEVELS group)

One file per level, `w<world>-<NN>-<slug>.ts`, each `export const level: Level = compileLevel({...})`. The id
is the file name without `.ts` and equals `w<world>-<hole number, 2 digits>-<slug of the name>`; `Level.order`
is the hole number over the whole game (1-12, BUILD_DECISIONS D10.1). `index.ts` registers the twelve in
campaign order: `LEVELS`, `WORLDS` (`[1, 2, 3]`), `WORLD_IDS` (each world's ids), `WORLD1_IDS`, `levelById`,
`hasLevel`, `worldOf`, `levelsOfWorld`, `nextWorld` (`null` after World 3), `coursePar`, `campaignFrom` and
`worldTitle`. A campaign is one world (D10.2): `campaignFrom(id)` runs from that hole to the last hole of ITS
world. Level-id literals live ONLY in this directory; the UI and storage go through the registry.

### World 1 "Teach"

| # | id | name | size | par | first | holds | new idea |
|---|---|---|---|---|---|---|---|
| 1 | `w1-01-first-fairway` | First Fairway | 1280 × 720 | 6 | red | — | sand (aim, power, cup, gimme, turns) |
| 2 | `w1-02-two-doors` | Two Doors | 1800 × 720 | 7 | red | cup → `window` | held plate + blocker gate |
| 3 | `w1-03-colour-keys` | Colour Keys | 1860 × 720 | 8 | **blue** | cup → `door2` | colour gate |
| 4 | `w1-04-plate-and-bridge` | Plate & Bridge | 1960 × 720 | 7 | red | cup → `far` | bridge (typed `switch`, see below) |

Every hole also carries a BACK BUNKER: a sand band from 50-60 px behind the cup to the right level edge
(`back-bunker` in each file), so an overhit approach stops in sand to be pitched back instead of banking off
the level edge (WALL_RESTITUTION 0.45, 90-120 px behind every cup) into the hole; `mechanicsPresent` therefore
lists `sand` on every hole (worlds 2-3 keep the rule: 45-70 px behind the cup, see the table below).

### Worlds 2 and 3 (design/proposals/worlds-2-3/LEVELS.md, Appendix A)

| # | id | name | size | par | first | holds | new idea | devices (release / FIRE plates; the first names the HUD chip) |
|---|---|---|---|---|---|---|---|---|
| 5 | `w2-05-spring-step` | Spring Step | 1800 × 720 | 7 | red | cup → `top` | spring | — |
| 6 | `w2-06-booby-trap` | Booby Trap | 1700 × 720 | 6 | red | cup → `far` | trap | trap `snare` [`free`, `far`] |
| 7 | `w2-07-load-and-fire` | Load & Fire | 1960 × 720 | 8 | red | cup → `fire-far` | cannon | cannon `cannon` [`fire`, `fire-far`] |
| 8 | `w2-08-colour-lift` | Colour Lift | 1960 × 720 | 8 | **blue** | cup → `door` | — (the World 2 exam) | — |
| 9 | `w3-09-bait` | Bait | 1960 × 720 | 8 | red | cup → `top` | — | trap `bait-trap` [`top`] (the BAIT seat) |
| 10 | `w3-10-sky-bridge` | Sky Bridge | 1960 × 720 | 7 | **blue** | cup → `b` | — | cannon `cannon` [`a`, `b`, `deck`] |
| 11 | `w3-11-crossfire` | Crossfire | 1960 × 720 | 7 | red | cup → `far` | — | cannon `cannon` [`fire`, `far`] |
| 12 | `w3-12-grand-machine` | Grand Machine | 1960 × 720 | 7 | red | cup → `top` | — | trap `pit` [`fire`, `top`], cannon `cannon` [`fire`, `top`], trap `door-seat` [`top`] (the DOOR seat) |

Every trap and cannon lists the cup's plate among its own, so a sunk partner always frees a caught ball and
lights a cold cannon (asserted in `levels.test.ts`). Back bunkers sit 60 / 50 / 50 / 70 / 70 / 45 / 50 / 50 px
behind the cups of holes 5-12; every plate edge is at least 135 px from its cup (L10 B, the tightest). Course
pars 29 (World 2) and 29 (World 3): the solver calibrated the design's proposals (30 and 32) to solver minimum ≤
par ≤ minimum + 2 (D10.13), lowering holes 6, 9 and 12 by one each, and D11 (plates pressed on contact) lowered
Crossfire's minimum and so its par by one more ("Pars" at the end).

World 1 course par 28 (LEVELS.md authored 6 / 7 / 9 / 8 = 30; the re-verification against the real sim moved Colour Keys
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
| plate | `PressureSwitch` (BUILD_DECISIONS D11: PRESSED by any non-sunk ball whose centre is inside `[x, x+w]` over the plate's own ground, rolling, bouncing or resting; down on contact, held while a ball over it is at most `PLATE_HOLD_HEIGHT_PX` above it, up the tick no ball is on it, no latching) | `{ id, centerX, w, colour: SWITCH_COLOUR, label }` |
| deck plate | `PressureSwitch.onRectId` = the bridge; `surfaceY` = the bridge top; spans the bridge lip to lip (D11, below) | `{ ..., onRectId: 'bridge' }` |
| dish / bowl | ordinary terrain polyline, 20 px deep, 50 px ramps (≈ 22°, above `REST_MAX_SLOPE`, so balls roll back onto the flat plate) | surface points |
| bridge | one `bridge` rect, `x = gap.x1`, `w = gap width`, top = mean lip height, `switchIds` (OR) | `{ kind: 'bridge', gap, switchIds, label: 'BRIDGE' }` |
| sand | flush `sand` range | `{ kind: 'sand', x1, x2 }` |
| spring | flush pad: any ground contact sets the velocity to `launch` | `{ kind: 'spring', centerX, w, launch, label: 'SPRING' }` |
| trap (jaws) | `trap` rect in absolute coordinates, ARMED until any release plate is held (OR) | `{ kind: 'trap', id, x, y, w, h, releaseIds, label: 'TRAP' }` |
| cannon (breech) | `cannon` pad on the funnel floor, LIT while any FIRE plate is held (OR), integer `launch` vector | `{ kind: 'cannon', id, centerX, w, launch, fireIds, label: 'CANNON' }` |
| seat | a plate lying wholly inside a trap that it does not release (L9 BAIT, L12 DOOR): its holder is caught | a plate + a trap prop |

Walls are stacked: the field (200–520) stands on the door (520–640), the L2 cap (200–350) on the window
(350–520) on the door. A wall foot sinks `WALL_EMBED_PX` (20) below the fairway so a door that closes on a
resting ball ejects it SIDEWAYS (nearest face) and never down into the dirt (D2). A window stacked on another
wall needs no embed (L2's on its DOOR, L8's on the blue field): the ejection skips every face whose exit point
lies inside terrain or another solid rect, so a window shutting on a ball parked on the wall below leaves it
sideways too (`levels.test.ts`). `validateLevel` accepts a wall that stands on the fairway (foot within
`[fairway − 2, fairway + 20]`) or on another wall rect, so the Bait and Grand Machine doors stand FLUSH on their
channel floors (D10.12; a door closing on a ball in its doorway still ejects it sideways, `devices.test.ts`).
Rect ids and switch ids are disjoint within a level (`door-gate`, `window-gate`), and a cannon's funnel sand
keeps its `props` order around the breech (pads are looked up in `rects` order).

### Validity rules (`validateLevel`, all tested in `levels.test.ts` and `devices.test.ts`)

height 720 · 1280 ≤ width ≤ `MAX_LEVEL_WIDTH` · wind 0 in every world · par ≥ 3 · non-empty name/hint/aha/watchOut ·
at most one `mechanicsIntroduced` (exactly one in World 1), present in `mechanicsPresent`, which equals the kinds actually present
(switches ⇒ `switch`) · `cupHoldsSwitch` resolves · pieces: strictly increasing x, ≥ 2 points, `baseY` below
the surface; overlapping pieces are consistently STACKED (seam ≤ 1 px) or an OVERHANG (clearance ≥ 48) ·
gaps: nothing covers the inside, a piece ends at `x1` and one starts at `x2` · tees, plates and the cup sit on
the fairway (not under a stacked piece), slope ≤ `RESTABLE_MAX_SLOPE`, outside gaps and fans; tees ≥ 50 px
apart; a plate's `surfaceY` matches the fairway along its whole width · every `switchId`/`switchIds` resolves
and every switch is referenced by a rect or the cup · a bridge starts at a gap, spans it, sits within 3 px of
both lips and has `switchId` or a non-empty `switchIds` · a deck plate's `onRectId` is a bridge/blocker, the
plate lies inside it and `surfaceY` equals its top · walls ≥ `MIN_WALL_HEIGHT`, grounded or stacked · pads
(sand, spring, bumper, cannon) not in gaps and not overlapping; springs and cannons launch upward within
`MAX_BALL_SPEED` · traps: a label, release plates that resolve, no tee centre and no cup rim point inside,
ground under the zone's centre, none of its own release plates inside · cannons: a label, FIRE plates that
resolve, `|launch.x| ≥ CANNON_MIN_SIDEWAYS · |launch.y|`, a breech floor no steeper than `RESTABLE_MAX_SLOPE`,
no tee on the breech, the first `CANNON_MUZZLE_CLEAR_PX` px of the launch ray clear of terrain and permanent
walls · ids kebab-case and unique; rect ids and switch ids disjoint. `levelWarnings` carries the non-fatal
"spring launches straight up" advice.

`levels.test.ts` adds the level rules that are not validity: every back bunker ≥ 40 px, reaching the edge,
more than `GIMME_RADIUS` and at most `NEAR_CUP_RADIUS` behind the cup; every plate edge more than
`GIMME_RADIUS + NEAR_CUP_RADIUS` (130 px) from the cup; every gate column ≥ 420 px above the fairway; the
OVERVIEW RULE (the intro/results overview frame of `cameraFor` reaches the level bottom, i.e.
`rimY ≥ 720 − 216 / zoom` with `zoom = 1280 / width`; Sky Bridge keeps 0.75 px); the device table and the
launcher vectors measured below.

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

### Worlds 2-3: deviations from Appendix A (`design/proposals/worlds-2-3/LEVELS.md`)

The geometry is Appendix A verbatim except where an existing level rule forces a minimal change or verification
found a softlock (D10.12). Three holes change:

- **L9 Bait (a softlock).** The BAIT plate is 490–610 (Appendix A: 490–600) and covers the whole restable floor
  of the jaws (480–610 × 590–640). With the Appendix plate a ball resting at 600–610 was caught WITHOUT holding
  the door, so its partner could never get through, and the scoped reset never runs while the partner can still
  shoot. The solver's `traps` pass found it (`traps-rescuable`); D10.12 now asks every plate inside a trap to
  cover that trap's restable floor. The walkthrough below has the details.
- **L10 Sky Bridge (a level rule).** Appendix A put the back bunker at 1930–1960 (30 px, under the
  40 px minimum) and plate B's right edge (1750) exactly `GIMME_RADIUS + NEAR_CUP_RADIUS` = 130 px from the cup
  at 1880, where the rule needs more. A 40 px bunker reaching the edge must start at 1920 and the cup must stay
  more than `GIMME_RADIUS` in front of it, so the bunker is 1920–1960, the cup moves 5 px along the same green
  (1880 → 1875, rim y 390, so the overview rule keeps its 0.75 px), and plate B loses 10 px on the right
  together with its bowl flat (1630–1750 → 1630–1740; the right ramp 1750–1780 → 1740–1770 keeps its 30 px
  run; B sand 1602–1778 → 1602–1768). Margins: bunker 45 px (> 40), plate B 135 px (> 130). On the Appendix
  bowl the cannon → B flight rests at x 1672.45–1719.68 for every breech x and every ±3 % launch (1,746 of
  1,746 fired on entry or LOADED, all on B), 20 px short of the new edge; on the shipped bowl every case still
  rests on B ("Launcher re-verification" below).
- **L11 Crossfire (a softlock).** The cannon pit's right side runs straight from the breech (840, 640) up to the
  chasm lip at (900, 610), sanded all the way (pit-r 841–899). Appendix A's side stopped at (880, 620), followed by
  a 20 px flat to the lip, with pit-r 841–879. Blue gets right of the red field only through the door, and only
  FAR holds the door open. A hard roll through the open door could skip the lit pit and stop on that flat. If red
  then left FAR, blue was boxed in: the door was shut, the cannon cold, FIRE behind the blue field and FAR across
  the chasm, and the scoped reset never ends that. Now nothing between the door and the chasm holds a resting
  ball except the breech, where a lit cannon fires it and a cold one LOADS it (`levels.test.ts` drops a ball at
  every x there). The launcher rows and the golden line are unchanged, and every solver criterion on the hole
  passes (`traps-rescuable` 18 / 18).
- **L11 Crossfire, known residual (not fixed, documented).** Blue LOADED in the cold cannon while red rests free
  on the near side cannot be undone: red gets every turn (WAITING rule) but can reach neither FIRE (behind the
  blue field) nor FAR (across the chasm), so only the host's *Restart hole* ends it. Reaching it takes two
  deliberate wrong-way shots back across the 560 px chasm: red lobbing back from FAR (948 of 395,280 leftward
  shots) or from the 20 px plateau flat at 1460–1480 (140 of 1,132,560 fine-grid shots), and then blue lobbing
  back from FAR into the pit, or the door shutting on blue in the doorway. Seeded random play, the solver's
  traps pass and 3,120 noisy Monte Carlo games never reached it. A red-only FIRE plate on the door's top was
  tried as a rescue and rejected: from the best spot only 0.48 % of a 1° × 1-power grid fires blue, and it
  would put a second FIRE sticker inside the red field on every normal playthrough. Revisit with playtest data.
- **Ids.** Rect ids and switch ids are disjoint (D10.8): L8 `window` → `window-gate` and `door` → `door-gate`;
  L9, L11 and L12 `door` → `door-gate` (L5 and L6 already used `door-gate`).
- **Vocabulary** (D2). The Appendix's `wall` is a permanent blocker; its `devices` are `trap` / `cannon` props
  whose `releaseSwitch` lists become `releaseIds` / `fireIds` in the same order (the partner-reachable plate
  first: it names the HUD chip, D10.10). Cannons are authored as their integer launch vectors, L7 (400, −700),
  L10 (520, −760), L11 (440, −730) and L12 (700, −760); the Appendix's angle and speed are descriptive (no
  sin/cos outside `launchVelocity`). The cup wiring (`cupHoldsSwitch`) and L10's DECK `onRectId: 'bridge'`
  come from the Appendix prose, which its JSON omits. Single-plate doors keep the Appendix's `switchIds: [id]`
  (World 1's `switchId` is equivalent).
- **Copy.** Hints are the design's "In-game hint" verbatim and `aha` its "Aha"; `watchOut` is player-facing
  "Stuck?" copy written from "Watch for in playtests" and the hole's recovery rules, without solver numbers.
  Two exceptions since D11 (plates press on contact): L7's hint said the cannon "fires only while a ball RESTS on a
  FIRE plate", which is no longer true, so it reads "fires the moment a ball touches a FIRE plate. Whoever lands
  across stays on the far FIRE plate to fire the other." (its `aha` and `watchOut` follow; the L10 `watchOut`
  teaches the lip-to-lip deck). L10's aha ended "so the cannon never fires without a bridge underneath", which a
  shot that only skims across A breaks (D11, below), so it now says the ball that fired the cannon stays on A
  until its partner lands, and its `watchOut` says the same.
- **Pars** started from the design's proposals (7 / 7 / 8 / 8 and 9 / 7 / 8 / 8); the solver's calibration (D10.13)
  lowered Booby Trap, Bait and Grand Machine by one each, and the D11 re-verification lowered Crossfire by one
  more, so they ship at 7 / 6 / 8 / 8 and 8 / 7 / 7 / 7 ("Pars" at the end).

### D11: plates pressed by any ball on them (owner request, 2026-11-02)

BUILD_DECISIONS D11 replaced D2's resting-only plate rule: a plate goes down the tick any non-sunk ball over its
own ground touches it (rolling, bouncing or resting), stays down while a ball over it is at most
`PLATE_HOLD_HEIGHT_PX` (72) above it, and comes up the tick no ball is on it. All twelve holes were re-verified
at a hold height of 56 and again at 72 (solver results in "Final table" below). What it changed:

- **Hold height 72 (56 at first).** A landing's first hop rises about (0.35 v)² / 2g for a vertical impact of
  v px/s (`GROUND_RESTITUTION` 0.35), so 56 held the hops of landings up to about 750 px/s and 72 holds them up to
  about 850. At 56 a back-smash onto L5's DOOR plate (155°/100 from the plateau at x 1100, off the wall's cap,
  803 px/s down) hopped 62.1 px and let the plate up for 34 ticks mid-bounce, shutting the door; at 72 the same
  landing keeps it down. A hop scan of 307,004 single-ball flights (the 94 `loops` shots from every restable spot
  every 20 px of every hole, both colours, all plates up and all held) finds no landing on any of the 26 plates
  that lets it up mid-bounce at 72; at 56 it finds the 4 flights of that back-smash. The scan's hardest landings
  are 811 px/s (L12 FIRE), 803 (L5 DOOR) and 767 (L6 FREE); on every other plate they stay at or under 654.
  Finer lob grids from higher ground (BUILD_DECISIONS D11) find first hops up to 71.4 px on reachable landings
  (from the top of L6's backboard onto FREE, the thinnest margin); the one higher hop, 81.1 px onto L11's FIRE,
  starts on top of the blue field, which red cannot reach (`wall-top-clear`) and blue passes through.
  Re-run at 72, every solver criterion still passes; the few numbers that moved are listed under "Final table".
- **Decks lip to lip (L4, L10).** The DECK plates were inset 24 px from both lips so that a ball resting at a lip
  would not hold the bridge. Under D11 a lone deck ball rolling for a lip let the deck go 21.7–23.9 px short of
  it and the planks vanished under it: 120 of 1,120 lone-deck rolls (0–7° either way, power 10–100, every 48 px
  along the deck) fell into the chasm, the rest crossing or not depending on speed, a gotcha nobody could read.
  Both DECK plates now span their bridge exactly (L4 520–1240, L10 860–1580), and 0 of 1,200 such rolls fall
  (on each hole, the same at a hold height of 56 and of 72). A ball resting AT a lip still never holds the
  bridge: its centre stands on the lip's terrain, and only the deck rect itself presses a deck plate
  (`switchPresser`'s ground source; 0 of 48 lip rests press it, `deck-lip`). The copy now says "roll off the
  deck"; a high lob still lifts off it (`deck-lone-lob-lifts-off`).
- **No plate lets its own ball through.** A plate a ball passes comes up at the end of the tick the ball leaves
  it, and what it drives changes from the next tick, so meanwhile the ball's leading edge advances at most
  `(MAX_BALL_SPEED + GRAVITY · DT) · DT + BALL_RADIUS` = 30.5 px past the plate's end. Every plate ends farther
  than that from each door, window, bridge or cannon breech it drives (`levels.test.ts`): the tightest are L4's
  B (32 px from the bridge end), the L9 BAIT and L12 DOOR seats (40 px from their doors), then 50 px (L2 DOOR
  and WINDOW, L4 A, L5 DOOR, L10 B). No other terrain lies within the hold height above any plate (re-checked
  at 72: over every plate's x-range the only ground is the plate's own, with no other terrain piece, wall or
  bridge above it at any height), so a ball standing on other ground never keeps a plate down.
- **Landings.** Every launcher landing holds its target plate through its bounce hops (`launchers-hops-hold`,
  0 of 24,138 landings let it up mid-bounce, at 56 and at 72); 2,069 of them (L5 TOP, L7 far FIRE, L8 WINDOW,
  L11 FAR) roll off the plate's end onto the bowl's ramp and back before resting, so the plate is up for a few
  ticks: a pass-over, which D11 accepts.
- **L10: a skim across A can drop the fired partner (accepted, review of 2026-11-02).** A LOADED ball fires the
  tick any ball touches a FIRE plate, and on Sky Bridge the plates that fire the cannon (A, B, DECK) are also all
  that holds the bridge. The fired ball comes down on the planks about 126–128 ticks (2.1 s) after the fire, at x
  1060–1080, and holds the DECK itself from then on; until then the ball that fired it has to stay on A (or B). A
  firm flat shot that skims across A's (or B's) sand bowl touches the plate for 1–5 ticks, fires the partner,
  raises the bridge and rolls off; the planks are gone long before the partner gets there, so it falls (+1, back
  to its safe spot, usually its tee). Before D11 the partner fired only once the shooter rested on the plate, so
  the same shots left it LOADED, or fired it safely when the shooter came back to rest on A. Measured at a hold
  height of 72 (the review's sweeps, re-run on this code): red's first shot from the tee after blue loads (1–89°,
  power 10–100 in steps of 2: 4,094 shots) fires blue 2,579 times and drops it 0 times, because the spring ride
  and every landing in A's bowl from the tee flat end on A, rocking included. From the spire-top spots 616, 620
  and 630 (left of A's bowl) and 830, 845 and 859 (right of it), on 1–179° × the same powers (8,234 shots per
  spot), 47–52 of the 2,789–4,003 partner-firing shots per spot drop blue, all at power 72 or more within 12° of
  flat; on the human grid (5–90° step 5 × power 20–100 step 10, both ways) 1–3 of 105–148. From the left spots
  red falls into the chasm as well in 41–45 of them; from the right ones it never does (it drops off the spire
  and the SPRING usually throws it back onto A). The B-side spots need a contrived order (red already across,
  then blue loads). No softlock and no desync, only the +1. D11 keeps the touch rule rather than firing L10's
  cannon only on a lasting press, so the copy changed instead: the L10 aha, watchOut and file header no longer
  promise a bridge under the fired ball and say the ball that fires the cannon stays on A (or B) until its
  partner lands. `levels.test.ts` plays the safe opening (blue LOADED; red's spring ride onto A fires it, A never
  comes up, red rests on A and blue lands across) and checks the copy.
- **Pars and copy.** Crossfire's minimum fell from 6 to 5, so its par from 8 to 7 ("Pars"). Copy says "on" a
  plate where "resting on" became wrong: the L2 hint and aha, the L4 hint, aha and watchOut, the L7 hint, aha and
  watchOut (the cannon fires on a touch), the L10 watchOut.
- **Goldens** were re-recorded on purpose: every line keeps its commands (shooter, angle, power) and its strokes,
  and every final snapshot differs only in its tick. A landing on a plate no longer flips a switch on its rest
  tick, so the hand-off after it (ARCH R5) comes a tick sooner: World 1 L2 and L3 −2 ticks, L4 −3, L1 unchanged
  (no plates); L5–L9 and L11 −2; and a LOADED ball now fires on the partner's first touch of its plate, L10 −19
  (red's spring landing on A) and L12 −145 (blue's roll onto FIRE). Raising the hold height from 56 to 72 moved
  no golden: the slow suite re-records all twelve exactly as committed.

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
through → stall tap (straight up, low power), taught by the holder tip (`src/ui/holderTip.ts`); the tap rises
at most 13 px, so the plate never comes up and the door stays open throughout (D11, `stall-taps-safe`).

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
1272–1540, bridge 520–1240 top 620 active while `near` OR `far` OR `deck` is held, DECK plate 520–1240 on top
of the bridge, lip to lip (D11; inset 24 px from both lips until then). Line: red chips onto plate A (bridge
appears) → blue takes a full swing from the tee and rests on the deck or in the far bowl → red crosses from
plate A → whoever is on the deck rolls off it (the deck holds the bridge under it to the lip) → both putt
out. Watch-outs: the tee chip overshoots plate A into the chasm (+1, respawn on the tee flat); a lone deck
ball LOBS off: a lob rising more than `PLATE_HOLD_HEIGHT_PX` above the planks lifts off the deck, the planks
vanish and it falls unless it carries to a lip, whereas every roll keeps them under it
(`deck-lone-roll-keeps-bridge`, `deck-lone-lob-lifts-off`); the ball on plate B putts out before the partner is
across (`cupHoldsSwitch: 'far'`).

### 5 · Spring Step (par 7, red first and HOLDS first, cup holds `top`)

Floor 620. Wall x 650–690: cap 200–520 over the DOOR 520–640 (held by `door` OR `top`). DOOR plate 490–600 in
the dish 440–650 (far rim = the wall). SPRING 862–918 on the floor, launch (150, −800); 380 px cliff at 1080 up
to the plateau at 240; TOP plate 1250–1370 in the bowl 1200–1410; drop at 1460 to the terrace at 440, cup
1690, back bunker 1750–1800. Line: red parks on DOOR → blue rolls through the door onto the spring and lands
on TOP, which holds the door → red leaves DOOR, rolls through and rides up → both chip down and putt.
Watch-outs: lobbing at the 420 px wall instead of rolling through the door; the TOP ball chipping away before
the DOOR holder has ridden up (the cup holds TOP, so sinking is safe).

### 6 · Booby Trap (par 6, red first, cup holds `far`)

Floor 620. Perch 160–340, top 460 (160 px), its bowl 170–330 carrying PERCH 200–300 at y 484 and a backboard
162–182 up to y 340. At its foot the trap dish 360–460 under the jaws `snare` (350–450 × 560–640, released by
FREE or FAR). Tees 540 / 590; FREE 670–760 in the dish 640–790. Wall 980–1020 (cap 200–520, DOOR 520–640 held
by `perch` OR `far`); FAR 1090–1240 in the dish 1040–1290; hump at 1420; green 1540–1700 at y 600, cup 1600,
back bunker 1650–1700. Line: red lobs LEFT onto the perch (the DOOR opens) → blue rolls through into the FAR
dish (FAR holds the door and opens the trap) → red drops off and rolls through → both putt. Rescue: a short
lob rolls into the trap and red is CAUGHT (its turns go to blue) → blue rolls onto FREE → red, freed where it
sits, lobs back up nearly vertically. Watch-outs: whether a skipped turn reads as the trap; whether the caught
player feels idle; blue's leftward shots into the occupied trap (if nobody can shoot, the scoped reset: BACK +1).

### 7 · Load & Fire (par 8, red first, cup holds `fire-far`)

Floor 620; FIRE 500–600 in the dish 450–650; mount 841–960 (top 540) with the sand funnel 841–889 / 931–960
around the breech 890–930 at y 565 (launch (400, −700), lit by `fire` OR `fire-far`). Chasm 961–1520. Far
plateau at y 400: landing sand 1540–1740 carrying the far FIRE plate 1560–1720 at y 410; cup 1870, back bunker
1920–1960. Line: red moves up to x 650–830 → blue rests on FIRE → red lobs into the funnel and is fired onto
the far plate (or rests LOADED and blue's first touch on FIRE fires it, D11) → blue leaves FIRE (the far
plate keeps the cannon lit) and lobs in → both putt. Watch-outs: expecting the cannon to fire by itself;
overshooting the mount into the chasm (+1, back to the safe spot).

### 8 · Colour Lift (par 8, BLUE first, cup holds `door`)

Wall 1 at 200–240: cap 200–320, WINDOW 320–440 (`window`), floor-level BLUE field 440–640. A hopper 241–940
slopes down to the SPRING 702–758 (launch (380, −780)). 320 px cliff at 1000; WINDOW 1050–1150 in the sand bowl
1020–1180. Wall 2 at 1200–1240: RED field from y −220 (off-screen) to 200 over the DOOR 200–320 (`door`); DOOR
plate 1420–1600 in the sand bowl 1390–1630; drop at 1680 to the terrace at 460, cup 1840, back bunker
1910–1960. Line: blue lobs through its field into the hopper, rides the spring and bounces off the red field
onto WINDOW → red lobs through the window from a few steps back (blue stall-taps while red misses) and flies
through the red field onto DOOR → blue rolls through → both chip down and putt. Watch-outs: blue reading the
bounce as a failure; the window lob is World 2's precision peak.

### 9 · Bait (par 8, red first, cup holds `top`)

Floor 620. Sunken channel 490–760 at y 640 under the wall 650–690 (cap 200–520; DOOR 520–640 flush on the
channel floor, held by `bait` OR `top`). The BAIT plate 490–610 is a seat inside the jaws `bait-trap`
(480–610 × 590–640, released only by TOP) and covers the trap's whole restable floor: Appendix A's 490–600
plate left a 600–610 strip where a ball was caught WITHOUT holding the door, a softlock the solver's traps
pass found (the partner can still shoot, so the scoped reset never runs). Yard 800–960 with sand 820–950; raised spring mouth (lip 961–968 at
y 564, SPRING 976–1040 at y 580, launch (200, −740)). 360 px cliff at 1240; TOP 1300–1440 in the sand bowl
1260–1480; drop at 1560 to the terrace at 440, cup 1840, back bunker 1910–1960. Line: red rolls onto BAIT and
is caught (the door opens) → blue rolls through past red into the yard → blue lobs into the spring mouth,
keeping every turn while red is caught, and lands on TOP (red freed, the door held) → red rolls out and climbs
→ both chip down and putt. Watch-outs: pairs who refuse the bait; whether the bait holder feels idle.

### 10 · Sky Bridge (par 7, BLUE first, cup holds `b`)

Cannon drum 41–160 (top 580) around the breech 76–124 at y 600 (launch (520, −760), lit by `a`, `b` OR
`deck`). Tees 280 / 330 on the flat to 600; SPRING 442–498 (launch (120, −690)). Spire A (face at 600, top 400):
plate A 670–790 in the sand bowl 640–820. Chasm 860–1580 under the BRIDGE at y 400 (held by `a`, `b` OR `deck`;
DECK 860–1580, lip to lip since D11). Spire B: plate B 1630–1740 in the sand bowl 1600–1770, green 1830–1960 at
y 390, cup 1875, back bunker 1920–1960. Line: blue chips LEFT into the cold cannon and waits, LOADED → red rides
the spring onto A: the touch raises the bridge, lights the cannon and fires blue onto B, and red stays on A until
blue lands → blue putts → red crosses from A and putts. Second route: both ride the spring onto A and cross one
at a time. Watch-outs: whether A, the bridge and BOOM read as one cause and effect; trusting the wait in a cold
cannon; a lone DECK ball rolls off (a high lob lifts off the deck and drops the planks); the ball that fires the
cannon stays on A (or B) until the fired ball lands, because the bridge lasts only while a ball is on A, B or
the DECK. Since D11 a firm flat shot that skims across A's bowl fires blue and rolls off, and blue drops into the
chasm (+1): 0 of 2,579 partner-firing first shots from the tee flat do it (the spring ride and every bowl landing
end on A), 47–52 of 2,789–4,003 from each spire-top spot beside the bowl, all at power 72 or more within 12° of
flat (1–3 of 105–148 on the human grid); D11 accepts it ("D11" above).

### 11 · Crossfire (par 7, red first, cup holds `far`)

FIRE ledge 0–200 at y 520 (FIRE 60–180 at y 530) behind a full-height BLUE field 230–270 (200–640). Floor 620
(tees 420 / 470) to 740; RED field 700–740 (200–520) over the DOOR 520–640 (`far`). Cannon pit: sand 741–779 /
841–899 around the breech 780–840 at y 640 (launch (440, −730), lit by `fire` OR `far`); its right side runs on
to the chasm lip at (900, 610), so the breech is the only resting spot right of the door. Chasm 900–1460. Far
plateau at y 400: FAR 1500–1700 in the sand bowl 1480–1720; cup 1860, back bunker 1910–1960. Line: red moves up
to x 600–660 → blue lobs LEFT through its field onto FIRE → red lobs through the red field into the pit and is
fired onto FAR (or waits LOADED) → FAR opens the door and keeps the cannon lit; red putts → blue drops off the
ledge, rolls through the door into the cannon, flies onto FAR and putts. Watch-outs: blue trying to load the
cannon (the red field bounces it); red lobbing from the tee instead of moving up first.

### 12 · Grand Machine (par 7, red first, cup holds `top`)

Pit 0–40 at y 640 under the jaws `pit` (12–40 × 590–640, released by FIRE or TOP). Cannon mount 41–200 (top
540): sand funnel 41–99 / 141–199 around the breech 100–140 at y 565 (launch (700, −760), lit by `fire` OR
`top`). Tees 300 / 350; FIRE 460–560 in the dish 420–600. Seat channel 680–1180 at y 640 under the wall
820–860 (cap 200–520; DOOR 520–640 flush on the channel floor, held by `door` OR `top`); the DOOR plate 680–780
is a seat inside the jaws `door-seat` (680–780 × 590–640, released only by TOP); SPRING 972–1028 on the channel
floor (launch (180, −800)). 320 px cliff at 1180: the TOP basin 1215–1690 at y 334 (sand 1205–1690, plate
1230–1680), a dirt face at 1691, a step down at 1731 to the green at 400, cup 1850, back bunker 1900–1960.
Lines: FLY (red lobs LEFT into the cannon and waits LOADED → blue rolls onto FIRE, whose first touch fires red
onto TOP (D11) → blue lobs in and flies up) or CLIMB (red rolls onto the DOOR seat and is caught → blue rolls through to the spring
and lands on TOP, freeing red → red climbs). TOP holds the door, lights the cannon and frees both traps; the
cup holds TOP. Watch-outs: which route first-time pairs pick; overshooting the mount into the pit; the
leftward lob near the left edge on touch.

## Launcher re-verification (worlds 2-3, with the real cannon and trap)

Every launcher case of `design/proposals/worlds-2-3/tools/check.ts` ("launchers"), on the REGISTERED levels:
a ball dropped 1 px above the pad or breech at every x of `[x, x + w]` in 0.5 px steps, for 9 launch
perturbations (each component at 97 / 100 / 103 %, on a spread copy of the compiled level), with the switch
map fixed (a cannon lit through a FIRE plate held in that map), stepped with `stepBall` until it rests. A drop
passes when the ball rests holding the target plate; a re-fire is a second `spring` / `cannonFire` in one
drop. Each cannon was also fired LOADED: a ball resting on the breech when the cannon lights (the wake rule).

| case | plates held | drops on target | LOADED fires on target | rest x | apex centre y, nominal / worst ±3 % |
|---|---|---|---|---|---|
| L5 spring → TOP (blue) | DOOR | 1,017 / 1,017 | — | 1254.0–1366.7 | 98.5 / 67.2 |
| L7 cannon → far FIRE (red) | FIRE | 729 / 729 | 729 / 729 | 1603.7–1717.2 | 161.1 / 137.3 |
| L8 spring → WINDOW (blue, bounces off the red field) | WINDOW | 1,017 / 1,017 | — | 1053.7–1098.0 | 123.2 / 93.5 |
| L8 spring → DOOR (red, flies through the red field) | WINDOW | 1,017 / 1,017 | — | 1464.7–1596.4 | 123.2 / 93.5 |
| L9 spring → TOP (blue) | BAIT | 1,161 / 1,161 | — | 1312.7–1417.5 | 132.5 / 105.8 |
| L10 spring → A (red) | — | 1,017 / 1,017 | — | 683.0–749.1 | 229.7 / 206.5 |
| L10 cannon → B (blue, bridge up) | A | 873 / 873 | 873 / 873 | 1672.6–1719.7 | 125.6 / 97.4 |
| L11 cannon → FAR (red) | FIRE | 1,089 / 1,089 | 1,089 / 1,089 | 1551.3–1696.7 | 203.0 / 177.0 |
| L11 cannon → FAR (blue) | FIRE, FAR | 1,089 / 1,089 | 1,089 / 1,089 | 1551.3–1696.7 | 203.0 / 177.0 |
| L12 cannon → TOP (red) | FIRE | 729 / 729 | 729 / 729 | 1379.7–1590.7 | 92.5 / 64.3 |
| L12 spring → TOP (blue) | DOOR | 1,017 / 1,017 | — | 1298.2–1402.9 | 118.5 / 87.2 |

All 10,755 drops and 4,509 LOADED fires rest on their target plate with exactly one launch: 100 % on target,
0 re-fires, 0 missed launches. The other colour on every launcher both balls ride in the intended lines (L5
red and L9 red with TOP held, L7 blue with the far FIRE plate held, L10 spring blue and cannon red, L12 cannon
blue and spring red with TOP held) adds 6,543 drops and 2,331 LOADED fires, with the same result. The longest
flight to rest takes 341 ticks (L5). Nominal apexes stay below the 68 px top HUD band (centre y ≥ 92.5); at
+3 % the L12 cannon (64.3) and the L5 spring (67.2) graze it, as the design measured.

Gate checks on the same levels (`predictShot`, the 162-shot human grid of 5–90° × power 20–100, nobody on any
plate): the shut doors of L5, L6 and L9 let 0 of 324 shots from the tees past their wall; with L7's cannon
cold, 0 of 1,620 shots from the approach (x 650–830, both colours) rest beyond the chasm; L12's flush-footed
door lets 0 of 60 low rolls (2–15°, power 30–100) from the seat channel through; and every ball dropped into
L6's trap dish (x 361–459) comes to rest inside the armed jaws (99 of 99).

The solver's `launchers` pass (below) repeats these rides for both colours on every run, with the plates each
intended line holds at that moment.

## Verification recipe (`scripts/solver.ts`, built on the real sim)

```
npm run solve -- all --json <out.json>                                   # every pass on all 12 holes (~30 min)
npm run solve -- w3                                                      # one world: w1, w2 or w3
npm run solve -- w1-03-colour-keys --pass coop,wide --wideBeam 120       # a deeper co-op search
npm run solve -- w1-04-plate-and-bridge --pass gaps,stall,deck
npm run solve -- w3-12-grand-machine --pass launchers,loops,traps        # the device passes (D10.13)
npm run solve -- w3-09-bait --write-goldens                              # re-record its golden line (runs no pass)
npm run test:levels                                                      # the slow suite (three shards in parallel)
```

`scripts/solver.ts` is the CLI and re-exports the modules of `scripts/solver/`: `game.ts` (shots, grids and the game
driver), `search.ts` (the co-op and solo searches), `sweeps.ts` (aces, walls, gaps and `OPT_OUTS`), `lines.ts` (the
intended lines and the goldens), `plates.ts` (stall taps and the deck), `devices.ts` (launchers, loops and traps) and
`verify.ts` (the criteria and `verifyLevel`). The solver drives full two-ball games with `createSim` / `stepSim` (turn
order, held plates, `cupHoldsSwitch`, partners falling off a vanished bridge, the WAITING rule, partner-fired cannons,
scoped resets and the flight watchdog), proves every solved line with `runReplay`, sweeps single shots with
`predictShot` (the partner passed as `otherBalls`) and asks `evaluateSwitches` who presses what. Shots are designer
units (degrees above the horizontal: 0 right, 90 up, 180 left; power 10–100) quantised through `aimOf` exactly like
the client. Its tables (`SCRIPTED_LINES`, `PAR_SLACK_BY_ID`, `LAUNCHER_CASES`, `OPT_OUTS`) are keyed by level id
(D10.1). Defaults: the 16 × 8 cell grid (`--angles`, `--powers`), beam 6 (`--beam`), wide beam 60 (`--wideBeam`),
depth = the highest selected par + 3 (`--depth`), 900 s per search (`--maxSeconds`), 400 traps games (`--games`).
Passes and pass criteria (exit code 1 when any fails, 2 on bad arguments; `walls`, `gaps`, `stall`, `deck` and the
device passes report only on holes that have their subject):

- `coop` — bucketed beam search over `stepSim` (16 angles × 8 powers, beam 6 per bucket, depth ≥ par + 3;
  buckets = sunk flags × caught / loaded / free flags × held switches × active player; a shot the flight watchdog
  has to end is never built on): both balls sunk within par + 3 (`coop-solvable`); the solved line's command log
  re-run through `runReplay` reproduces the state exactly (`replay-deterministic`).
- `wide` — the same search at beam 60 (`--wideBeam`, at least 60) also holes both balls within par + 3
  (`coop-wide-solvable`). The better of the two runs is the solver minimum and calibrates par (`par-calibrated`):
  `par − 2 ≤ minimum ≤ par`, the LEVELS.md rule "par = scripted line, at most solver minimum + 2" (D9, D10.13).
  `PAR_SLACK_BY_ID` carries the one documented exception, `w1-03-colour-keys` at slack 3 ("Pars" below), shared
  with the suite.
- `solo` — `predictShot` chains (depth ≥ 10, beam 40) with the partner parked on its tee; `predictShot` re-evaluates
  the plates every tick, so a lone ball that presses a plate on its way (D11: rolling or bouncing across it) opens
  that door or bridge for exactly as long as it does in the game. A lone ball that ends
  caught or loaded is a dead end (the WAITING rule would hand every turn to the parked partner). On every co-op
  hole (a plate, a colour field, a trap or a cannon: holes 2–12) neither ball holes out and 0 first shots sink
  (`solo-not-bypassable`, `solo-first-shot-zero`); hole 1 is solvable alone by design (`solo-reference`).
- `aces` — 0 one-shot sinks or gimmes from either tee, partner parked, every switch off (`no-aces`): the fine
  sweep (1–89° step 1 × power 95/97/100 = 267 shots) and the human grid (5–90° step 5 × power 20–100 step 10 =
  162), each rightward and mirrored leftward (`ACE_GRIDS`), 858 shots per tee. Until D10.13 the sweep was
  rightward only (429 per tee, the count in the World 1 walkthrough and final table).
- `walls` — with every switch off, a ball a wall column blocks never gets past it (`wall-pass-zero`): it shoots from
  its tee's side (rightward from the left, mirrored from the right), from the tees on that side and from
  600/400/250/120/60 px short of the column wherever a ball can rest with the turn (not inside a door, on a spring,
  caught or loaded), on the fine and the human grid; per column the highest ball centre stays more than a ball
  radius below the wall top (`wall-top-clear`: y > 188 under a top at 200).
- `gaps` — with no plate held (bridges absent, cannons cold), 0 shots of either ball from its tee or from
  300/200/100/40 px short of the near lip end past the far lip (`gap-crossing-zero`); over a bridged chasm a lone
  ball shooting at the chasm from a bridge plate (partner on its tee; five shots into the chasm plus the 162-shot
  human grid, rightward from a near plate and mirrored from a far one, from the plate's centre and from its
  chasm-side end) keeps the bridge only while it is on that plate (D11), which ends 32 px or more short of its lip
  while a ball moves at most 18.5 px a tick, so it never touches the planks, every shot that leaves the plate drops
  the bridge, the five chasm shots from the plate's centre all fall and none rests across the chasm
  (`lone-plate-never-crosses`; until D11 a plate came up the tick its ball was struck, and only those five shots
  from the near plate were played).
- `OPT_OUTS` — the only exceptions to `walls` and `gaps`, one row each (D10.13): Booby Trap's `backboard` column is
  not swept (a backstop behind the PERCH bowl, not a gate); Crossfire's rows from the FIRE ledge (x 0–200) are
  exempt from `wall-top-clear` (their passes still count); the Load & Fire and Crossfire chasms get no lone-plate
  check (a cannon crosses them, not a bridge). Each row is a criterion of its own (`opt-out: …`) that fails once it
  no longer describes its hole (the column became a gate, no ledge row remains or one passes, the chasm gained a
  bridge or no lit cannon lands beyond it), and the suite asserts that every skip comes from this table.
- `scripted` — every intended line in `SCRIPTED_LINES` (the "How it plays" lines of both LEVELS.md files plus the
  variants: the L1 sand line, the L4 deck line, the L6 rescue line, the L7 load line, the L10 spring route and the
  L12 climb) replays beat by beat: each beat takes the FIRST grid shot satisfying its predicate (an upper bound on
  the line), the sim's turn order (the WAITING rule included) must match the line's, and both balls must be sunk
  within par + 2. Exactly one line per hole is `golden`.
- `stall` — holder taps (90/10, 90/15, 80/20, 100/15) from every plate but the seats (L9 BAIT, L12 DOOR: a caught
  holder never shoots) never let the plate up: the highest rises 13 px, far under `PLATE_HOLD_HEIGHT_PX`, so there
  is no `switchOff` during the tap and its door or bridge never flickers (D11); the holder ends on its plate and a
  partner parked on its tee, on another plate or on the bridge deck never falls (`stall-taps-safe`). Until D11
  the plate came up for the whole tap and only the re-hold on landing was asserted.
- `deck` — balls resting 1–24 px outside either lip (on the terrain) never press DECK; every rest on the planks
  does, 1 px inside either lip included, because the DECK spans its bridge (`deck-lip: …`); a lone deck ball
  (`{deck}` held, partner on its tee) shot from the near end, the centre and 240 px short of the far lip keeps
  the planks under it on every roll within 7° of the horizontal, either way, at power 40–100: none falls and
  rolls toward the cup reach the far side (`deck-lone-roll-keeps-bridge`); every 45° lob at power 80–100 rises
  above `PLATE_HOLD_HEIGHT_PX`, releases DECK in flight and never comes down on the planks, and at least one
  carries to the far side (`deck-lone-lob-lifts-off`): the rule the L4 and L10 watchOut copy teaches. Until D11
  the opposite held (the deck let go the tick its ball moved, so every roll fell).
- `launchers` — every spring and cannon ride of the intended lines (`LAUNCHER_CASES`, both colours where both ride,
  with the plates the line holds at that moment fixed): a ball dropped 1 px above every pad or breech x in 0.5 px
  steps, for 9 launch perturbations (each component at 97 / 100 / 103 %), rests holding its target plate after
  exactly one launch, and a cannon is also fired LOADED (resting on its breech as it lights). Every spring and
  cannon has a case and every case names the hole's own rects and plates (`launchers-cover-every-launcher`), every
  drop lands on target (`launchers-land-on-target`), 0 re-fires and 0 drops that never launch
  (`launchers-fire-once`), and no bounce of a landing lets the target plate up while the ball is still over it
  (`launchers-hops-hold`, D11: a landing's hops stay under `PLATE_HOLD_HEIGHT_PX`, so its door, trap or cannon
  never flickers through bounces; a landing that rolls off the plate's end onto its bowl and back is a pass-over
  D11 accepts, counted in the detail).
- `loops` — on holes with a spring, trap or cannon: single-ball flights with the switches fixed (all plates up,
  then all held) from every restable spot every 20 px plus each plate, trap and breech centre, both colours, 94
  shots each (5–175° step 10 × power 20–100 step 20, plus the stall taps): none is still flying when the
  1,800-tick flight watchdog (D10.6) would end it (`loops-zero`).
- `traps` — on holes with a trap or cannon: 400 seeded games from the tees (`--games`; angle 2–178° × power
  10–100 from mulberry32, up to 30 shots each) plus every one-shot grid deviation from every turn of every intended
  line, on the full sim. The send-to-tee guard never runs (`traps-tee-guard-never-runs`); every scoped reset
  (BACK +1) lands where its ball last stood free, at most two per shot (`traps-reset-to-safe-spot`); a safe spot is
  only ever where its ball stood free (`traps-safe-spots-free`); every stroke is a hit, a gimme, a fall or a
  BACK +1 (`traps-strokes-accounted`); no flight reaches the watchdog and no hand-off stalls (`traps-no-watchdog`);
  every trap and cannon holds a waiting ball at some turn (`traps-every-device-reached`); and from every distinct
  caught or loaded state (deduped by device, the free ball's 32 px cell and the held plates) a beam search of at
  most 4 shots gets one of the device's release or FIRE plates held, by a resting ball or from the cup
  (`traps-rescuable`: the check that found Bait's 600–610 strip).

`npm run solve -- <levelId|w1|w2|w3|all> --write-goldens` re-records the `golden` line of every selected hole
(replayed on the 16 × 8 grid) into the generated block of `src/sim/__tests__/levels-golden.ts`, keeps the other
holes' entries and runs no pass. Re-record only after a change that is meant to move a golden, and review the diff.

The slow suite is `src/sim/__tests__/levels-solver-suite.ts`: `verifyLevel` once per hole with every pass (16 × 8
grid, beam 6, wide beam 60, depth max(8, par + 3), 600 s per search, 400 traps games) and each criterion asserted
in its own `it`; it also re-runs every scripted line through `runReplay`, re-records the golden line and compares
it with `levels-golden.ts`, and checks that every key of the solver's tables names a registered level. The shards
`levels-solver-w{1,2,3}.test.ts` call it for one world each. `npm run test:levels` runs all three in parallel
vitest workers (World 3, the heaviest, took about 14 min alone and all three about 19 min on a 4-vCPU machine);
`npm test` excludes them; `.github/workflows/levels.yml` runs one CI job per world (45 min limit each) when
`src/sim/**`, the solver or the build configuration changes (the workflow lists the paths), and on demand.
`levels.test.ts` (fast) replays each hole's golden from `levels-golden.ts` through `runReplay` and compares the
final snapshot bit for bit.

### Final table (D11 at a hold height of 72, all 12 holes, 2026-11-02: `npm run solve -- w1`, `w2`, `w3`)

Plates pressed by any ball on them (BUILD_DECISIONS D11) and held through hops of up to 72 px, the L4 and L10 decks
lip to lip, Crossfire at par 7. All 222 criteria pass (8 / 11 / 11 / 15 on World 1, 16 / 21 / 24 / 16 on World 2,
23 / 27 / 26 / 24 on World 3; `par-calibrated` on Colour Keys with the documented slack, below), every solved co-op
line and every scripted line replays bit-exactly through `runReplay`, and the slow suite (`npm run test:levels`)
passes on the same code. Times on a shared 4-vCPU machine: World 1 4 min, World 2 8 min, World 3 14 min.

| hole | par | co-op beam 6 | wide beam 60 | min | solo P1 / P2 (reachableX) | aces | walls (passes, highest y) | gaps (crossings) / lone plate | scripted | stall |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 First Fairway | 6 | 4 (2+2), 2,436 shots | 4 (2+2), 23,172 shots | 4 | SOLVED 2 / SOLVED 2 by design (1190) | 0/858 · 0/858 | — | — | 4 · sand line 5 | — |
| 2 Two Doors | 7 | 5 (3+2), 9,860 shots | 6 (3+3), 53,032 shots | 5 | no (850) / no (850) | 0/858 · 0/858 | 0/6,006, y 264 | — | 6 | 16 taps, 0 releases |
| 3 Colour Keys | 8 | 6 (3+3), 9,861 shots | 5 (2+3), 68,358 shots | 5 | no (428) / no (1148) | 0/858 · 0/858 | 0/5,577, y 273 | — | 7 | 16 taps, 0 releases |
| 4 Plate & Bridge | 7 | 6 (3+3), 11,652 shots | 6 (3+3), 100,740 shots | 6 (5, "Pars") | no (470) / no (469) | 0/858 · 0/858 | — | 0/4,290; 0/660 | 7 · deck line 7 | 24 taps, 0 releases |
| 5 Spring Step | 7 | 5 (3+2), 10,500 shots | 5 (3+2), 92,420 shots | 5 | no (600) / no (600) | 0/858 · 0/858 | 0/6,006, y 273 | — | 5 | 16 taps, 0 releases |
| 6 Booby Trap | 6 | 4 (3+1), 9,240 shots | 4 (3+1), 60,440 shots | 4 | no (968) / no (968) | 0/858 · 0/858 | 0/5,148, y 273 | — | 5 · rescue 7 | 36 taps, 0 releases |
| 7 Load & Fire | 8 | 6 (3+3), 17,029 shots | 6 (3+3), 145,925 shots | 6 | no (926) / no (925) | 0/858 · 0/858 | — | 0/3,432 | 8 · load line 8 | 16 taps, 0 releases |
| 8 Colour Lift | 8 | 6 (3+3), 8,352 shots | 6 (3+3), 64,800 shots | 6 | no (188) / no (1187) | 0/858 · 0/858 | 0/4,290, y −27 | — | 7 | 16 taps, 0 releases |
| 9 Bait | 8 | 6 (3+3), 19,464 shots | 6 (3+3), 176,007 shots | 6 | no (638) / no (638) | 0/858 · 0/858 | 0/4,290, y 273 | — | 7 | 8 taps, 0 releases |
| 10 Sky Bridge | 7 | 5 (2+3), 20,488 shots | 5 (2+3), 173,838 shots | 5 | no (860) / no (859) | 0/858 · 0/858 | — | 0/4,290; 0/660 | 5 · spring route 7 | 24 taps, 0 releases |
| 11 Crossfire | 7 | 5 (2+3), 15,110 shots | 5 (2+3), 127,750 shots | 5 | no (837) / no (688) | 0/858 · 0/858 | 0/6,006, y 273 | 0/2,574 | 8 | 16 taps, 0 releases |
| 12 Grand Machine | 7 | 5 (3+2), 37,029 shots | 5 (3+2), 315,429 shots | 5 | no (808) / no (808) | 0/858 · 0/858 | 0/4,290, y 273 | — | fly 5 · climb 5 | 24 taps, 0 releases |

| hole | deck (lip / planks; lone rolls; lone 45° lobs) | launchers (on target; hop releases; roll-offs) | loops (running / flights, plates up · held) | traps (rescued; resets; finished games; shots) |
|---|---|---|---|---|
| 4 Plate & Bridge | 0/48 lip rests press it, 16/16 plank rests do; 0/72 rolls fall, 28 cross; 9/9 lift off, 6 cross | — | — | — |
| 5 Spring Step | — | 2,034/2,034; 0; 1,934 | 0/14,852 · 0/15,228 | — |
| 6 Booby Trap | — | — | 0/12,220 · 0/13,348 | 54/54; 1,125; 4/400; 13,519 |
| 7 Load & Fire | — | 2,916/2,916; 0; 30 | 0/10,904 · 0/10,904 | 43/43; 1; 9/400; 13,896 |
| 8 Colour Lift | — | 2,034/2,034; 0; 57 | 0/14,194 · 0/14,758 | — |
| 9 Bait | — | 2,322/2,322; 0; 0 | 0/14,852 · 0/16,732 | 88/88; 755; 5/400; 12,885 |
| 10 Sky Bridge | 0/48 lip rests press it, 16/16 plank rests do; 0/72 rolls fall, 28 cross; 9/9 lift off, 6 cross | 5,526/5,526; 0; 0 | 0/9,588 · 0/9,588 | 40/40; 73; 94/400; 12,770 |
| 11 Crossfire | — | 4,356/4,356; 0; 48 | 0/10,152 · 0/10,716 | 16/16; 0; 21/400; 12,742 |
| 12 Grand Machine | — | 4,950/4,950; 0; 0 | 0/13,536 · 0/15,792 | 123/123; 310; 78/400; 12,713 |

**72 against 56.** These tables were first measured at a hold height of 56. Re-run at 72, every search, solo chain,
ace, wall and gap sweep, scripted line, stall tap, deck check, launcher drop and loop flight returns the same
result. The only numbers that moved come from a ball rising between 56 and 72 px above the plate it stood on: at 56
the plate came up in flight (and went down again if the ball landed back on it), at 72 it stays down.

- **L4.** In `lone-plate-never-crosses`, one of the 660 shots (115°/50 from plate B's centre, 67.5 px up) drops
  the bridge once instead of twice. It still falls.
- **L6.** In the traps pass, 24 of the 13,519 shots are near-vertical lobs (73–102°, power 42–47) off FREE (23) or
  the PERCH (1), and none of them lets its plate up now. In 8 of them the partner sat in the jaws, which closed on
  it again until the landing: trapCaught 4,787 → 4,779, trapFreed 3,428 → 3,420. The state after every shot is
  unchanged.
- **L10.** Lobs off A, B or the DECK behave the same way. Six from the DECK (power 44–97) now end differently: at
  56 the planks vanished under them and they fell (+1); at 72 the deck keeps the planks until the ball lands on
  them, on the near spire, on A or B, or (one 26°/97 drive) in the cup. One of those games then runs 30 shots
  instead of finishing in 25. That shifts the seeded draws of the last 71 games: 94 of 400 games finish (93 at
  56), 12,770 shots (12,800), cannonLoad 223 (221), cannonFire 456 (454), turnSkipped 447 (439), and 597 turns
  have a waiting ball (587). The rescues (40 / 40) and the resets (73) are unchanged.
- **L12.** Lobs off TOP, FIRE or the DOOR seat behave the same way, and the 8 among them with a partner in the
  jaws no longer re-catch it mid-lob: trapCaught 915 → 907, trapFreed 670 → 662. In two seeded games red's lob
  off TOP used to shut the door on blue standing in the doorway, pushing it 15 or 26 px aside; now the door
  stays open. No game changes length, so every other count stands.

Every traps row also has 0 send-to-tee guards, 0 watchdog endings, 0 stalled hand-offs, every reset on its ball's
safe spot and every stroke accounted for. Beyond the passes, three scratch hunts aimed at what D11 could break
found nothing, at 56 and again at 72: a lone ball shot ACROSS every plate at the door, window or bridge it drives
(from every restable spot up to 320 px behind it, every 20 px, both colours unless the wall has a field of their own
colour, 1–31° × power 20–100) got through 0 times in 265,965 shots; 1,800 seeded random full-sim games on the six
holes without a trap or cannon (52,134 shots) ended no flight by the watchdog, stalled no hand-off and ran no tee
guard; and no other terrain lies within `PLATE_HOLD_HEIGHT_PX` above any plate (none lies above any plate at all).

Solver lines under D11 (the better of the two searches; degrees/power → rest x; `[held]` after the shot):

- L1 (4): P1 29/94 → 986 · P2 29/94 → 993 · P1 7/49 SINK · P2 7/49 SINK.
- L2 (5): P1 18/94 → 814 [door] · P2 7/72 → 1178 [door, window] · P1 62/94 → 1472 [window] · P2 7/72 SINK · P1 7/49 SINK.
- L3 (5): P2 62/94 → 970 [door1] · P1 29/61 → 966 [door1] · P2 29/38 → 1147 [door1] · P1 51/94 SINK [door2] · P2 7/72 SINK.
- L4 (6): P1 62/72 → 430 [near] · P2 29/72 → 1233 [deck, near] · P1 7/94 → 1680 [deck] · P2 7/72 SINK (a gimme) · P1 7/49 SINK.
- L5 (5): P1 7/94 → 588 [door] · P2 73/94 → 1300 [door, top] · P1 40/72 → 1323 [top] · P2 7/49 SINK · P1 7/49 SINK.
- L6 (4): P1 118/83 → 270 [perch] · P2 29/94 SINK [far, perch] · P1 29/94 SINK.
- L7 (6): P1 62/94 → 804 · P2 7/94 → 575 [fire] · P1 73/72 → 1682 BOOM · P2 51/83 → 1681 BOOM · P1 7/61 SINK · P2 7/61 SINK.
- L8 (6): P2 40/72 → 1070 [window] · P1 73/83 → 1580 [door, window] · P2 7/49 → 1146 · P1 18/49 SINK · P2 40/94 SINK.
- L9 (6): P1 18/94 → 603 CAUGHT [bait] · P2 40/94 → 923 · P2 73/61 → 1388 [bait, top] · P1 18/83 → 1335 [top] · P2 7/83 SINK · P1 7/94 SINK.
- L10 (5): P2 29/27 → 751 [a] · P1 129/49 → 1703 BOOM [a, b] · P2 18/72 → 1530 [b, deck] · P1 7/83 SINK · P2 7/94 SINK.
- L11 (5): P1 51/83 → 802 LOADED · P2 118/83 → 26, its touch on FIRE fires red onto FAR [far] · P1 7/72 SINK ·
  P2 18/83 → 1655 BOOM (off the ledge, through the door the cup holds open, into the cannon) · P2 7/72 SINK.
- L12 (5): P1 73/72 → 531 [fire] · P2 106/72 → 1503 BOOM [fire, top] · P1 129/83 → 1503 BOOM [top] · P2 51/61 SINK · P1 51/61 SINK.

The golden lines (first grid shot per beat) are recorded in `levels-golden.ts`.

### Pars

LEVELS.md's rule: par is the scripted intended line, at most solver minimum + 2, never below the minimum
(gold = one great shot, silver = the line, bronze absorbs a duff per ball). Every solver minimum below is
STRUCTURAL (turn order and the mechanics force it; no geometry change within the 1960 px overview width can
raise it). Re-verified under D11 (plates pressed on contact, 2026-11-02): no World 1 minimum moved, at a hold
height of 56 or of 72.

| hole | minimum | why it is the floor | scripted | LEVELS.md par | shipped par |
|---|---|---|---|---|---|
| 1 | 4 | no ace from either tee, so 2 + 2 (sand landing, hole-out from the sand) | 4 · sand line 5 | 6 | **6** (4 ∈ 4..6) |
| 2 | 5 | red parks, lobs the window, sinks (3); blue rolls through onto the WINDOW plate, sinks (2) | 6 | 7 | **7** (5 ∈ 5..7) |
| 3 | 5 | blue lobs onto DOOR 1 plate, must shoot once while DOOR 2 is shut, rolls in (3); red rolls through DOOR 1, lobs the red field and holes out, which holds DOOR 2 from the cup (2) | 7 | 9 | **8** (D2's −1; 5 is par − 3) |
| 4 | 5 | red chips onto A, crosses, sinks (3); blue crosses, sinks (2). Under D11 both searches meet a 5-shot line with a gimme (6 strokes) first and report 6, because blue's deck rest moved to 1233 (lip to lip); the 5-stroke line of the earlier table still holes out in 5 (62°/72 → 430, 7°/72 → 1187 on the deck, 7°/94 → 1680, 7°/83 SINK, 7°/49 SINK; replayed at 56 and at 72) | 7 · deck line 7 | 8 | **7** (5 ∈ 5..7) |

Worlds 2-3 are calibrated the same way (D10.13: solver minimum ≤ par ≤ minimum + 2, the design's proposal as the
target, so par = min(proposal, minimum + 2)). Minimum = the better of `coop` (beam 6) and `wide` (beam 60) with
the slow suite's options (`npm run solve -- <id> --pass coop,wide --maxSeconds 600`); scripted = the golden line.
These minimums are search results, not proofs of a floor. Re-verified under D11 (2026-11-02): only Crossfire's
moved, 6 → 5, because a LOADED red now fires on blue's first touch of FIRE, so blue's lob may run on past the plate
to the ledge's end and roll from there through the door into the cannon (par 8 → 7). Raising the hold height from 56
to 72 moved no minimum, line or scripted count:

| hole | minimum (coop / wide) | the solver's line | scripted | LEVELS.md par | shipped par |
|---|---|---|---|---|---|
| 5 | 5 (5 / 5) | red parks on DOOR; blue rides the spring onto TOP; red rides up; both chip in from TOP | 5 | 7 | **7** (5 ∈ 5..7) |
| 6 | 4 (4 / 4) | red lobs LEFT onto the PERCH (118°/83); blue holes out from its tee through the open door (29°/94); red holes out from the perch (29°/94; the cup holds FAR) | 5 · rescue 7 | 7 | **6** (7 > 4 + 2) |
| 7 | 6 (6 / 6) | red lobs to 804; blue rests on FIRE; red BOOM onto the far plate; blue lobs into the lit funnel (BOOM); both putt | 8 · load line 8 | 8 | **8** (6 ∈ 6..8) |
| 8 | 6 (6 / 6) | blue's spring bounce onto WINDOW; red's window lob through the red wall onto DOOR; blue moves up; both sink | 7 | 8 | **8** (6 ∈ 6..8) |
| 9 | 6 (6 / 6) | red rolls to 611 (just outside the jaws); blue rolls onto BAIT, CAUGHT; red rolls from 611 through the door straight into the raised spring onto TOP; blue climbs from the channel; both sink from TOP | 7 | 9 | **8** (9 > 6 + 2) |
| 10 | 5 (5 / 5) | blue rides the spring onto A; red lobs LEFT into the lit cannon onto B (129°/49); blue onto the deck; both sink | 5 · spring route 7 | 7 | **7** (5 ∈ 5..7) |
| 11 | 5 (5 / 5) | red lobs from its tee into the cold cannon (51°/83, LOADED); blue lobs LEFT through its field (118°/83): its touch on FIRE fires red onto FAR and it rolls on to the ledge's end; red sinks; blue rolls off the ledge, through the door (the cup holds FAR) into the cannon (BOOM); blue sinks | 8 | 8 | **7** (8 > 5 + 2; was 8 at minimum 6 before D11) |
| 12 | 5 (5 / 5) | red rests on FIRE; blue lobs LEFT into the lit cannon onto TOP; red lobs LEFT from the FIRE dish into the cannon (TOP keeps it lit); both chip in | fly 5 · climb 5 | 8 | **7** (8 > 5 + 2) |

Course pars: World 1 28, World 2 29, World 3 29 (30 until D11 lowered Crossfire).

Colour Keys is the one hole where the rule cannot be met inside BUILD_DECISIONS D2's ±1: the real roll
(twice the old build's) collapses "chip to the green, then putt" into one roll-in from either bowl, and
`cupHoldsSwitch: 'door2'` (D2) lets red's field lob hole out instead of resting on the DOOR 2 plate. The
rule's answer is par 7 (the scripted line); D2 caps the change at 8. `scripts/solver.ts` encodes the exception
explicitly (`PAR_SLACK_BY_ID`, slack 3 for `w1-03-colour-keys`; the test and the CLI criterion share it) so a lead
decision to waive the cap is a one-line change there plus `par: 7` in the level file. Human play is slower
than the grid: the blue lob onto the DOOR 1 plate succeeds for about 7 % of human-grid shots, so a typical pair
still finishes Colour Keys around 9–10 and the pars read as "silver for a clean pair, gold for one hole-out".
