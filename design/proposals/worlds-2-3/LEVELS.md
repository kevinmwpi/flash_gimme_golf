# Worlds 2 & 3: level design proposal (levels 5-12)

> Status: DESIGN ONLY, not for implementation until the Phase 2 exit condition in CLAUDE.md §5 clears. Supersedes nothing; World 1 stays as built.
>
> If Phase 2 forces a tutorial, co-op-clarity or turn-flow iteration, re-review this document before any World 2/3 work starts: the trap and the cannon both change turn flow (see "Decisions for you", item 2).
>
> Diagrams: [`svg/overview.png`](svg/overview.png) shows all eight holes; `svg/level-N.png|svg` show one each. They are drawn from Appendix A. Every dotted launcher arc is a real `stepBall` flight with the device lit.

Every physical number below is tagged **[measured]** (run against the real `stepBall` / `evaluateSwitches` / `compileLevel` in a harness that reproduces `createSim`/`stepSim` exactly on World 1's Two Doors) or **[estimated]**. The proposed rules (trap, partner-fired cannon, skipped turns) were emulated on top of the real sim. "Human grid" = the 162-shot grid World 1 uses (5-90° step 5 x power 20-100 step 10, mirrored for leftward shots). "Window" = the widest unbroken power range that works at one angle on a 1° x 2.5-power grid; World 1's hardest required beat is about 7 % of the human grid.

## At a glance

| # | World | Name | New idea | Signature beat | Par |
|---|---|---|---|---|---|
| 5 | 2 Lift & Lock | Spring Step | SPRING | Hold the DOOR; your partner rolls onto a spring, is thrown up a 380 px cliff and lands on TOP, which holds the door for you. | 7 |
| 6 | 2 | Booby Trap | TRAP | Lob onto a 160 px perch to open the DOOR; fall short and the trap at its foot holds you until your partner rests on FREE. | 7 |
| 7 | 2 | Load & Fire | CANNON | Lob into a cannon on an 80 px mount and wait; your partner's landing on FIRE shoots you 750 px across a chasm onto a plateau 220 px up. | 8 |
| 8 | 2 | Colour Lift | — (exam) | One spring throws both balls at a red wall: blue bounces back onto the WINDOW plate, red lobs through that window and flies through the wall onto the DOOR plate. | 8 |
| 9 | 3 Sky Machines | Bait | — | The DOOR plate is a trap: sit in it on purpose so your partner gets every turn, lobs into a raised spring and frees you from the top. | 9 |
| 10 | 3 | Sky Bridge | — | Wait in a cold cannon; one landing on plate A raises the bridge, lights the cannon and fires you 1,600 px onto plate B. | 7 |
| 11 | 3 | Crossfire | — | Only red can reach the cannon (through the red field), only blue can reach FIRE (behind the blue field); red's landing opens the door for blue. | 8 |
| 12 | 3 | Grand Machine | — | Two ways up a 300 px summit: fly by cannon while your partner holds FIRE, or climb by spring while your partner sits in the door's trap. | 8 |

World 1 taught one idea per hole on flat ground. World 2 opens the vertical axis and introduces exactly the three devices you asked for, one per hole (spring, trap, cannon), then ends with an exam hole that adds nothing new but is the world's precision and co-op peak. World 3 introduces nothing: every hole combines three or more taught mechanics, co-op load sits at 4-5, precision at 3-4, and the finale offers four routes. Pars run 7-9, each world is about 30 strokes of par and 9-12 minutes for a typical pair [estimated], and no level depends on a launcher shot that fails under a ±3 % change of its launch speed [measured].

## How this answers your request

**Verticality and precision.** Every hole from 5 to 12 has a height beat: lifts of 220-380 px, a 160 px perch, an 80 px cannon mount and a 100 px ledge [measured geometry]. A hand shot rises at most 335 px, so everything higher is reached by a spring or a cannon, and everything a hand shot must reach is a precision target with a fair window: the perch (8 % of the human grid, 22.5-power window), the cannon funnels and barrels (6-20 % from a good spot, 20-47.5-power windows), the raised spring mouth (7-9 %, 27.5-40), and World 2's hardest beat, the window lob in Colour Lift (about 5 %, 22.5-25) [measured]. Every precision shot comes with a partner role: rescue, holding a door or window, or firing the cannon.

**Booby traps.** The TRAP is a set of steel jaws: a ball that stops in it is CAUGHT and keeps its spot, its turns go to its partner, and the partner frees it by resting on a release plate (or by sinking, because the cup holds a release). This design deliberately does **not** make you restart the whole hole, for four reasons: a full restart punishes both players for one player's mistake; online only the host can trigger it; it resets the hole's strokes to 0, so it costs time but no score; and it breaks the rebuild's rule that no mistake needs a restart (design/FINAL/levels/LEVELS.md) and LEVEL_DESIGN.md's recovery-cost axis. Your "restart" survives at the scale of one ball: if nobody can shoot, the ball that moved last goes back to where it last stood free, +1. The literal hard lock is still on the table as decision 1.

**Cannons and springs.** Springs throw you up cliffs (L5, L8, L9, L10, L12); in L8 and L9 getting *into* the spring is itself the shot. Cannons fire a fixed, visible vector and carry 750-1,600 px against a 624 px maximum hand carry [measured]. "If you can get it inside the mechanism" is literal: you lob into a sand funnel or barrel (6-20 % from a good spot), the cannon holds you there, and it fires the moment your partner rests on a FIRE plate.

**Popular mechanics.** Launch pads, cannons, booby traps, drawbridges, colour gates and chain reactions (one landing that raises a bridge and fires a cannon). Fans/updrafts and bumpers are cut from Worlds 2-3 because of measured problems: a fan can hold a ball in the air forever and freeze the turn, and a bumper ignores rolling balls, which fails the "guess what it does" test (decision 5).

**Progression.** Each new device first appears alone with light precision (L5-L7), then the World 2 exam combines them at the world's precision and co-op peak (L8). World 3 turns the devices into co-op tools: the trap as bait (L9), the cannon fired by a chain reaction (L10), colour roles around the cannon (L11), and a finale with a route choice (L12). The curve section shows each step changes at least one axis and no hole maxes all five.

## Decisions for you

1. **Trap severity (your "lock your ball and make you restart").** Recommended: **C**.

   | Option | When a ball stops in an armed trap | Who pays | Code | Verdict |
   |---|---|---|---|---|
   | A. Literal hard lock | Locked for good; the host restarts the hole | Both players; online only the host can recover; strokes reset to 0, so it costs only time | M | Not recommended. If wanted: one optional hard trap, announced on the intro card, in L6 only |
   | B. Snap-back | Back to its last safe spot, +1, at once | The mistaken ball | S-M | Safe, but just a hazard |
   | **C. Co-op lock** | Caught: keeps its spot, turns go to the partner until a release plate is held; if nobody can shoot, the ball that moved last goes back to its safe spot, +1 | The mistaken ball's turns; the partner gets a rescue job | M | **Recommended** |
   | D. Zero-code cage | A pit behind a door; the caged ball wastes stall taps | The caged ball; deadlock when both are caged | 0 | Rejected |

   If you pick B: same geometry, L6 and L12's pit become pure hazards, and L9 and L12's door "seat" stop working (sitting on the plate would bounce you back), so those two holes need re-cutting. If you pick A: only L6 changes. D is not viable.

2. **Skipped turns.** The trap and the loaded cannon both skip a waiting ball's turns. That is a turn-flow change, and CLAUDE.md §5 names turn flow as a Phase 2 iteration axis. Recommended: build it with a banner on **every** skipped turn ("Red is caught — Blue shoots again") and a HUD chip naming the release ("CAUGHT · needs FREE", "LOADED · needs FIRE"), and re-review it after Phase 2. Fallback if playtests reject it: no skipping, traps become snap-back (option B above), a loaded ball keeps its turns and stall-taps (straight up at low power, as taught in World 1); L9 and L12's seat need re-cutting.

3. **How cannons aim and fire.** Recommended: **fixed vector, partner-fired**. The barrel is drawn along its launch so the arc is readable; it is lit while any of its FIRE plates is held, and a ball resting in a cold cannon fires the moment its partner lands on FIRE (cost M). Alternatives: (a) an *instant* cannon that fires on entry in your own turn, like a spring with a barrel (cost S): L7, L10, L11 and L12 lose their load-and-fire beat and need re-cutting; (b) an *aimable* cannon you aim from inside on your next turn (cost L: new ball state, snapshot and protocol version bumps, every golden replay regenerated): same levels, but the "your landing fires me" moment is lost. Not recommended.

4. **Verticality and the camera.** Recommended: keep the fixed 720 px screen with the horizontal-only camera (BUILD_DECISIONS D7). Every climb here fits (the highest is 380 px), and every cup obeys `rimY ≥ 720 − 0.169 x width`, so the overview needs no change. Four small view changes are required (see "Shared prerequisites"). Alternative: a vertical-scrolling camera (size L: fixed height in `types.ts` and `authoring.ts`, `view.ts`, the renderer's world bottom, the kill line, `serialize.ts`, the HUD-band rules, and it reverses D7). It would allow towers taller than one screen. Not needed by this design.

5. **Fans and bumpers.** Recommended: leave both out of Worlds 2-3; they stay in the engine. Reasons, measured by the proposals and the sim readers: a ball under or inside a fan can bob forever (straight-up shots at power 30 and 60 under a floor fan were still flying after 3,600 ticks; a fan switching on under a parked ball never settles), and only the host's restart ends that turn; a bumper ignores rolling balls and is a fixed 152 px hop. Alternative: ship proposal B's fan "lean" (vx eased toward the exit side) plus a flight watchdog and a placement rule (S-M), then re-measure every fan level. Not proposed.

6. **Mechanic budget.** Recommended: three new ideas in World 2 (spring, trap, cannon), a World 2 exam that adds nothing, and nothing new in World 3 (needs `mechanicsIntroduced` to allow an empty list, size S). Alternative: add proposal A's BACKSTOP, a wall your partner raises behind a perch (it turned a 130 px perch from 0.5 % of the fine grid to 8.4 % [measured by A and the feasibility judge]), as a fourth idea (S). It would strengthen the precision-plus-partner pairing but breaks "introduced sparingly".

7. **Names and pars.** World names (Lift & Lock, Sky Machines) and level names are working titles. Pars are proposals; the build-time solver calibrates them under the existing rule (solver minimum ≤ par ≤ minimum + 2).

## New mechanics

### TRAP (new, size M; introduced in L6)

| | Rule |
|---|---|
| Trigger | A ball that comes to rest with its centre inside an **armed** trap zone is CAUGHT. A moving ball crosses freely: rolling through never catches. |
| Armed | While none of its release plates is held. Several release plates are allowed (OR), and the cup can hold one. This is the existing rect rule, armed like a door is shut. |
| State | None added. CAUGHT is derived from position, the rest flag and the switch map, all already in snapshots, so there is no snapshot version bump. |
| Release | The moment a release plate is held, the ball is FREE where it sits and shoots on its next turn. If the release lets go before it moves, it is caught again. |
| Turns | WAITING rule (below): a caught ball's turns go to its partner. |
| Resting vs moving balls | Only resting balls are caught. A caught ball still holds any plate it rests on; that is what makes the seats in L9 and L12 work. |
| Partner | Frees you by resting on a release plate. Balls never collide, so rescue always goes through a plate or the cup. |
| Solo mode | Identical; the WAITING rule simply hands the solo player the free ball. |
| Determinism and online | A pure function of sim state, evaluated by the server at the hand-off; no new command. New events `trapCaught`, `trapFreed`, `trapReturn` (the last teleports a ball, so it goes in `IMMEDIATE_SNAPSHOT_EVENTS`). |
| Falls and respawn | A ball's safe spot (today's `lastRest`) is where it last rested on permanent ground while free to shoot: never while caught, never in a cannon, and (as today) never on a bridge. A ball freed where it sits records its spot at the hand-off. Falls and trap returns both use it. |
| cupHoldsSwitch | Every trap hole wires the cup to a release (L6 FAR, L9 TOP, L12 TOP), so a sunk partner frees you. |
| Softlock escape | The WAITING rule's scoped reset, plus a design rule proved by the solver: from every reachable state, the free ball can reach a release plate. Measured: 0 cases needing more than the scoped reset in 3,200 random games across all eight holes. Host restart stays the last resort. |
| Look and label | Steel jaws, set when armed and folded flat when open (it reads by silhouette; there is little colour left). Sticker `TRAP · ARMED` / `TRAP · OPEN` with wires to its release plates; a plate inside a trap (a "seat") draws one combined sticker (`BAIT · TRAP`, `DOOR · TRAP`). Callouts `SNAP!`, `FREE!`, `BACK +1`; never `LOCKED!`, which belongs to the colour gate. HUD chip `CAUGHT · needs FREE`. A soft snap and clink, never a punishing sound. NEW-card blurb: "Stop in its jaws and you wait for your partner." |
| Sim hook points | `types.ts` (`'trap'` in the mechanic unions, `TrapRect`, events), `physics.ts` `settle()` (safe-spot guard, `trapCaught`), `sim.ts` `transition()` (WAITING rule, safe spot for a ball freed in place) and `emitSwitchDiff()` (`trapFreed`), `authoring.ts` (prop and validation: label, at least one release plate, no tee or cup inside, plates allowed inside), view, audio, copy, tests, solver. |
| Cost | M, including the shared WAITING rule. |

### CANNON (new, size M; introduced in L7)

| | Rule |
|---|---|
| What it is | A fixed barrel whose breech is a pad on the floor of a sand funnel on a raised mount. |
| Trigger | **Lit** while any of its FIRE plates is held (or the cup holds one): any ground contact in the breech sets the ball's velocity to the barrel's fixed launch vector, exactly like a spring. **Cold**: the breech is ordinary ground, so a ball can rest there, LOADED. |
| Firing a loaded ball | A loaded ball fires the moment its cannon becomes lit, i.e. when its partner comes to rest on FIRE (a one-line wake rule in `wakeIfNeeded`). The flight happens during the partner's turn, so the camera must follow it. |
| State | None added; LOADED is derived. |
| Turns | WAITING rule: a loaded ball's turns go to its partner while the cannon is cold. |
| Partner | "I load, you fire." Every cannon hole has a FIRE plate where the first ball lands (or the cup holds one), so the first across fires the second. |
| Solo mode | Identical. |
| Determinism and online | Fixed vector; fires on a plate hold, never on a timer. Events `cannonLoad`, `cannonFire` (no teleport). |
| Falls and respawn | The safe spot is never recorded in a breech, so a fall cannot respawn a ball into a lit barrel. |
| cupHoldsSwitch | Wired to a FIRE plate on every cannon hole (L7 far FIRE, L10 B, L11 FAR, L12 TOP). |
| Softlock escape | Two balls in one breech: scoped reset for the last mover. Every flight lands in a sand basin; for every breech x and every ±3 % launch change it rests on its target plate and never re-enters a breech [measured, all four cannons]. |
| Look and label | An iron barrel drawn **along its launch vector** on a wooden cradle, a fuse lamp (mint LIT, grey COLD), wires to its FIRE plates, a dotted arc while loaded or lit. Sticker `CANNON · LIT` / `CANNON · COLD`, callouts `LOADED!` / `BOOM!`, a smoke puff, a short shake and its own "thoom". HUD chip `LOADED · needs FIRE`. NEW-card blurb: "Rest inside it; a ball on FIRE shoots you across." |
| Validation | FIRE plate required; launch finite, upward, at most 1,100 px/s, and at least as sideways as `|x| ≥ 0.5 x |y|` (steeper launches are springs); breech on a flat funnel floor; the first 60 px along the launch ray clear of terrain and walls (proposal C measured a deflected flight when a lip stood there); label required. |
| Sim hook points | `types.ts` (`'cannon'`, `CannonRect`, events), `physics.ts` (`isPad`/`applyPads` share the spring case; wake rule; `settle()` guard and `cannonLoad`), `sim.ts` (LOADED in the WAITING rule), `authoring.ts`, view (barrel, lamp, arc, camera follow), audio, copy, tests, solver. |
| Cost | M (S-M on top of the trap work). |

### The WAITING rule (shared by both)

At every hand-off the next shooter is the first of {the other ball, the same ball} that is neither sunk nor WAITING (caught or loaded), and every skipped turn shows the banner. If nobody can shoot, the **scoped reset** runs: the waiting ball that moved last (the shooter if it is waiting, otherwise the other) goes back to its safe spot with +1 (`BACK +1`), and the switches are re-evaluated; it runs at most twice. A send-to-tee fallback exists only as a guard, and the solver's `traps` pass must prove it never runs (it ran 0 times in 3,200 random games [measured]). This removes the World 1 stall tap wherever a ball waits in a device, and it depends on Phase 2 (decision 2). No hole is a single-player stretch: every ball that waits also has a skill beat of its own in the same hole (the retry from the trap in L6, loading the cannon in L7, L10 and L11, the entry lob in L8, the spring lob in L9, the fly or climb in L12), and "did the waiting player feel idle?" is a standing playtest question.

### Built mechanics as used here

- **Spring** (built, unused in World 1): used in L5, L8, L9, L10, L12; every launch is 10-26° off vertical, so its chevrons must be drawn along the launch.
- **Bumper**: not used (decision 5).
- **Fan**: not used (decision 5).
- **Wind**: not used; nothing in the view draws it.

### Shared prerequisites (not mechanics)

| Change | Needed by | Size |
|---|---|---|
| Worlds 2-3 plumbing: `WorldId` 1\|2\|3, `worldTitle`, per-world id lists and `campaignFrom`, lobby picker, ids `w2-05-…` to `w3-12-…`, `order` = campaign position 5-12, solver and golden keys by id, world copy, one music track per world | all | S-M |
| Empty `mechanicsIntroduced`, NEW row hidden (UX.md already specifies it) | L8-L12 | S |
| Camera follows a ball launched by a device until it rests | partner-fired flights in L7, L10, L11, L12 | S |
| Off-screen ball marker | a 90°/100 hand shot from the L5, L8, L9 and L12 high ground peaks at centre y −13 to −83 and is fully above the frame for up to 58 ticks [measured] | S |
| Spring chevrons drawn along the launch vector | every spring here | S |
| Combined seat sticker | L9, L12 (keeps L12 at 6 stickers per 1,280 px) | S |
| Flight watchdog: a flight still running after 30 s ends, every moving ball goes to its safe spot, no penalty, logged | safety net (0 cases measured) | S |
| `PROTOCOL_VERSION` 3 → 4 (new events and ids; client and server deploy separately) | all | S |
| Solver: `isCoop` counts traps and cannons; `walls` opt-out for backboards; `gaps` opt-out for cannon-crossed gaps; caught/loaded flags in bucket keys; new `launchers`, `loops` and `traps` passes | all | S-M |
| Overview change | not needed: every cup obeys the overview rule | — |

Total: two M systems plus about eight S items, about L overall [estimated], built in stages: L5 needs only the plumbing and the chevrons, L6 adds the trap, L7 the cannon.

## World 2: Lift & Lock (Combine), levels 5-8

Each level's **Axes** line reads: Geometric distance / verticality / cup width · Path par / obstacles / branching / precision · Load distinct mechanics / new / sequencing · Co-op puzzles / simultaneity / communication · Recovery hazard density / soft-lock risk.

### Level 5: Spring Step (`w2-05-spring-step`, 1800x720, par 7, red first)

**Pitch.** The tees face a 380 px cliff no hand shot can climb; the spring at its foot does it for you, but it sits behind a door.

**New here.** SPRING: any touch throws the ball along a fixed vector.

**How it plays.**
1. Red parks on the DOOR plate in the dish against the wall (53 % of the human grid, 62.5-power window [measured]). The door opens.
2. Blue rolls through the door onto the spring and lands on TOP, 380 px up (25 % from the tee, 40-power window [measured]). TOP also holds the door. For every point on the pad and every ±3 % change of the launch, the ball rests on TOP (223/223) [measured].
3. Red leaves its plate (TOP holds the door), rolls through and rides up (37 %, 55-power window [measured]).
4. Both chip 180 px down to the terrace green (10.5 % hole out, 19 % rest on the terrace [measured]) and putt. First-grid line from the tees: 5 strokes [measured].

**Co-op beat.** World 1's hold-and-swap, turned vertical: I hold the door from below, you hold it from above.

**Precision / height beat.** A 380 px lift, above the 335 px a hand shot can rise. Precision is light on purpose while the spring is new.

**In-game hint.** "The SPRING throws any ball that touches it up the cliff, but it sits behind the DOOR. Park on the DOOR plate for your partner: they land on TOP, which holds the door open for you."

**Aha.** The spring does the climbing and the plates do the teamwork: I hold the DOOR from below, you land on TOP and hold it from above, and the same spring carries me up after you.

**Watch for in playtests.** Players lob at the 420 px wall instead of rolling through the door; the TOP ball chips away before the holder has ridden up (the cup holds TOP, so sinking is safe).

**Axes.** Geometric 3 / 3 / 2 · Path 7 / 2 / 1 / 2 · Load 4 / 1 / 2 · Co-op 2 / 2 / 2 · Recovery 1 / 1. Lone balls never pass the wall (search stops at x 600); 0 aces; no pits [measured].

### Level 6: Booby Trap (`w2-06-booby-trap`, 1700x720, par 7, red first)

**Pitch.** The plate that opens the door sits in the bowl of a 160 px perch behind you; fall short and the trap at the perch's foot holds you until your partner rescues you.

**New here.** TRAP, first as a hazard that punishes a missed precision shot.

**How it plays.**
1. Red lobs LEFT onto the perch (a backboard stands behind its bowl): 8 % of the mirrored human grid, 22.5-power window at 114° [measured]. The PERCH plate opens the DOOR.
2. A short lob rolls into the trap at the perch's foot (61 % of all grid shots, 52 % of sensible lobs at 95-135° and power 50+ [measured]): red is CAUGHT and blue gets the turns. Blue rolls onto FREE, 80-170 px from its tee (32 % of the two-way grid, 45-power window [measured]), and red is freed where it sits; red retries with a near-vertical lob (27.5-power window at 101° [measured]).
3. With red on the perch, blue rolls through the door into the FAR dish (22 %, 37.5-power window [measured]). FAR holds the door and also opens the trap.
4. Red drops off the perch and rolls through (23 % [measured]); both putt out about 400 px. Lines from the tees: 6 strokes clean, 7 with one rescue [measured].

**Co-op beat.** Rescue: the partner's plate is the key to your trap, and after that the perch and FAR each hold the door for the other.

**Precision / height beat.** "Balanced on a platform": a 160 px perch made fair by its backboard, with the trap as the price of a miss.

**In-game hint.** "Lob onto the PERCH behind you: a ball resting in its bowl opens the DOOR. Fall short and the TRAP at its foot holds you until your partner rests on FREE."

**Aha.** A trap pauses you, it does not end you: if I am caught under the perch, you roll onto FREE and I get another try, and once I am up there my perch holds the door while you go through.

**Watch for in playtests.** Does the skipped turn read as the trap, not a bug? Does the caught player feel idle? Does red find the steep retry? Blue's leftward shots into the occupied trap trigger the one-ball reset (back to its last free spot, +1).

**Axes.** Geometric 3 / 2 / 2 · Path 7 / 3 / 1 / 3 · Load 4 / 1 / 2 · Co-op 3 / 3 / 3 · Recovery 2 / 1. Lone balls stop at the wall (x 968); 0 aces [measured].

### Level 7: Load & Fire (`w2-07-load-and-fire`, 1960x720, par 8, red first)

**Pitch.** A 559 px chasm to a plateau 220 px up: no hand shot crosses, but a cannon on an 80 px mount does, and only your partner can fire it.

**New here.** CANNON.

**How it plays.**
1. Red moves up to the approach (x 650-830).
2. Blue rests on the FIRE plate in a dish near the tees (30 % of the human grid, 27.5-power window [measured]). The cannon is lit.
3. Red lobs into the sand funnel on the mount: 8-9 % of the human grid from x 650-780, windows 20-40; 0 % from the tee [measured]. It fires on entry, flies 752 px in 2.5 s (apex y 164) and lands on the far FIRE plate: every breech x and every ±3 % launch, 159/159 [measured]. In the other order, red rests LOADED in the cold cannon and is fired the moment blue lands on FIRE [measured].
4. Blue leaves FIRE (the far FIRE plate keeps the cannon lit) and lobs in from the dish (4 %, 15-power window) or after moving up (8-9 %) [measured].
5. Both putt out; the cup holds the far FIRE plate. First-grid line from the tees: 7 strokes [measured].

**Co-op beat.** "I load, you fire," then the first one across fires the other.

**Precision / height beat.** Getting inside the mechanism: a 40 px breech in a 120 px funnel, 80 px up. Overshooting the mount drops you into the chasm (14-21 of 162 shots from the approach), +1 and back to your last safe spot [measured].

**In-game hint.** "Lob into the CANNON and it waits: it fires only while a ball RESTS on a FIRE plate. Whoever lands across rests on the far FIRE plate to fire the other."

**Aha.** I cannot fire myself: I sit in the cannon, you rest on FIRE, and the FIRE plate I land on across the chasm fires you in turn (a ball in the cup does too).

**Watch for in playtests.** Players expecting the cannon to fire by itself; whether "LOADED · needs FIRE" and the wire make the partner's job obvious; whether the camera-follow makes the partner-fired flight read.

**Axes.** Geometric 4 / 3 / 2 · Path 8 / 2 / 2 / 3 · Load 3 / 1 / 3 · Co-op 3 / 3 / 3 · Recovery 3 / 1. Hand crossings 0/3,108; a lone loaded ball never fires (search stops at the breech, x 926); 0 aces [measured].

### Level 8: Colour Lift (`w2-08-colour-lift`, 1960x720, par 8, blue first)

**Pitch.** One spring throws both balls at a red wall on a plateau 320 px up: blue bounces back onto the WINDOW plate, red flies through onto the DOOR plate, and each plate opens the other's way.

**New here.** Nothing; the World 2 exam (spring, colour field, doors).

**How it plays.**
1. Blue lobs through its own floor-level blue field into a hopper that feeds the spring, is thrown at the red wall, bounces back and lands on the WINDOW plate (24 % of the human grid from the tee, 50-power window [measured]). Every point on the pad and every ±3 % launch lands on the plate (223/223) [measured].
2. The WINDOW plate opens a window high in wall 1. Red lobs through it from a few steps back: about 5 % of the grid from x 40-80, 22.5-25-power windows; World 2's hardest beat [measured]. The spring flies red through the red wall onto the DOOR plate (223/223 for every ±3 % launch [measured]). If red misses, blue stall-taps on its plate.
3. Blue rolls through the open door (23 % [measured]); both chip down to the terrace green (red: 6 % hole out from the DOOR plate [measured]). First-grid line from the tees: 6 strokes [measured].

**Co-op beat.** World 1's colour leapfrog folded into one shared spring: blue's landing opens red's window, red's landing opens blue's door.

**Precision / height beat.** The window lob (precision peak of World 2) and a 320 px lift. The red field rises off the top of the screen so blue can never lob over it (0 of 5,907 hand shots; best centre y −27 [measured]).

**In-game hint.** "Blue lobs through its own field into the SPRING pit and bounces back onto the WINDOW plate. Red then lobs through the open WINDOW and flies through the red wall onto the DOOR plate."

**Aha.** One spring, two colours: the red wall up top bounces blue back onto the plate that opens the WINDOW for red, and lets red fly through onto the plate that opens the DOOR for blue.

**Watch for in playtests.** Blue reading the bounce as a failure; attempts per success on red's window lob and how many stall taps blue spends meanwhile.

**Axes.** Geometric 3 / 3 / 2 · Path 8 / 3 / 1 / 4 · Load 5 / 0 / 3 · Co-op 4 / 4 / 4 · Recovery 1 / 1. Red never passes wall 1 with the window shut (0/23,628); 0 aces [measured].

## World 3: Sky Machines (Test), levels 9-12

### Level 9: Bait (`w3-09-bait`, 1960x720, par 9, red first)

**Pitch.** The plate that opens the door sits inside a trap: whoever takes the bait is caught, which hands every turn to the partner, who climbs to the summit and frees them.

**New here.** Nothing; trap, spring and door combined. The trap you learned as a hazard becomes a tool.

**How it plays.**
1. Red rolls onto the BAIT plate in a sunken channel at the wall's foot (30 %, 45-power window [measured]): caught, and the door is open.
2. Blue rolls through the door past red (44 %; 0 of 35 deliberate rolls stop in the occupied trap [measured]) into a sandy yard.
3. Blue lobs into the raised spring mouth (a 40 px plinth with a 16 px back lip): 7-9 % from x 880-920, windows 27.5-40 [measured]. The spring lifts it 360 px onto TOP (255/255 for every ±3 % launch [measured]); TOP frees red and holds the door.
4. Red rolls out through the door (48 % [measured]) and makes the same lob into the spring.
5. Both chip down to the terrace green (11 % hole out from TOP [measured]); the cup holds TOP. First-grid line from the tees: 8 strokes [measured].

**Co-op beat.** The trap replaces the stall tap: the bait holds the door and gives the climber unlimited tries with no wasted strokes.

**Precision / height beat.** Getting inside the spring (both balls), then a 360 px lift.

**In-game hint.** "The BAIT plate opens the DOOR, but it sits in a TRAP: whoever rests there is caught and skips turns. Take the bait on purpose; your partner climbs the SPRING to TOP, which frees you."

**Aha.** Getting caught is the plan: the ball in the trap holds the door and hands every turn to its partner, who takes as many shots as the raised spring needs and then frees the bait from the top.

**Watch for in playtests.** Pairs who refuse the bait ("it's a trap!"); whether the bait holder feels idle (it gets its own spring lob later).

**Axes.** Geometric 4 / 4 / 2 · Path 9 / 3 / 2 / 3 · Load 5 / 0 / 4 · Co-op 3 / 4 / 4 · Recovery 2 / 1 (branching 2: either ball can be the bait). No hand shot passes the shut door or reaches the summit (0/17,721 each); 0 aces [measured].

### Level 10: Sky Bridge (`w3-10-sky-bridge`, 1960x720, par 7, blue first)

**Pitch.** Two spires 220 px up over a 720 px chasm; the cannon behind the tees is lit by the same plates that hold the bridge, so it only fires while the bridge is out.

**New here.** Nothing; cannon, spring and bridge combined.

**How it plays.**
1. Blue chips LEFT into the cold cannon in a drum behind the tees (14-20 %, windows 20-27.5 from x 220-280; from the tee 15 % with a 10-power window [measured]) and waits, LOADED.
2. Red rolls onto the spring and lands on plate A (37 %; 223/223 for every ±3 % launch [measured]). A raises the bridge and lights the cannon, and blue fires 1,594 px in 4.3 s onto plate B (191/191 for every breech x and ±3 % launch [measured]).
3. Blue putts out; the cup holds B. Red crosses the bridge from A (20 % reach the far side, 33 % stop on the DECK, which holds the bridge itself, 0 falls [measured]).
4. Second route: both ride the spring onto A and cross one at a time, World 1's Plate & Bridge pattern. Chain line from the tees: 5 strokes [measured].

**Co-op beat.** A chain reaction: one rest moves both balls.

**Precision / height beat.** The leftward chip into the barrel; a 220 px lift; the crossing.

**In-game hint.** "Blue: chip back into the CANNON and wait. Red: ride the SPRING onto A, and the BRIDGE and the cannon both go live."

**Aha.** My landing on A does three things at once: it raises the bridge, lights the cannon and fires my partner across, so the cannon never fires without a bridge underneath.

**Watch for in playtests.** Whether A, bridge and BOOM read as one cause and effect (the camera must follow blue); whether players trust waiting in the cold cannon.

**Axes.** Geometric 4 / 3 / 2 · Path 7 / 3 / 3 / 3 · Load 5 / 0 / 4 · Co-op 4 / 4 / 4 · Recovery 2 / 1. No hand crossing (0/1,554); lone balls stop at the lip (x 859); 0 aces [measured].

### Level 11: Crossfire (`w3-11-crossfire`, 1960x720, par 8, red first)

**Pitch.** World 1's Colour Keys leapfrog, fired through a cannon: red can reach the cannon, blue can reach its FIRE plate, and neither can do the other's job.

**New here.** Nothing; colour fields, cannon and door combined.

**How it plays.**
1. Red moves up toward the red field (x 600-660).
2. Blue lobs LEFT through its blue field onto the FIRE ledge, 100 px up behind it (10.5-13 %, windows 22.5-25 [measured]). The cannon is lit.
3. Red lobs through the red field into the cannon pit: 8 % from x 600 (25-power window), 5.6 % from x 660 (42.5) [measured]. BOOM: 816 px onto FAR (239/239 for every breech x and ±3 % launch [measured]). In the other order red waits LOADED and blue's landing fires it.
4. FAR opens the door under the red field and keeps the cannon lit; red putts out (the cup holds FAR).
5. Blue drops off the ledge, rolls through the door into the cannon (36 % from x 300 [measured]) and flies to FAR; putts. First-grid line from the tees: 7 strokes [measured].

**Co-op beat.** The colours assign the roles: red loads, blue fires, and red's landing lets blue use the same cannon.

**Precision / height beat.** Red's lob through its field into the pit; blue's leftward lob onto a ledge; a 220 px crossing.

**In-game hint.** "Only red gets through the RED field into the CANNON, and only blue reaches FIRE behind the BLUE field. Red lands on FAR, which opens the DOOR so blue can roll in."

**Aha.** The colours pick the roles: only red can load the cannon and only blue can reach FIRE, and red's landing plate opens the door that lets blue into the same cannon.

**Watch for in playtests.** Blue trying to load the cannon and bouncing off the red field; red lobbing from the tee (2.5 %) instead of moving up first.

**Axes.** Geometric 4 / 3 / 2 · Path 8 / 3 / 3 / 4 · Load 5 / 0 / 4 · Co-op 5 / 4 / 5 · Recovery 2 / 1. Each colour wall stops the other ball (0/17,721 each way); no hand crossing (0/2,072); 0 aces [measured].

### Level 12: Grand Machine (`w3-12-grand-machine`, 1960x720, par 8, red first)

**Pitch.** The finale: two co-op machines up to a 300 px summit, and whoever lands first opens both for the other.

**New here.** Nothing; cannon, spring, trap and door combined.

**How it plays.**
- **Fly.** Red lobs LEFT into the cannon on the mount at the far left (15-16 % from the tees, windows 30-35 [measured]); overshoot it and the pit trap behind the mount holds you (7-9 of 162 [measured]) until FIRE or TOP is held, then you lob back in (14 %, 32.5-power window [measured]). Blue rests on FIRE (36 % from its tee [measured]), and red flies 1,364 px onto TOP (159/159 for every breech x and ±3 % launch [measured]).
- **Climb.** Red rolls onto the DOOR plate, which sits in a trap (27 %, 50-power window [measured]): caught, door open. Blue rolls through (28 % reach TOP; 0 of 35 deliberate rolls stop in the occupied trap [measured]), and the spring lifts it onto TOP (223/223 for every ±3 % launch [measured]).
- **TOP** is one long sand basin. It holds the door, lights the cannon and frees both traps; the cup holds TOP, so the second ball can always take either route.
- Lines from the tees: fly-fly 6 strokes (gold), climb-climb 7 [measured].

**Co-op beat.** Every route needs the other ball: FIRE, the door seat, TOP or the cup.

**Precision / height beat.** The backwards lob into the cannon (or the safer roll and spring), a 300 px climb, and the pit as the one booby trap that punishes a miss.

**In-game hint.** "Two ways up: lob LEFT into the CANNON while your partner rests on FIRE, or ride the SPRING behind the DOOR while your partner sits in its TRAP. TOP opens everything for the second ball."

**Aha.** Every way up needs the other ball, so we choose: I fly while you hold FIRE, or I climb while you sit in the door trap, and whoever lands on TOP opens both machines for the other.

**Watch for in playtests.** Which route first-time pairs pick and whether they notice the second; overshooting into the pit; touch input for the leftward lob near the left edge.

**Axes.** Geometric 4 / 4 / 2 · Path 8 / 4 / 5 / 3 · Load 6 / 0 / 4 · Co-op 6 / 5 / 5 · Recovery 3 / 2. No hand shot passes the wall or reaches the summit (0/23,628); 0 aces [measured]. Needs the combined seat sticker to stay at 6 stickers per window.

## Difficulty curve

Axes are LEVEL_DESIGN.md's informal 1-5 ratings (puzzles is a count of partner-operated locks). World 1 rows are from design/FINAL/levels/LEVELS.md; pars shown are the shipped ones, and World 1's distinct counts predate the back bunkers (shipped: 1 / 3 / 4 / 3), so L4 → L5 is +1 against the shipped count.

| # | Name | Distance / vert / cup | Par / obstacles / branching / precision | Distinct / new / sequencing | Puzzles / simultaneity / communication | Hazard / softlock |
|---|---|---|---|---|---|---|
| 1 | First Fairway | 2 / 1 / 2 | 6 / 1 / 1 / 1 | 1 / 1 / 1 | 0 / 1 / 1 | 1 / 1 |
| 2 | Two Doors | 3 / 1 / 2 | 7 / 2 / 1 / 2 | 2 / 1 / 2 | 2 / 2 / 2 | 1 / 2 |
| 3 | Colour Keys | 3 / 1 / 2 | 8 / 3 / 1 / 3 | 3 / 1 / 3 | 2 / 2 / 3 | 1 / 2 |
| 4 | Plate & Bridge | 3 / 1 / 2 | 7 / 2 / 1 / 2 | 2 / 1 / 3 | 2 / 2 / 2 | 2 / 1 |
| 5 | Spring Step | 3 / 3 / 2 | 7 / 2 / 1 / 2 | 4 / 1 / 2 | 2 / 2 / 2 | 1 / 1 |
| 6 | Booby Trap | 3 / 2 / 2 | 7 / 3 / 1 / 3 | 4 / 1 / 2 | 3 / 3 / 3 | 2 / 1 |
| 7 | Load & Fire | 4 / 3 / 2 | 8 / 2 / 2 / 3 | 3 / 1 / 3 | 3 / 3 / 3 | 3 / 1 |
| 8 | Colour Lift | 3 / 3 / 2 | 8 / 3 / 1 / **4** | 5 / 0 / 3 | **4 / 4 / 4** | 1 / 1 |
| 9 | Bait | 4 / **4** / 2 | 9 / 3 / 2 / 3 | 5 / 0 / 4 | 3 / 4 / 4 | 2 / 1 |
| 10 | Sky Bridge | 4 / 3 / 2 | 7 / 3 / 3 / 3 | 5 / 0 / 4 | 4 / 4 / 4 | 2 / 1 |
| 11 | Crossfire | 4 / 3 / 2 | 8 / 3 / 3 / **4** | 5 / 0 / 4 | 5 / 4 / **5** | 2 / 1 |
| 12 | Grand Machine | 4 / **4** / 2 | 8 / 4 / **5** / 3 | 6 / 0 / 4 | **6 / 5 / 5** | 3 / 2 |

- **No spikes.** Every step moves an axis by at most +1, with three exceptions: verticality jumps 1 → 3 at L5, but on a deterministic lift with precision held at 2 (it is the axis you asked for); the exam L8 adds two distinct mechanics because it combines them; and branching rises 3 → 5 at the finale, which introduces nothing.
- **Intro holes are never peaks.** L5-L7 each introduce one device at precision 2-3 and co-op 2-3; World 2's precision and co-op peak is the exam (L8), and World 3's are L11-L12.
- **Every level changes at least one axis**, and **no level maxes all five**: L12 has co-op and branching at their highest but precision 3 and recovery 3 / 2; L8 has precision 4 but hazard 1.
- **Co-op load (weighted heaviest)** climbs 2 → 3 → 3 → 4 across World 2 and sits at 4-5 in World 3; precision runs 2 → 3 → 3 → 4, then 3-4. Cup width stays 2 everywhere: difficulty comes from devices and teamwork, not putting.

## Session budget

| | Pars | Course par | Typical pair [estimated] | Minutes at 16-18 s per stroke [estimated] |
|---|---|---|---|---|
| World 1 (shipped) | 6 / 7 / 8 / 7 | 28 | 30-38 | 8-10 |
| World 2 | 7 / 7 / 8 / 8 | 30 | 32-38 (7-8, 8-10, 9-10, 8-10) | 9-11 |
| World 3 | 9 / 7 / 8 / 8 | 32 | 35-41 (10-11, 7-8, 9-11, 9-11) | 9-12 |
| All 12 | | 90 | 97-117 | 26-35, one evening |

- No typical hole reaches 12 strokes; the 15-stroke endurance line is never approached.
- Device flights add time: 2.3-5 s per launch [measured flight times], already in the 16-18 s per stroke.
- Every par is a proposal at or above its measured first-grid line from the tees (5 / 6 / 7 / 6 / 8 / 5 / 7 / 6 strokes) and must be calibrated by the solver before shipping (minimum ≤ par ≤ minimum + 2).

## Verification status

**[measured]** with the real sim (compile and validate, `stepBall`, `evaluateSwitches`), proposed rules emulated:
- All eight levels compile with the real `validateLevel` (cannon and trap patched in after compile) and `levelWarnings` is empty.
- Every launcher (5 springs, 4 cannons): every pad or breech x at 0.25 px steps x 9 launch perturbations (each component at 97 / 100 / 103 %), judged by the target **plate being held**, 100 % everywhere. L8's sort holds for both colours.
- Every hit rate and window quoted above, from the human and fine grids, starting from the stated spots.
- Lone-ball searches (the lone ball gets every turn, its partner never moves, a caught or loaded lone ball is a dead end) and hand-shot sweeps: no level can be finished by one ball. World 1's other co-op properties hold too: both balls always have a route (every line above was played from the tees until both balls were sunk), and solo mode uses the same lines because the WAITING rule simply hands the solo player the free ball.
- Aces: 0 from either tee on every level (429-852 shots per tee).
- Loops: 0 flights over 30 s from every restable spot (every 20 px of fairway plus the device spots, a both-ways grid including straight-up taps), about 13,000-34,000 shots per level; plus 0 in about 73,000 random-play shots from the tees. Every launcher fires exactly once per entry (every pad x at 0.5 px x 9 perturbations, about 9,600 drops).
- Traps and the WAITING rule, played from the tees (no seeded safe spots): 3,200 random games, 0 send-to-tee fallbacks, scoped resets landing where the ball last stood free; seats pass deliberate rolls (0 of 35 stop in an occupied seat in L9 and L12).
- Static checks: no plate, cup or rest floor below y 640; every cup obeys the overview rule (L10 has 1 px to spare); at most 6 stickers per 1,280 px window (L12 needs the combined seat sticker); no slope steeper than 0.27 runs down into a wall, door or gate face.
- Apexes: every launcher apex stays below the 68 px top HUD band at nominal speed (centre y 93-230); at +3 % the L5 spring and L12 cannon graze it (y 65-67).

**Independent re-check (review pass).** A second harness was written from scratch, sharing no code with the design's prototypes. It builds the levels only from Appendix A with the real `compileLevel`, `validateLevel`, `stepBall`, `predictShot` and `evaluateSwitches`. A cannon is modelled as a lit spring, and traps are omitted (they never change a flight). It confirmed:
- All seven launcher levels compile and validate. FIRE plates are referenced by a test post, because a modelled cannon references nothing.
- All 11 launcher and colour cases land on their target plate in 5,031 of 5,031 drops: every pad x at 1 px steps, times 9 launch perturbations at 97/100/103 % per component. The cases are L5, L7, L8 blue and red, L9, L10 spring and cannon, L11 red and blue, L12 cannon and spring.
- With nobody on the release plates, the shut doors in L5 and L9 stop all 324 hand shots from both tees.
- With the cannon cold, no hand shot crosses the L7 chasm: 0 of 1,620 from five approach spots, both colours.
- The flush-footed L12 door stops all 60 low rolls from the seat channel.
- The L5 tee-to-TOP rate with red parked on DOOR is 24.7 % (this doc says 25 %).

Not re-checked independently: the trap and WAITING-rule emulation (the 3,200 random games), the loop sweeps, the aces, the precision windows on L6 and L8, and the lone-ball searches on L6, L8, L10 and L11.

**[estimated]:** human success rates (grid percentages understate them, because the aim preview shows the first landing); typical strokes and minutes; pars; axis ratings; build sizes; readability of the new art (needs the VISUAL.md guess test).

**Build-time verification every level must pass:**
- `validateLevel`, empty `levelWarnings`, `levels.test` (ids, labels, back bunker, hint length), golden replays.
- Solver `coop` and `wide` (par calibration); `solo` unsolvable for both balls; `aces` 0; `walls` and `gaps` with the new opt-outs; `scripted` lines replayed bit-exactly; `stall` (L5, L8 holders); `deck` (L10); input reach, including the leftward lobs in L6, L10, L11 and L12.
- New `launchers` pass: the perturbation test above, judged by the plate held, 0 re-fires.
- New `loops` pass: 0 flights over 1,800 ticks from every restable spot, stall taps included.
- New `traps` pass: from every reachable caught or loaded state the free ball can reach a release or FIRE plate (or the cup holds one), the send-to-tee guard never runs, and resets are tested from the tees.
- Static rules: HUD bands, overview rule, sticker cap, V-wedge rule, cannon muzzle clearance.

Prototype scripts for every number here live in this session's scratchpad (`synthesize/`), not in the repo; the build re-measures everything against the real implementation.

## Appendix A: geometry

Conventions: y grows downward; one terrain piece per polyline, filled to `baseY` 720; vertical faces are 1 px steps. Tees are ball centres; the cup is `[x, rimY]`. Pads (sand, spring) are flush; their `y`/`h` are the drawn band. A permanent blocker is `wall`; a switched one is `blocker`. A cannon is a device whose `releaseSwitch` lists its FIRE plates; a trap's lists its release plates (comma-separated).

### L5 Spring Step
Floor 620. DOOR dish 440-650 (plate 490-600 at y 640) whose far rim meets the wall at 650-690 (cap 200-520, DOOR 520-640, held by `door` or `top`). Spring pad 862-918, launch (150, −800). Cliff at 1080-1081 up to the plateau at 240; TOP dish 1200-1410 (plate 1250-1370 at y 264). Drop at 1460 to the terrace at 440; cup 1690; back bunker 1750-1800. Tees 100 / 150. Cup holds `top`.
```json
{"id":"w2-05-spring-step","name":"Spring Step","width":1800,"floorY":620,"terrain":[{"points":[[0,620],[440,620],[490,640],[600,640],[650,620],[1080,620],[1081,240],[1200,240],[1250,264],[1370,264],[1410,240],[1460,240],[1461,440],[1800,440]],"baseY":720}],"rects":[{"id":"wall-cap","kind":"wall","x":650,"y":200,"w":40,"h":320},{"id":"door-gate","kind":"blocker","x":650,"y":520,"w":40,"h":120,"switchIds":["door","top"],"label":"DOOR"},{"id":"spring","kind":"spring","x":862,"y":620,"w":56,"h":16,"launch":[150,-800],"label":"SPRING"},{"id":"back-bunker","kind":"sand","x":1750,"y":440,"w":50,"h":16}],"switches":[{"id":"door","x":490,"w":110,"y":640,"label":"DOOR"},{"id":"top","x":1250,"w":120,"y":264,"label":"TOP"}],"tees":[[100,608],[150,608]],"cup":[1690,440],"notes":[{"text":"red parks on DOOR: the door opens","x":545,"y":600},{"text":"SPRING (150,-800): every pad x rests on TOP","x":890,"y":580},{"text":"TOP holds the DOOR from above","x":1310,"y":220},{"text":"cup holds TOP","x":1690,"y":420}]}
```

### L6 Booby Trap
Floor 620. Perch 160-340, top 460 (160 px), bowl 200-300 at y 484 (PERCH plate), backboard x 162-182 rising 120 px above the perch. Trap dish at the perch foot 360-460 (floor 640), trap zone 350-450 x 560-640, released by `free` or `far`. FREE dish 640-790 (plate 670-760 at y 636). Tees 540 / 590. Wall 980-1020 (cap 200-520, DOOR 520-640 held by `perch` or `far`). FAR dish 1040-1290 (plate 1090-1240 at y 640). Hump at 1420; green 1540-1700 at y 600, cup 1600, back bunker 1650-1700. Cup holds `far`.
```json
{"id":"w2-06-booby-trap","name":"Booby Trap","width":1700,"floorY":620,"terrain":[{"points":[[0,620],[160,620],[161,460],[170,460],[200,484],[300,484],[330,460],[340,460],[341,620],[360,620],[390,640],[430,640],[460,620],[640,620],[670,636],[760,636],[790,620],[1040,620],[1090,640],[1240,640],[1290,620],[1360,620],[1420,604],[1470,620],[1500,620],[1540,600],[1700,600]],"baseY":720}],"rects":[{"id":"backboard","kind":"wall","x":162,"y":340,"w":20,"h":140},{"id":"wall-cap","kind":"wall","x":980,"y":200,"w":40,"h":320},{"id":"door-gate","kind":"blocker","x":980,"y":520,"w":40,"h":120,"switchIds":["perch","far"],"label":"DOOR"},{"id":"back-bunker","kind":"sand","x":1650,"y":600,"w":50,"h":16}],"switches":[{"id":"perch","x":200,"w":100,"y":484,"label":"PERCH"},{"id":"free","x":670,"w":90,"y":636,"label":"FREE"},{"id":"far","x":1090,"w":150,"y":640,"label":"FAR"}],"devices":[{"id":"snare","kind":"trap","x":350,"y":560,"w":100,"h":80,"releaseSwitch":"free,far","label":"TRAP"}],"tees":[[540,608],[590,608]],"cup":[1600,600],"notes":[{"text":"lob LEFT onto the PERCH: holds the DOOR","x":250,"y":440},{"text":"short? the TRAP holds you","x":400,"y":600},{"text":"FREE, FAR or the cup opens the TRAP","x":715,"y":600},{"text":"FAR holds the DOOR; cup holds FAR","x":1165,"y":600}]}
```

### L7 Load & Fire
Near piece: floor 620, FIRE dish 450-650 (plate 500-600 at y 640), mount 840-961 (top 540), sand funnel 841-889 / 931-960, breech 890-930 at y 565 (the cannon, launch (400, −700), 806 px/s at 60.3°, lit by `fire` or `fire-far`). Chasm 961-1520. Far plateau at y 400: landing sand 1540-1740 with the far FIRE plate 1560-1720 at y 410; cup 1870; back bunker 1920-1960. Tees 100 / 150. Cup holds `fire-far`.
```json
{"id":"w2-07-load-and-fire","name":"Load & Fire","width":1960,"floorY":620,"terrain":[{"points":[[0,620],[450,620],[500,640],[600,640],[650,620],[840,620],[841,540],[890,565],[930,565],[960,540],[961,620]],"baseY":720},{"points":[[1520,400],[1540,400],[1560,410],[1720,410],[1740,400],[1960,400]],"baseY":720}],"gaps":[[961,1520]],"rects":[{"id":"funnel-l","kind":"sand","x":841,"y":552.24,"w":48,"h":16},{"id":"funnel-r","kind":"sand","x":931,"y":552.08,"w":29,"h":16},{"id":"landing","kind":"sand","x":1540,"y":410,"w":200,"h":16},{"id":"back-bunker","kind":"sand","x":1920,"y":400,"w":40,"h":16}],"switches":[{"id":"fire","x":500,"w":100,"y":640,"label":"FIRE"},{"id":"fire-far","x":1560,"w":160,"y":410,"label":"FIRE"}],"devices":[{"id":"cannon","kind":"cannon","x":890,"y":565,"w":40,"h":16,"angleDeg":60.3,"speed":806,"releaseSwitch":"fire,fire-far","label":"CANNON"}],"tees":[[100,608],[150,608]],"cup":[1870,400],"notes":[{"text":"FIRE lights the cannon","x":550,"y":600},{"text":"lob into the funnel: LOADED (waits) or BOOM if lit","x":910,"y":520},{"text":"lands on the far FIRE plate; cup holds it","x":1640,"y":370},{"text":"chasm: +1, back to the safe spot","x":1240,"y":660}]}
```

### L8 Colour Lift
Wall 1 at 200-240: permanent cap 200-320, WINDOW 320-440 (held by the `window` plate), floor-level blue field 440-640. Hopper behind it: rim at 241 (y 560) sloping 0.13 down to the spring pad 702-758 (launch (380, −780)) and up to 560 at 940. Cliff at 1000 up to the plateau at 300 (320 px). WINDOW bowl 1020-1180 (sand, plate 1050-1150 at y 320). Wall 2 at 1200-1240: red field from y −220 to 200 (off the top of the screen), DOOR 200-320 (held by the `door` plate). DOOR bowl 1390-1630 (sand, plate 1420-1600). Drop at 1680 to the terrace at 460; cup 1840; back bunker 1910-1960. Tees 80 / 130. Cup holds `door`.
```json
{"id":"w2-08-colour-lift","name":"Colour Lift","width":1960,"floorY":620,"terrain":[{"points":[[0,620],[240,620],[241,560],[702,620],[758,620],[940,560],[1000,560],[1001,300],[1020,300],[1050,320],[1150,320],[1180,300],[1260,300],[1390,300],[1420,320],[1600,320],[1630,300],[1680,300],[1681,460],[1960,460]],"baseY":720}],"rects":[{"id":"wall-cap","kind":"wall","x":200,"y":200,"w":40,"h":120},{"id":"window","kind":"blocker","x":200,"y":320,"w":40,"h":120,"switchIds":["window"],"label":"WINDOW"},{"id":"blue-field","kind":"colourGate","x":200,"y":440,"w":40,"h":200,"colour":"blue"},{"id":"spring","kind":"spring","x":702,"y":620,"w":56,"h":16,"launch":[380,-780],"label":"SPRING"},{"id":"window-sand","kind":"sand","x":1040,"y":320,"w":120,"h":16},{"id":"red-field","kind":"colourGate","x":1200,"y":-220,"w":40,"h":420,"colour":"red"},{"id":"door","kind":"blocker","x":1200,"y":200,"w":40,"h":120,"switchIds":["door"],"label":"DOOR"},{"id":"door-sand","kind":"sand","x":1410,"y":320,"w":200,"h":16},{"id":"back-bunker","kind":"sand","x":1910,"y":460,"w":50,"h":16}],"switches":[{"id":"window","x":1050,"w":100,"y":320,"label":"WINDOW"},{"id":"door","x":1420,"w":180,"y":320,"label":"DOOR"}],"tees":[[80,608],[130,608]],"cup":[1840,460],"notes":[{"text":"blue passes its own field; red needs the WINDOW","x":220,"y":180},{"text":"hopper feeds the SPRING (380,-780)","x":730,"y":590},{"text":"blue bounces off the red field onto the WINDOW plate","x":1100,"y":280},{"text":"red flies through onto the DOOR plate; cup holds DOOR","x":1510,"y":280}]}
```

### L9 Bait
Floor 620. Sunken channel 490-760 at y 640 that runs under the wall (650-690: cap 200-520, DOOR 520-640 held by `bait` or `top`); BAIT plate 490-600 inside the trap zone 480-610 x 590-640 (released by `top`). Yard 800-960 with sand 820-950. Raised spring mouth: lip 961-968 at y 564, pad 976-1040 at y 580 (launch (200, −740)), open muzzle side. Cliff at 1240 up to the summit at 260; TOP bowl 1260-1480 (sand 1270-1470, plate 1300-1440 at y 280). Drop at 1560 to the terrace at 440; cup 1840; back bunker 1910-1960. Tees 100 / 150. Cup holds `top`.
```json
{"id":"w3-09-bait","name":"Bait","width":1960,"floorY":620,"terrain":[{"points":[[0,620],[440,620],[490,640],[760,640],[800,620],[960,620],[961,564],[968,564],[976,580],[1040,580],[1041,620],[1240,620],[1241,260],[1260,260],[1290,280],[1450,280],[1480,260],[1560,260],[1561,440],[1960,440]],"baseY":720}],"rects":[{"id":"wall-cap","kind":"wall","x":650,"y":200,"w":40,"h":320},{"id":"door","kind":"blocker","x":650,"y":520,"w":40,"h":120,"switchIds":["bait","top"],"label":"DOOR"},{"id":"spring","kind":"spring","x":976,"y":580,"w":64,"h":16,"launch":[200,-740],"label":"SPRING"},{"id":"yard-sand","kind":"sand","x":820,"y":620,"w":130,"h":16},{"id":"top-sand","kind":"sand","x":1270,"y":280,"w":200,"h":16},{"id":"back-bunker","kind":"sand","x":1910,"y":440,"w":50,"h":16}],"switches":[{"id":"bait","x":490,"w":110,"y":640,"label":"BAIT"},{"id":"top","x":1300,"w":140,"y":280,"label":"TOP"}],"devices":[{"id":"bait-trap","kind":"trap","x":480,"y":590,"w":130,"h":50,"releaseSwitch":"top","label":"TRAP"}],"tees":[[100,608],[150,608]],"cup":[1840,440],"notes":[{"text":"BAIT plate sits in a TRAP and holds the DOOR","x":545,"y":600},{"text":"raised mouth: lob in, SPRING to TOP","x":1008,"y":540},{"text":"TOP frees the bait and holds the DOOR; cup holds TOP","x":1370,"y":240}]}
```

### L10 Sky Bridge
Cannon drum 41-160 (top 580) with the breech 76-124 at y 600 (launch (520, −760), 921 px/s at 55.6°, lit by `a`, `b` or `deck`). Tee flat to 600; spring pad 442-498 (launch (120, −690)). Spire A face at 600, top 400; A bowl 640-820 (sand, plate 670-790 at y 416). Chasm 860-1580 with the BRIDGE at y 400 (held by `a`, `b` or `deck`; DECK plate 884-1556 on it). Spire B: bowl 1600-1780 (sand, plate 1630-1750 at y 416), green 1830-1960 at y 390, cup 1880, back bunker 1930-1960. Tees 280 / 330. Cup holds `b`.
```json
{"id":"w3-10-sky-bridge","name":"Sky Bridge","width":1960,"floorY":620,"terrain":[{"points":[[0,620],[40,620],[41,580],[56,580],[76,600],[124,600],[144,580],[160,580],[161,620],[600,620],[601,400],[640,400],[670,416],[790,416],[820,400],[860,400]],"baseY":720},{"points":[[1580,400],[1600,400],[1630,416],[1750,416],[1780,400],[1810,400],[1830,390],[1960,390]],"baseY":720}],"gaps":[[860,1580]],"rects":[{"id":"spring","kind":"spring","x":442,"y":620,"w":56,"h":16,"launch":[120,-690],"label":"SPRING"},{"id":"bridge","kind":"bridge","x":860,"y":400,"w":720,"h":18,"switchIds":["a","b","deck"],"label":"BRIDGE"},{"id":"a-sand","kind":"sand","x":642,"y":416,"w":176,"h":16},{"id":"b-sand","kind":"sand","x":1602,"y":416,"w":176,"h":16},{"id":"back-bunker","kind":"sand","x":1930,"y":390,"w":30,"h":16}],"switches":[{"id":"a","x":670,"w":120,"y":416,"label":"A"},{"id":"b","x":1630,"w":120,"y":416,"label":"B"},{"id":"deck","x":884,"w":672,"y":400,"label":"DECK"}],"devices":[{"id":"cannon","kind":"cannon","x":76,"y":600,"w":48,"h":16,"angleDeg":55.6,"speed":921,"releaseSwitch":"a,b,deck","label":"CANNON"}],"tees":[[280,608],[330,608]],"cup":[1880,390],"notes":[{"text":"cold cannon: a ball waits here LOADED","x":100,"y":560},{"text":"SPRING to plate A","x":470,"y":600},{"text":"A, B or DECK hold the BRIDGE and light the CANNON","x":730,"y":380},{"text":"cannon lands on B; cup holds B","x":1690,"y":380}]}
```

### L11 Crossfire
FIRE ledge 0-200 at y 520-530 (plate 60-180 at y 530) behind a full-height blue field at 230-270 (200-640). Floor 620 to 740. Red field 700-740 (200-520) standing on a DOOR 520-640 (held by `far`). Cannon pit with sand 741-779 / 841-879 sloping to the breech 780-840 at y 640 (launch (440, −730), 852 px/s at 58.9°, lit by `fire` or `far`). Chasm 900-1460. Far plateau at y 400: FAR bowl 1480-1720 (sand, plate 1500-1700 at y 412); cup 1860; back bunker 1910-1960. Tees 420 / 470. Cup holds `far`.
```json
{"id":"w3-11-crossfire","name":"Crossfire","width":1960,"floorY":620,"terrain":[{"points":[[0,520],[40,520],[60,530],[180,530],[200,520],[201,620],[740,620],[780,640],[840,640],[880,620],[900,620]],"baseY":720},{"points":[[1460,400],[1480,400],[1500,412],[1700,412],[1720,400],[1960,400]],"baseY":720}],"gaps":[[900,1460]],"rects":[{"id":"blue-field","kind":"colourGate","x":230,"y":200,"w":40,"h":440,"colour":"blue"},{"id":"red-field","kind":"colourGate","x":700,"y":200,"w":40,"h":320,"colour":"red"},{"id":"door","kind":"blocker","x":700,"y":520,"w":40,"h":120,"switchIds":["far"],"label":"DOOR"},{"id":"pit-l","kind":"sand","x":741,"y":630,"w":38,"h":16},{"id":"pit-r","kind":"sand","x":841,"y":630,"w":38,"h":16},{"id":"landing","kind":"sand","x":1480,"y":412,"w":240,"h":16},{"id":"back-bunker","kind":"sand","x":1910,"y":400,"w":50,"h":16}],"switches":[{"id":"fire","x":60,"w":120,"y":530,"label":"FIRE"},{"id":"far","x":1500,"w":200,"y":412,"label":"FAR"}],"devices":[{"id":"cannon","kind":"cannon","x":780,"y":640,"w":60,"h":16,"angleDeg":58.9,"speed":852,"releaseSwitch":"fire,far","label":"CANNON"}],"tees":[[420,608],[470,608]],"cup":[1860,400],"notes":[{"text":"FIRE: blue only (behind the blue field)","x":120,"y":500},{"text":"red only: lob through the red field into the cannon","x":760,"y":480},{"text":"FAR opens the DOOR and keeps the cannon lit; cup holds FAR","x":1600,"y":380}]}
```

### L12 Grand Machine
Pit 0-40 at y 640 (trap zone 12-40 x 590-640, released by `fire` or `top`). Cannon mount 41-200 (top 540) with sand funnels 41-99 / 141-199 and the breech 100-140 at y 565 (launch (700, −760), 1,033 px/s at 47.4°, lit by `fire` or `top`). Floor 620; FIRE dish 420-600 (plate 460-560 at y 640). Seat channel at y 640 from 680 under the wall (820-860: cap 200-520, DOOR 520-640 held by `door` or `top`) to the cliff at 1180; DOOR plate 680-780 inside the trap zone 680-780 x 590-640 (released by `top`); spring pad 972-1028 on the channel floor (launch (180, −800)). Cliff at 1180-1181 up to the summit at 320; TOP basin 1215-1690 at y 334 (sand 1205-1690, plate 1230-1680) with a dirt face at 1691; step down at 1731 to the green at 400; cup 1850; back bunker 1900-1960. Tees 300 / 350. Cup holds `top`.
```json
{"id":"w3-12-grand-machine","name":"Grand Machine","width":1960,"floorY":620,"terrain":[{"points":[[0,640],[40,640],[41,540],[100,565],[140,565],[200,540],[201,620],[420,620],[460,640],[560,640],[600,620],[640,620],[680,640],[1180,640],[1181,320],[1200,320],[1215,334],[1690,334],[1691,300],[1730,300],[1731,400],[1960,400]],"baseY":720}],"rects":[{"id":"funnel-l","kind":"sand","x":41,"y":552.29,"w":58,"h":16},{"id":"funnel-r","kind":"sand","x":141,"y":552.5,"w":58,"h":16},{"id":"wall-cap","kind":"wall","x":820,"y":200,"w":40,"h":320},{"id":"door","kind":"blocker","x":820,"y":520,"w":40,"h":120,"switchIds":["door","top"],"label":"DOOR"},{"id":"spring","kind":"spring","x":972,"y":640,"w":56,"h":16,"launch":[180,-800],"label":"SPRING"},{"id":"top-sand","kind":"sand","x":1205,"y":334,"w":485,"h":16},{"id":"back-bunker","kind":"sand","x":1900,"y":400,"w":60,"h":16}],"switches":[{"id":"fire","x":460,"w":100,"y":640,"label":"FIRE"},{"id":"door","x":680,"w":100,"y":640,"label":"DOOR"},{"id":"top","x":1230,"w":450,"y":334,"label":"TOP"}],"devices":[{"id":"cannon","kind":"cannon","x":100,"y":565,"w":40,"h":16,"angleDeg":47.4,"speed":1033,"releaseSwitch":"fire,top","label":"CANNON"},{"id":"door-seat","kind":"trap","x":680,"y":590,"w":100,"h":50,"releaseSwitch":"top","label":"TRAP"},{"id":"pit","kind":"trap","x":12,"y":590,"w":28,"h":50,"releaseSwitch":"fire,top","label":"TRAP"}],"tees":[[300,608],[350,608]],"cup":[1850,400],"notes":[{"text":"pit TRAP: FIRE or TOP frees it","x":26,"y":600},{"text":"FLY: lob LEFT into the cannon","x":120,"y":520},{"text":"FIRE lights the cannon","x":510,"y":600},{"text":"DOOR plate sits in a TRAP (seat)","x":730,"y":600},{"text":"CLIMB: SPRING to TOP","x":1000,"y":600},{"text":"TOP: door, cannon, both traps; cup holds TOP","x":1455,"y":300}]}
```

## Appendix B: proposals considered

Three proposals were judged by three judges (plan fidelity, feasibility, player experience). The workflow's tally keyed scores by label, and the plan-fidelity judge used longer labels, so each proposal's score was split across two keys (it reported "A=14, C=13.5, B=12" plus "C=8, A=7, B=5"). Combined per proposal: **C 21.5, A 21, B 17**, effectively a tie between A and C. This document keeps A's co-op machines as its spine (partner-fired cannon, seats, the shared waiting rule, Load & Fire, Crossfire, Grand Machine) and takes C's budget discipline and trap teaching, which is where both judges' grafts and required fixes pointed. Where the judges disagreed: the cannon model follows A (judge 3) over C's instant cannon (judges 1 and 2), because the co-op shape is the point of the game and the extra cost is one wake rule plus a camera follow; fans stay out (judges 1 and 2 over judge 3's Updraft), because a freeze that only the host can clear is worse than a missing toy.

**A: Co-op Machines.** Every device needs both players: a cannon your partner fires, jaws your partner opens, a backstop your partner raises, springs behind held doors; one shared waiting rule; World 3 welds World 2 machines into a four-route finale. Judges: the strongest co-op spine and finale, the best precision-plus-partner idea (the backstop), carefully specified rules; but four new ideas in four World 2 holes with no exam, an L8 spike, traps that were almost all seats (the "booby trap" barely appeared), cannon vectors that failed a ±10 px/s check in L11 and L12, a pit under the HUD band, and two view changes it relied on. Used here: L7 (A's L7), L11 (A's L10, opening lay-up added, pit raised to y 640, cannon re-tuned), L12 (A's L12, re-built: one TOP basin that both launchers land in, a flat seat channel, pit at y 640, cannon re-tuned to pass ±3 %), the waiting rule, seats and combined stickers, the camera follow.

**B: Vertical Ascent.** Height as the signature of every hole (climbs of 220-400 px), a different co-op relationship per hole, partner-fired cannons, a snare introduced in World 3, and fans with a proposed "lean". Judges: the best owner fit and set pieces (the Updraft counterweight, the Sky Bridge chain reaction), and it offered your literal hard lock as a bounded option; but three holes depended on a fan change that still froze in one corner, the trap arrived late (World 3) and in only two holes, partner-fired flights ran off-camera, the L11 cannon was on a knife edge, and "no protocol change" was wrong. Used here: L10 (B's Sky Bridge, spires lowered to y 400 for the overview rule, cannon re-tuned), the sand-catch-bowl pattern for launcher landings, the hard-lock option in decision 1.

**C: Lean and Verifiable.** Two new toys and one new rule: a cannon that is a spring with a barrel, and a trap first taught as a hazard, then subverted (Bait); fan and bumper cut with evidence; an exam hole; the scoped one-ball reset; the overview rule for cup heights. Judges: the best mechanic budget and session discipline; but thin verticality (flat cannon crossings, a 140 px perch), a staircase level that spiked several axes, overflowed the sticker cap and sent trapped climbers back to the tee, a colour sort that broke under ±10 px/s and missed its plate, cups behind the HUD band, and a cannon with no co-op of its own. Used here: L6 (C's perch and trap, perch raised to 160 px), L8 (C's Colour Lift, rebuilt: a window lob for red, a hopper, sand bowls and a spread layout so the sort holds for every ±3 % launch and the sticker cap holds), L9 (C's Bait, merged with A's door seat and a sunken channel), the budget structure and the scoped reset.

**Roads not taken.** C's Lighthouse Steps (five precision jumps up trapped steps): the purest "precision climb", but five 5-20 % jumps in a row put typical play near the 15-stroke endurance line and the hole combines only the trap and a door. A's High Perch backstop (decision 6). A's Jaws Ladder (a seat-only ladder that teams lost track of). B's Updraft and Two Sides (fans). B's Crossfire (two cannons firing each other, fragile vectors). C's Cannon Pen and Crossroads (flat crossings into a pen, cups behind the HUD band) and Colour Cannon (repeats the colour sort).
