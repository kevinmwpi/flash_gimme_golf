# Lead decisions reconciling the five design tracks (binding for every build agent)

Read ARCH.md first; where ARCH.md, VISUAL.md, LEVELS.md, UX.md or AUDIO.md disagree, THIS file wins.

## D1. Numbers
- `SHOT_SPEED_PER_POWER = 6.5` (types.ts updated). Max launch 650 px/s, flat-ground range 681 px, max height 341 px.
  Every ARCH/physics number quoted as "746 / 373" is now 681 / 341. LEVELS verified the final levels at 6.5.
- `GIMME_RADIUS = 40` (types.ts updated). Plates are >= 500 px from every cup so a gimme can never concede a holder.
- Pointer drag constants (types.ts updated, single source): `DRAG_FULL_POWER_PX = 240`, `DRAG_DEAD_ZONE_PX = 24`,
  `DRAG_CANCEL_RADIUS_PX = 24`, `DRAG_GRAB_RADIUS_PX = 48` (mouse), `DRAG_GRAB_RADIUS_TOUCH_PX = 80` (touch).
  Power formula unchanged: `MIN + |d| / DRAG_FULL_POWER_PX * (MAX - MIN)`; the ARCH test row becomes "move 120 px => power 55".
- `OUTLINE_WIDTH = 4` and on-object label size 15 px (VISUAL.md wins over ARCH 1.9's 3 / 18).

## D2. Level data model (additive fields now in types.ts; SIM, LEVELS, VIEW must honour them)
- `RectBase.switchIds?: readonly string[]` — OR semantics: when present the rect is active iff (any listed switch
  pressed) === (activeWhen ?? kind default). It overrides `switchId`. `BridgeRect` requires `switchId` OR `switchIds`
  (validity rule). `bridgeToggle` fires once per rect per change. Used by L4's bridge (`near | far | deck`).
- `PressureSwitch.onRectId?: string` — a DECK plate that lives on top of a bridge/blocker rect: it is pressed only
  while that rect is active and the resting ball's `groundAt` source is THAT rect (index match); plates without
  `onRectId` require `g.source === 'piece'` (unchanged). `surfaceY` of a deck plate = the rect's top y. The view
  draws a deck plate only while its rect is active. Used by L4's `deck` plate (inset 24 px from both lips; since D11
  any ball on it presses it, and the L4 and L10 decks span their bridge lip to lip).
- `Level.cupHoldsSwitch?: string` — a level may wire the cup to ONE switch: while ANY ball is sunk that switch counts
  as pressed (evaluated inside `evaluateSwitches` after ball contacts). L2 -> `window`, L3 -> `door2`, L4 -> `far`.
  The HUD chip says "HOLDS <label> FROM THE CUP".
- `Level.firstPlayer: PlayerId` (required) — replaces the `levelIndex % 2` rule everywhere (`createSim`,
  `restartLevel`, next-level transition). L1 red, L2 red, L3 BLUE, L4 red. `levelStart.firstPlayer` reports it.
- Vocabulary mapping from LEVELS.md to types.ts: "wall" = `blocker` WITHOUT switchId (permanent); "door"/"window" =
  `blocker` with `switchId`, `activeWhen: false` (solid until held); "colour field" = `colourGate`; "plate" =
  `PressureSwitch`; "dish/bowl" = ordinary terrain polyline (20 px deep, 50 px ramps ~22 deg, which is above
  `REST_MAX_SLOPE` so balls roll back onto the flat plate); sand = `sand` rect range.
- A ball ASLEEP whose centre is inside a rect that just became solid (door closing on it) is woken by `stepBall`
  step 1 (treat "inside an active blocker/bridge/wrong-colour-gate AABB" like "support vanished") and ejected through
  the nearest face by the normal contact resolution. No special "side it came from" tracking.
- Switch press zone: ball centre x inside `[sw.x, sw.x + sw.w]` with the contact tolerance in types.ts (no extra
  margin). Deck plate press requires the ball fully on the bridge by geometry (the 24 px inset does that). Since D11
  the deck runs lip to lip and the ground-source rule alone keeps a ball resting at a lip from pressing it.
