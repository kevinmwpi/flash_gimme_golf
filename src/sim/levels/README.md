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
| 11 | `w3-11-crossfire` | Crossfire | 1960 × 720 | 8 | red | cup → `far` | — | cannon `cannon` [`fire`, `far`] |
| 12 | `w3-12-grand-machine` | Grand Machine | 1960 × 720 | 7 | red | cup → `top` | — | trap `pit` [`fire`, `top`], cannon `cannon` [`fire`, `top`], trap `door-seat` [`top`] (the DOOR seat) |

Every trap and cannon lists the cup's plate among its own, so a sunk partner always frees a caught ball and
lights a cold cannon (asserted in `levels.test.ts`). Back bunkers sit 60 / 50 / 50 / 70 / 70 / 45 / 50 / 50 px
behind the cups of holes 5-12; every plate edge is at least 135 px from its cup (L10 B, the tightest). Course
pars 29 (World 2) and 30 (World 3): the solver calibrated the design's proposals (30 and 32) to solver minimum ≤
par ≤ minimum + 2 (D10.13), lowering holes 6, 9 and 12 by one each ("Pars" at the end).

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
| plate | `PressureSwitch` (HELD: pressed while a RESTING (asleep) ball's centre is inside `[x, x+w]`; released the tick the holder moves, so a moving ball presses nothing) | `{ id, centerX, w, colour: SWITCH_COLOUR, label }` |
| deck plate | `PressureSwitch.onRectId` = the bridge; `surfaceY` = the bridge top | `{ ..., onRectId: 'bridge' }` |
| dish / bowl | ordinary terrain polyline, 20 px deep, 50 px ramps (≈ 22°, above `REST_MAX_SLOPE`, so balls roll back onto the flat plate) | surface points |
| bridge | one `bridge` rect, `x = gap.x1`, `w = gap width`, top = mean lip height, `switchIds` (OR) | `{ kind: 'bridge', gap, switchIds, label: 'BRIDGE' }` |
| sand | flush `sand` range | `{ kind: 'sand', x1, x2 }` |
| spring | flush pad: any ground contact sets the velocity to `launch` | `{ kind: 'spring', centerX, w, launch, label: 'SPRING' }` |
| trap (jaws) | `trap` rect in absolute coordinates, ARMED until any release plate is held (OR) | `{ kind: 'trap', id, x, y, w, h, releaseIds, label: 'TRAP' }` |
| cannon (breech) | `cannon` pad on the funnel floor, LIT while any FIRE plate is held (OR), integer `launch` vector | `{ kind: 'cannon', id, centerX, w, launch, fireIds, label: 'CANNON' }` |
| seat | a plate lying wholly inside a trap that it does not release (L9 BAIT, L12 DOOR): its holder is caught | a plate + a trap prop |

Walls are stacked: the field (200–520) stands on the door (520–640), the L2 cap (200–350) on the window
(350–520) on the door. A wall foot sinks `WALL_EMBED_PX` (20) below the fairway so a door that closes on a
resting ball ejects it SIDEWAYS (nearest face) and never down into the dirt (D2). `validateLevel` accepts a
wall that stands on the fairway (foot within `[fairway − 2, fairway + 20]`) or on another wall rect, so the
Bait and Grand Machine doors stand FLUSH on their channel floors (D10.12; a door closing on a ball in its
doorway still ejects it sideways, `devices.test.ts`). Rect ids and switch ids are disjoint within a level
(`door-gate`, `window-gate`), and a cannon's funnel sand keeps its `props` order around the breech (pads are
looked up in `rects` order).

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

The geometry is Appendix A verbatim except where an existing level rule forces a change (D10.12):

- **L10 Sky Bridge, the only geometry change.** Appendix A put the back bunker at 1930–1960 (30 px, under the
  40 px minimum) and plate B's right edge (1750) exactly `GIMME_RADIUS + NEAR_CUP_RADIUS` = 130 px from the cup
  at 1880, where the rule needs more. A 40 px bunker reaching the edge must start at 1920 and the cup must stay
  more than `GIMME_RADIUS` in front of it, so the bunker is 1920–1960, the cup moves 5 px along the same green
  (1880 → 1875, rim y 390, so the overview rule keeps its 0.75 px), and plate B loses 10 px on the right
  together with its bowl flat (1630–1750 → 1630–1740; the right ramp 1750–1780 → 1740–1770 keeps its 30 px
  run; B sand 1602–1778 → 1602–1768). Margins: bunker 45 px (> 40), plate B 135 px (> 130). On the Appendix
  bowl the cannon → B flight rests at x 1672.45–1719.68 for every breech x and every ±3 % launch (1,746 of
  1,746 fired on entry or LOADED, all on B), 20 px short of the new edge; on the shipped bowl every case still
  rests on B ("Launcher re-verification" below).
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
- **Pars** are the design's proposals (7 / 7 / 8 / 8 and 9 / 7 / 8 / 8) until the solver calibrates them.

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
through → stall tap (straight up, low power), taught by the holder tip (`src/ui/holderTip.ts`).

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
the far plate (or rests LOADED and blue's landing fires it) → blue leaves FIRE (the far plate keeps the cannon
lit) and lobs in → both putt. Watch-outs: expecting the cannon to fire by itself; overshooting the mount into
the chasm (+1, back to the safe spot).

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
DECK 884–1556). Spire B: plate B 1630–1740 in the sand bowl 1600–1770, green 1830–1960 at y 390, cup 1875, back
bunker 1920–1960. Line: blue chips LEFT into the cold cannon and waits, LOADED → red rides the spring onto A:
the bridge rises, the cannon lights and fires blue onto B → blue putts → red crosses from A and putts. Second
route: both ride the spring onto A and cross one at a time. Watch-outs: whether A, the bridge and BOOM read as
one cause and effect; trusting the wait in a cold cannon; a lone DECK ball must fly off, never roll.

