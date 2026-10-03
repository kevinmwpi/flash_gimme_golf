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
  draws a deck plate only while its rect is active. Used by L4's `deck` plate (inset 24 px from both lips).
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
  margin). Deck plate press requires the ball fully on the bridge by geometry (the 24 px inset does that).
- Labels: every switch and every switch-driven rect in the shipped levels carries a short `label` that matches the
  hint copy: L2 `DOOR` / `WINDOW`; L3 `DOOR 1` / `DOOR 2`; L4 `A` / `B` / `DECK` (bridge label `BRIDGE`). The renderer
  shows stickers as `<LABEL> · ON|OFF` (switch) and `<LABEL> · OPEN|SHUT` (door/window) / `BRIDGE · ON|OFF`; with no
  label it falls back to `SWITCH <letter>` by index. HUD chip status: `HOLDS DOOR`, `AIMING`, `WAITING`, `IN THE CUP`.
- Spring, bumper and fan are NOT used in World 1 but ARE implemented, rendered and unit-tested (SIM + VIEW).
- No `wait` command. The "stall tap" is taught by the L2 holder toast (UX copy); levels are verified without it.
- Pars: 6 / 7 / 9 / 8 as authored; the LEVELS re-verification stage may adjust by +-1 with evidence.

## D3. Contract requests accepted (owners must implement them)
- UX CD-1, CD-2, CD-3: already in ARCH (continue from either seat online; host restartLevel in levelResults; setLevel/lobbyState).
- UX CD-4: constants stay in types.ts with the UX values (D1). Audio owns its persistence (see D4).
- UX CD-5: NO tee >= 280 assertion. Instead the follow camera OVERSCANS: while the active player is aiming and the
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
  and toasts ("Blue teed off", "Red restarted the hole", "Blue is here!", "Red left", the L2 holder tip).

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