- Labels: every switch and every switch-driven rect in the shipped levels carries a short `label` that matches the
  hint copy: L2 `DOOR` / `WINDOW`; L3 `DOOR 1` / `DOOR 2`; L4 `A` / `B` / `DECK` (bridge label `BRIDGE`). The renderer
  shows stickers as `<LABEL> · ON|OFF` (switch) and `<LABEL> · OPEN|SHUT` (door/window) / `BRIDGE · ON|OFF`; with no
  label it falls back to `SWITCH <letter>` by index. HUD chip status: `HOLDS DOOR`, `AIMING`, `WAITING`, `IN THE CUP`.
- Spring, bumper and fan are NOT used in World 1 but ARE implemented, rendered and unit-tested (SIM + VIEW).
- No `wait` command. The "stall tap" is taught by the holder tip (`src/ui/holderTip.ts`): at most once per hole (a restart re-arms it; online, each browser only for its own ball), at the start of a turn whose ball rests on a plate the partner still needs (never a deck plate or the cup-wired plate; since D11 a deck plate may be named, because a stall tap keeps it pressed). Levels are verified without it.
- Pars: 6 / 7 / 9 / 8 as authored; the LEVELS re-verification stage may adjust by +-1 with evidence.

## D3. Contract requests accepted (owners must implement them)
- UX CD-1, CD-2, CD-3: already in ARCH (continue from either seat online; host restartLevel in levelResults; setLevel/lobbyState).
- UX CD-4: constants stay in types.ts with the UX values (D1). Audio owns its persistence (see D4).
- UX CD-5: **SUPERSEDED by D7 (no overscan).** Original text, kept for history: NO tee >= 280 assertion. Instead the follow camera OVERSCANS: while the active player is aiming and the
  active ball's screen x would be < 320, `cameraFor` lets camera.x go negative down to -220 (and symmetrically past
  the right edge for leftward shots) so a full-power drag always has room; the renderer paints sky everywhere and
  extends the dirt/grass of the first/last terrain piece horizontally beyond the level bounds (flat continuation).
- UX CD-6: `GameClient.tryReconnect()` retries every 2 s until `dropAt + LIMITS.reconnectGraceMs`;
  `ClientStatus.reconnecting` gains `deadlineMs: number`.
- UX CD-7: `FrameSummary` gains `sunk: [boolean, boolean]` and `turnDelayTicks: number`.
- AUDIO 1-5: `SfxName` gains `'uiHover' | 'uiInvalid' | 'uiPause' | 'uiResume' | 'partnerLeft' | 'aimTick'`;
  `AudioSystem` gains `attachUnlock(target?: EventTarget)`, `onReady(cb: () => void): () => void`, `setVolume(v: number)`,
  `setFan(active: boolean, intensity01: number)`, `readonly settings: { muted: boolean; music: boolean; volume: number }`,
  `readonly ready: boolean`; `handleEvents(events, nowMs, delaySec = 0)`. audio.ts persists `flashgolf.audio.*` itself;
  `src/ui/storage.ts` has NO loadMuted/saveMuted; Title/Hud/Pause/Settings seed `muted` from `audio.settings.muted`.
  `Settings.tsx` shows mute + music + ONE volume slider. `GameCanvas` calls `audio.setFan(active, intensity)` once per
  frame (active = any non-sunk ball inside an active fan AABB; intensity = 1) and passes `delaySec = 0` in both modes
  (online events are already released at render time by `drainEvents`).
- VISUAL 1-5: paper hint pill; mid-hole team chip copy `N TO SPARE / AT PAR / N OVER` (results keep the golf delta);
  sticker words per D2; outline 4 px / labels 15 px; ball/mechanic callouts (GIMME! +1, IN THE HOLE!, OUT! +1,
  LOCKED!, BONK!, SAND…, LIFT!, SWITCH/DOOR HELD, BRIDGE OPEN/GONE, SO CLOSE) are CANVAS text anchored in the world
  (ViewState.callouts, VIEW owner). The React `Callouts.tsx` renders ONLY the turn banner ("RED'S TURN" / "YOUR TURN")
  and toasts ("Blue teed off", "Red restarted the hole", "Blue is here!", "Red left", the holder tip).

## D4. Ownership clarifications
- Mute/music/volume persistence: VIEW (audio.ts). Bests/onboarded/hint-device settings: UI (storage.ts, key `fg.v1.*`).
- The Google Font (Fredoka 700 + a text weight) is linked from index.html (UI). Canvas text uses the same family:
  VIEW waits for `document.fonts.load('700 20px Fredoka')` (with a 1.5 s timeout) before the first render and re-renders
  once loaded; system-ui fallback.