### 11 · Crossfire (par 8, red first, cup holds `far`)

FIRE ledge 0–200 at y 520 (FIRE 60–180 at y 530) behind a full-height BLUE field 230–270 (200–640). Floor 620
(tees 420 / 470) to 740; RED field 700–740 (200–520) over the DOOR 520–640 (`far`). Cannon pit: sand 741–779 /
841–879 around the breech 780–840 at y 640 (launch (440, −730), lit by `fire` OR `far`). Chasm 900–1460. Far
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
Lines: FLY (red lobs LEFT into the cannon and waits LOADED → blue rests on FIRE → red flies onto TOP → blue
lobs in and flies up) or CLIMB (red rolls onto the DOOR seat and is caught → blue rolls through to the spring
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

The slow solver suite (`npm run test:levels`) still verifies World 1 only. The solver's scripted lines for
holes 5-12, the `walls` / `gaps` opt-outs and the `launchers`, `loops` and `traps` passes (D10.13) bring worlds
2-3 into it and calibrate their pars.

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

Worlds 2-3 are calibrated the same way (D10.13: solver minimum ≤ par ≤ minimum + 2, the design's proposal as the
target, so par = min(proposal, minimum + 2)). Minimum = the better of `coop` (beam 6) and `wide` (beam 60) with
the slow suite's options (`npm run solve -- <id> --pass coop,wide --maxSeconds 600`); scripted = the golden line.
These minimums are search results, not proofs of a floor:

| hole | minimum (coop / wide) | the solver's line | scripted | LEVELS.md par | shipped par |
|---|---|---|---|---|---|
| 5 | 5 (5 / 5) | red parks on DOOR; blue rides the spring onto TOP; red rides up; both chip in from TOP | 5 | 7 | **7** (5 ∈ 5..7) |
| 6 | 4 (4 / 4) | red lobs LEFT onto the PERCH (118°/83); blue holes out from its tee through the open door (29°/94); red holes out from the perch (29°/94; the cup holds FAR) | 5 · rescue 7 | 7 | **6** (7 > 4 + 2) |
| 7 | 6 (6 / 6) | red lobs to 804; blue rests on FIRE; red BOOM onto the far plate; blue lobs into the lit funnel (BOOM); both putt | 8 · load line 8 | 8 | **8** (6 ∈ 6..8) |
| 8 | 6 (6 / 6) | blue's spring bounce onto WINDOW; red's window lob through the red wall onto DOOR; blue moves up; both sink | 7 | 8 | **8** (6 ∈ 6..8) |
| 9 | 6 (7 / 6) | red rolls to 611 (just outside the jaws); blue rolls onto BAIT, CAUGHT; red rolls from 611 through the door straight into the raised spring onto TOP; blue climbs from the channel; both sink from TOP | 7 | 9 | **8** (9 > 6 + 2) |
| 10 | 5 (5 / 5) | blue rides the spring onto A; red lobs LEFT into the lit cannon onto B (129°/49); blue onto the deck; both sink | 5 · spring route 7 | 7 | **7** (5 ∈ 5..7) |
| 11 | 6 (6 / 6) | red lobs from its tee into the cold cannon (LOADED); blue lobs LEFT onto FIRE and fires red onto FAR; red sinks; blue rolls through the door into the cannon (BOOM); blue sinks | 8 | 8 | **8** (6 ∈ 6..8) |
| 12 | 5 (5 / 5) | red rests on FIRE; blue lobs LEFT into the lit cannon onto TOP; red lobs LEFT from the FIRE dish into the cannon (TOP keeps it lit); both chip in | fly 5 · climb 5 | 8 | **7** (8 > 5 + 2) |

Course pars: World 1 28, World 2 29, World 3 30.

Colour Keys is the one hole where the rule cannot be met inside BUILD_DECISIONS D2's ±1: the real roll
(twice the old build's) collapses "chip to the green, then putt" into one roll-in from either bowl, and
`cupHoldsSwitch: 'door2'` (D2) lets red's field lob hole out instead of resting on the DOOR 2 plate. The
rule's answer is par 7 (the scripted line); D2 caps the change at 8. `scripts/solver.ts` encodes the exception
explicitly (`PAR_SLACK_BY_ID`, slack 3 for `w1-03-colour-keys`; the test and the CLI criterion share it) so a lead
decision to waive the cap is a one-line change there plus `par: 7` in the level file. Human play is slower
than the grid: the blue lob onto the DOOR 1 plate succeeds for about 7 % of human-grid shots, so a typical pair
still finishes Colour Keys around 9–10 and the pars read as "silver for a clean pair, gold for one hole-out".