- `scripts/solver.ts` (LEVELS) is built on the NEW sim (`runReplay`, `predictShot`, `evaluateSwitches`), not the old
  scratch solver. It runs in the dedicated LEVELS re-verification stage AFTER the SIM group has delivered.
- The scaffolder follows ARCH.md §8 (scripts, tsconfigs, deps) and §9 (stub strategy) exactly; TOOLING then finalises.

## D5. Explicit deviations from the brief (recorded, intentional)
- No `start` PlayerCommand (ARCH R1): starting is a UI action locally and the `start` protocol message online.
- Who goes first is per level (`firstPlayer`), not strictly alternating.

## D6. Online never auto-advances (resolves the ARCH #30 vs UX §3.4 conflict; lead decision 2026-10-03)
- The server sends NO synthetic `continue`: intro and results cards wait for a `continue` from EITHER seat (first
  wins, CD-1), so nobody can stall the partner and a first-time pair never loses the hole hint mid-read.
- `INTRO_AUTO_CONTINUE_MS` / `RESULTS_AUTO_CONTINUE_MS` stay exported from the frozen protocol.ts but are unused.
- The cards show no countdown ring; the caption is the device hint ("or press Space" / "or tap anywhere").
- Implemented by the lead in server/rooms.ts (+ rooms.test.ts), App.tsx, LevelIntro.tsx, LevelResults.tsx, copy.ts,
  styles.css, ARCHITECTURE.md. Do not reintroduce a timer.

## D7. The follow camera never overscans (supersedes D3 CD-5; lead decision 2026-10-03)
- `cameraFor(level, state, 'follow')` is always clamped to `[0, level.width - 1280]`: one-screen holes (First
  Fairway) never scroll, so the cup is visible while aiming from the tee, and tee shots no longer jump 220 px.
- Pull room near a stage edge comes from the pointer adapter: the drag length that reads full power shrinks to the
  room available along the pull (`fullPowerPx`, never below `DRAG_MIN_FULL_POWER_PX`), so every scripted line stays
  reachable. `src/view/__tests__/input-reach.test.ts` now presses from the ball as the REAL follow camera shows it.
- The renderer still extends the outer terrain pieces past the level bounds for the overview camera; that is
  drawing, not camera overscan.

## D8. Accepted as-is (reviewers: do not re-report these as defects)
- Default `ALLOWED_ORIGINS` includes `https://flash-golf-*.vercel.app` so Vercel preview builds can play online.
  Origin checks are not a security boundary (any non-browser client can send any Origin); the server validates
  every message, rate-limits and caps rooms regardless. README documents the trade-off.
- A door that closes on a parked ball ejects it through the nearest face (D2), even when that face is the tee side.
- `.claude/settings.json` (third-party plugin marketplace) is the owner's call; leave it untouched.
- The slow solver suite (`npm run test:levels`) runs in its own workflow (one CI job per world since D10.13), not in `npm test`.
- `CLAUDE.md` edits are limited to the dated status note in §5 and the §11 companion list; both are sanctioned.

## D9. Pars are final: 6 / 7 / 8 / 7 (course par 28)
- Colour Keys keeps par 8 with its documented slack exception (`PAR_SLACK_BY_ID = { 'w1-03-colour-keys': 3 }` in the solver, keyed by id since D10.1):
  its structural solver minimum is 5, but the human line needs 7-8 strokes.
- Change a par only together with fresh `npm run solve -- all` evidence and the matching golden/test updates.

## D10. Worlds 2-3 build (lead decisions 2026-10-31; binding for the levels 5-12 build)
What to build is `design/proposals/worlds-2-3/LEVELS.md` (owner-approved 2026-10-08). The owner confirmed on
2026-10-31 that the Phase 2 exit condition cleared with testing finished, and that playtesters raised no turn-flow
complaints, so decision 2 stands as designed: skipped turns, a banner on every skip and a HUD chip naming the release.
The one playtest complaint (the slingshot drag clipped at the window edge) is fixed by D10.9. Where this section and an
older document (ARCH, VISUAL, UX, AUDIO, LEAD_BRIEF, the World 1 LEVELS.md, D1-D9) disagree, this section wins.

- **D10.1 Hole numbers are global.** `Level.order` is the 1-based position in the whole game (1-12) and IS the hole
  number on every screen. Ids are `w1-01-…` to `w3-12-…`; worlds hold holes 1-4, 5-8 and 9-12. "OF N" counts every hole
  in the game (12). World names: `World 1 — Teach`, `World 2 — Lift & Lock`, `World 3 — Sky Machines`. Scripted lines,
  goldens and par slack are keyed by level id, never by order.
- **D10.2 One world per session.** `campaignFrom(levelId)` runs from that hole to the last hole of ITS world. The world
  results card offers "Continue to World N+1" when one exists (online: host only, like Play again), Play again, Level
  select and Title. Online, `playAgain` gains an optional `levelId` (the first hole of the next campaign; the server
  checks `hasLevel` and builds `campaignFrom`). No locks or unlocks, no new storage keys, no new URL parameters.
- **D10.3 Protocol and snapshot.** `PROTOCOL_VERSION` 4. `SimState.flightTicks` (consecutive ticks in phase `flying`,
  0 in every other phase, never above `FLIGHT_WATCHDOG_TICKS - 1`) is appended as the LAST snapshot element and
  `SNAPSHOT_VERSION` becomes 2 in the same commit. Older `?state=` links show the existing "older version" card.
  World 1 behaviour is unchanged: its goldens may differ only in the version number and the appended `0`.
- **D10.4 Devices.** TRAP and CANNON are `LevelRect` kinds driven by `switchIds` (OR), like a door and a bridge. A trap
  is ARMED (active) while none of its releases is held; a cannon is LIT (active) while any FIRE plate is held. A lit
  breech behaves exactly like a spring and emits `cannonFire` instead of `spring`; a cold breech is ordinary ground.
  `bridgeToggle` never fires for trap or cannon rects: their state is read from `switches`, and their events are
  `trapCaught`, `trapFreed`, `trapReturn`, `cannonLoad`, `cannonFire`. `turnSkipped` is emitted in the same tick as,
  and before, the `turnStart` it explains. `trapReturn` and `flightTimeout` teleport a ball and are
  `IMMEDIATE_SNAPSHOT_EVENTS`. The shared device queries live in `src/sim/devices.ts`.
- **D10.5 WAITING rule sequencing.** ARCH R5 still holds: the tick a switch changes never also emits `turnStart`. At a
  hand-off the next shooter is the first of [the other ball, the same ball] that is neither sunk nor waiting (caught or
  loaded). If nobody can shoot, the scoped reset sends the waiting ball that moved last (the shooter if it is waiting,
  else the other) to its safe spot with +1 (`trapReturn`), then the other waiting ball, then, as a guard the solver
  proves never runs, the first target to its tee. A reset that would not move the ball is skipped (no stroke, no
  event). When a reset changes a switch, the switch diff is emitted and the hand-off waits for the next settled tick.
  A ball's safe spot (`lastRest`) is recorded only while it is free: never while caught, never on a cannon breech, never
  on a bridge; a ball freed where it sits records its spot at the hand-off.
- **D10.6 Flight watchdog.** A flight still running after `FLIGHT_WATCHDOG_TICKS` (1,800 ticks, 30 s) ends: every moving
  ball goes to its safe spot with no penalty (`flightTimeout`). It is a safety net, not a timer players see; the solver's
  loops pass proves it never fires on the shipped levels.
- **D10.7 Camera.** The follow camera follows the ball a SPRING or CANNON launched until it rests, even during the
  partner's turn (UX §4.3 "the moving ball" wins over VISUAL §3 / ARCH §1.8 "the active ball"), then returns to the
  active ball at the next `turnStart`. A ball above the top of the frame gets an off-screen marker in its colour, below
  the HUD band. D7 (no overscan) still holds.
- **D10.8 Labels.** Device stickers (`TRAP · ARMED` / `TRAP · OPEN`, `CANNON · LIT` / `CANNON · COLD`) rank with
  plates and doors. Sand that is part of a device (a cannon funnel) carries no sticker. A plate inside a trap draws ONE
  combined seat sticker (`BAIT · TRAP`, `DOOR · TRAP`). A sticker or badge for a prop that extends above the frame is
  anchored inside the visible playfield. The cap stays 6 stickers per 1,280 px window, and every device, door, plate,
  spring and colour field on levels 5-12 must keep its sticker at every follow-camera position (tested). Rect ids and
  switch ids are disjoint within a level (`door-gate`, `window-gate`). Springs are drawn at their rect width with
  chevrons along the launch vector.
- **D10.9 Slingshot drag (playtest fix; supersedes LEAD_BRIEF #10, UX §5.2 "Not anywhere", ARCH §7).** On the local
  aiming seat's turn, a press anywhere on the playfield canvas starts a drag measured from the press point (mouse, pen
  and touch). A press on the partner's ball still reports "wrong ball". The rubber band is drawn from the ball, offset by
  the drag. Taps under the dead zone never shoot, and releasing back at the press point still cancels. D7's
  compression stays as the safety net for presses on an edge ball. Copy and coach teach "drag back anywhere".
- **D10.10 Waiting cues.** HUD chip `CAUGHT · needs <LABELS>` / `LOADED · needs <LABELS>`, where LABELS names the
  device's release plates, every distinct label in authored order ('FREE or FAR', 'A, B or DECK'), because the
  first-listed plate is not always the one the partner can reach. It is derived from SimState every frame,
  never from events. Every skipped turn shows the turn banner with the line "Red is caught — Blue shoots again" (or "is
  loaded"), and the live region reads it. The holder (stall-tap) tip never shows while either ball is waiting, and never
  names a plate whose only consumers are traps or cannons. A plate that also drives a door or bridge (L10's A raises the
  bridge and lights the cannon) can still be named while the partner is free and needs that door or bridge, as in World
  1's Plate & Bridge (lead reading, 2026-11-01).
- **D10.11 Audio.** Trap, cannon, return and skip sounds follow AUDIO.md's timbre-per-mechanic rule; no new continuous
  loops (LIT and ARMED are visual only). One music bed per world on the existing white-key set (World 2 D Dorian, World 3
  centred on F); title and lobby keep the World 1 bed. The fan loop stops when a game is left.
- **D10.12 Level rules.** Wind is 0 in every world. `mechanicsIntroduced` holds at most one mechanic: exactly one in
  World 1 and on holes 5-7, none on holes 8-12 (the intro card hides its NEW row). D1's "plates >= 500 px from every
  cup" applies to World 1 only; every plate edge must still be more than `GIMME_RADIUS + NEAR_CUP_RADIUS` from the cup.
  Doors may stand flush on a channel floor (L9, L12): a door closing on a ball in its doorway ejects it sideways
  (tested). Appendix A geometry is used verbatim except where an existing level rule forces a minimal change (L10's
  back bunker and plate B), re-verified by the launcher checks, or where verification found a defect: Bait's BAIT plate
  spans 490-610 (Appendix A: 490-600), the trap's whole restable floor, because a ball resting at 600-610 was caught
  without holding the door and its partner could never progress (a softlock the scoped reset cannot end while the
  partner can still shoot). A plate inside a trap must cover that trap's restable floor. Crossfire's cannon
  pit side runs on to the chasm lip (Appendix A: a 20 px flat at 880-900) for the same reason: a ball resting
  on that flat when red left FAR could reach neither FIRE nor FAR. One rare state stays a known residual
  (levels README): blue LOADED in Crossfire's cold cannon with red free on the near side, reachable only by
  two deliberate shots back across the chasm; only a host restart ends it. Two touching windows or doors:
  a door closing on a ball ejects it through a face whose exit is clear of terrain AND of other solid
  rects (a window stacked on a wall a ball can rest on froze Colour Lift and, latently, Two Doors).
- **D10.13 Verification.** The solver adds `launchers`, `loops` and `traps` passes and explicit opt-outs (backboards and
  ledge-only columns for `walls`, cannon-crossed gaps for `gaps`). Pars are calibrated as D9 and LEVELS.md require
  (solver minimum <= par <= minimum + 2): Booby Trap 7 -> 6 (minimum 4: once red holds the perch, blue can hole out
  from its tee through the open door), Bait 9 -> 8 and Grand Machine 8 -> 7; course pars 28 / 29 / 30 (28 / 29 / 29
  since D11 lowered Crossfire 8 -> 7). The slow suite
  is split per world and runs as a CI matrix.
- **D10.14 UI and visual amendments from the review (2026-11-01; UX.md and VISUAL.md are amended by this list).**
  Every card (intro, results, world results, dialogs) ignores presses for its first 400 ms (`CARD_INPUT_GRACE_MS`) and
  never acts on a held Enter/Space; Escape and Tab work at once. The drag coach never takes presses except its 'Got
  it' button. The HUD band follows `--hud-scale` (12 + 48·s + 8) on canvas and DOM alike; on rows of 900 logical px
  or less (`.row-narrow`) a waiting chip's status hangs under it as a paper sticker and the band grows to keep it
  clear. HOLDS covers cup-wired plates while a ball rests on them. Lobby START AT rows are ARIA radio groups with a
  roving tabindex. Hint and coach copy follow the page's last input device (keyboard players get keyboard copy).
  Colour-field stripes are drawn in the field's own colour; a field with a door or window standing on it hangs its
  label beside the field; the 6-label cap counts labels slid onto the screen; labels keep clear of the HUD-scaled
  top and bottom bands. The canvas reads the same reduced-motion setting as the CSS (`<html data-motion>`).

## D11. Plates are pressed by any ball on them (owner request 2026-11-02; supersedes D2's resting-only plate rule)
The owner asked why a plate only goes down once the ball has stopped (just before the turn passes) instead of as the
ball passes over it. The resting-only rule was chosen to stop doors flickering through bounce hops; its cost is that
a plate reacts late and a ball rolling over a button does nothing, which reads as lag. New rule (`switchPresser`):
- A plate is PRESSED by any non-sunk ball whose centre x is over it and whose ground is the plate's own surface (a
  terrain piece, or the deck rect for a deck plate), rolling, bouncing or resting. It goes down on CONTACT (bottom
  within `SWITCH_CONTACT_TOLERANCE`).
- Once down it STAYS down while a ball over it is at most `PLATE_HOLD_HEIGHT_PX` (72) above it, so a landing's bounce
  hops (limits in the next point) and stall taps keep it down (measured: a straight-up tap holds every plate up to
  power 46, a 69.6 px rise; power 47 rises 72.7 px and lifts it); it comes UP the tick no ball is on it. No latching:
  holding a door open for a partner still means staying on the plate.
- The hold height was raised from 56 to 72 (2026-11-02) after a back-smash onto L5's DOOR plate (155° / power 100
  from x 1100, off the wall's cap; an 803 px/s landing) hopped 62.1 px, letting the plate up mid-bounce and shutting
  the door for 34 ticks. A first hop rises about (0.35 v)^2 / 2g for an impact of v px/s: 56 covered landings up to
  about 750 px/s, 72 covers about 850. At 72, tracking every plate with `switchPresser` each tick, the solver's
  `loops` flights (both colours, plates up and held) plus shots from the decks, 320,164 flights on the 12 holes, show
  0 hop flickers (4 at 56, all from that L5 shot); the hardest landings are L12 FIRE 811 px/s, L5 DOOR 803 and L6
  FREE 767 (every other plate 655 or less), the highest first hops L5 DOOR 62.1 px, L12 FIRE 57.6 and L6 FREE 56.7
  (every other plate 43.0 or less). Fine lob grids from all ground 200 px or more above a plate (every 4 px) find
  landings up to 905 px/s (the fastest come down at a plate's end, where the dish's ramp turns them sideways) and
  first hops up to 68.9 px (L12 FIRE); from the top of L6's backboard, where a ball can come to rest (rarely: 266 of
  12,050 near-vertical full-power shots from the perch's left end), up to 71.4 px onto FREE, the thinnest margin.
  Not reachable in play: a ball resting on top of L11's blue field (y 200, solid for red) would land on FIRE at about
  890 px/s with a first hop of up to 81.1 px and let FIRE up mid-hop, but red can never get there. The field blocks
  red from the FIRE ledge (the only spot that perch is reached from), and red's highest centre over that column is
  y 273 against the 188 it would need (`wall-top-clear`); blue passes through its own field, so it cannot stand on
  it. A future hole with a plate below ground more than about 230 px higher should re-run this scan (hops above
  72 px need impacts above about 850 px/s).
- A ball that ROCKS sideways in a plate's dish leaves the plate's x-range and lets it up: 77 % of plate landings
  press their plate 2-4 times before settling, and the door follows. That is the honest physics of the rule and is
  kept in the sim: holding the press sideways over the dish ramps would let Two Doors' ball hold its own door open
  up the ramp that ends at the door face, and a release delay long enough to cover rocking (p90 48 ticks) is longer
  than the 6-10 ticks a passing ball needs to reach its door. Gameplay is unaffected: hand-offs and the WAITING
  rule only ever look at settled balls.
- Presentation (amends VISUAL.md §4/§13, AUDIO.md and UX.md §9.3; `src/view/plates.ts` classifies every press for
  view and audio alike): the plate cap, lamp and the way it drives react on contact (a fresh press also gets ink
  sparks); the words `<PLATE> HELD`, DOOR/BRIDGE OPEN and SHUT/GONE, SNAP!/FREE!, the confirm chime and the door
  and bridge slides come only for a LASTING change (a ball comes to rest on the plate, or the cup holds it); a
  newer callout about the same door or ball replaces the old one. The HOLDS chip and the CAUGHT/LOADED chip read
  only resting balls (what the WAITING rule decides). The holder tip may name deck plates, since a stall tap on a
  deck now keeps the bridge up. Copy: 'Any ball on it presses it. Stay on it to keep it down.'
- Consequences accepted with it: a ball rolling across a plate opens its door or bridge while it passes, never long
  enough to let itself through: the plate comes up the tick the ball leaves it and what it drives changes the next
  tick, by when the ball's leading edge is at most `(MAX_BALL_SPEED + GRAVITY * DT) * DT + BALL_RADIUS` = 30.5 px past
  the plate, and every plate ends farther than that from each door, window, bridge or breech it drives (tightest:
  L4's B 32 px from the bridge, the L9 and L12 trap seats 40 px from their doors, then 50 px; `levels.test.ts`); a
  loaded ball fires the moment any ball touches a FIRE plate, including on L10 where A, B and the DECK both fire the
  cannon and hold the bridge the fired ball needs about 126 ticks later: a firm flat shot that skims across A's (or
  B's) bowl and rolls off fires the LOADED partner and lets the planks vanish before it lands, so it falls (+1, back
  to its tee). Review 2026-11-02: 0 of the 2,579 partner-firing first shots from the tee flat (the spring ride and
  every bowl landing end on A), 47-52 of 2,789-4,003 from spire-top spots, all at power 72+ within 12 degrees of flat
  (1-3 of 105-148 on the human grid); no softlock. Kept rather than special-casing cannons, since firing on a touch
  is what the owner asked for; the L10 copy now says the firing ball stays on A until its partner lands. A release
  plate frees a caught ball only while a ball
  is on it (a rescue must still stay on FREE/TOP to hold at the hand-off); World 1 plays differently (doors react
  sooner, a holder's stall tap keeps the door open), so its goldens and the D10.3 World 1 equivalence are
  re-baselined on purpose.
- Decks span their bridge lip to lip (L4 520-1240, L10 860-1580; D2's 24 px inset is gone). With the inset, a lone
  deck ball rolling for a lip left the plate 22-24 px short of it and the planks vanished under it: 120 of 1,120
  lone-deck rolls fell into the chasm, a gotcha nobody could read. Lip to lip, 0 of 1,200 fall; a ball resting AT a
  lip stands on the lip's terrain, so it still never holds the bridge (0 of 48 lip rests press DECK). The copy now
  says to roll off the deck; a lob that rises more than `PLATE_HOLD_HEIGHT_PX` lifts off it and drops the planks.
- Re-verification (2026-11-02, every solver pass on all 12 holes passes, at a hold height of 56 and again at 72 with
  the same minimums, pars and goldens): Crossfire's solver minimum fell 6 -> 5
  (red waits LOADED and blue's lob only has to touch FIRE), so under D10.13 its par falls 8 -> 7 and World 3's course
  par 30 -> 29; its design line still takes 8, one over par. Plate & Bridge's searches now report 6 because blue's
  deck rest moved (the earlier 5-stroke line still replays), par 7 unchanged. Every golden line keeps its shots and
  strokes; only its final tick moves (2-3 ticks sooner, L10 -19 and L12 -145 where a LOADED ball now fires on the
  partner's first touch).
- Copy says "on" a plate rather than "resting on" where the difference matters (cannons fire on touch; holding still
  means staying on the plate).
