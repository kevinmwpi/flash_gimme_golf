# Flash Golf redesign — lead brief (decisions already made; do not re-litigate)

Project: C:\Users\KevnP\Downloads\flash_golf\flash_gimme_golf (TypeScript + Vite + Canvas 2D + React shell + Node `ws` server).
Read CLAUDE.md there first. Its identity, constraints (§3), cut list (§4) and art direction (§9) are binding.
The owner has asked for the existing game to be **redesigned and rebuilt into a polished version**. We are polishing
the game that exists (4 levels, solo / local 2P / online 2P), not expanding its scope. Nothing on the §4 cut list.

## What the current build looks like (screenshots at scratchpad/pw/base-*.png)

- Lobby is a generic dark card ("Create online room / Join / Play locally"). Then a SECOND canvas-drawn start screen
  ("press 1-4"). Two start screens.
- Gameplay: near-black navy background with a faint grid; brown terrain slab with a thin green line; stick-figure
  golfers; mechanics are unlabeled pastel pills (pink = spring, tan = sand, orange = bumper) — the label text is drawn
  dark-on-dark and is invisible. Nothing reads as a bright Flash-era golf game.
- HUD is drawn on the canvas: a 400px info panel top-left, scoreboard top-right, and a bottom controls panel that
  COVERS the playfield (golfers stand behind it).
- In follow camera the terrain sits at the very bottom and ~500px above it is empty darkness.
- Aim preview dots pass through the ground (preview ignores collisions and uses a different dt than the sim).
- The 1s "golfer walks to the ball" handoff happens every single turn.
- Scoring is competitive ("Winner" badge, lowest strokes wins) although the game's identity is co-op. No par exists.

## Locked decisions

1. **Stack** stays TypeScript + Vite + Canvas 2D + React (React only for menus/HUD/overlays). No engine, no WebGL.
2. **Fixed logical resolution 1280×720**, letterboxed inside the window (this is the intent of the open PR #14).
   All world/HUD math happens in that space; the canvas is scaled by DPR. Follow camera scrolls horizontally through
   levels wider than 1280; overview fits the whole level.
3. **Deterministic sim, cleanly separated from the view.** `src/sim/` is pure (no DOM, no Date, no Math.random):
   fixed 60 Hz `stepSim(state, commands) -> { state, events }`. `SimState` holds ONLY what the rules need:
   phase, level id, players (strokes), balls (pos/vel/asleep/sunk), switch pressed flags, active player, current aim
   (angle, power), short turn delay timer, tick, rng, campaign scores. Camera, particles, trails, screen shake,
   golfer walk animation, toasts etc. are **view state** in `src/view/`, driven by `SimEvent`s
   (ballHit, bounce{strength,surface}, enterSand, spring, bumper, fan, hazardBlock, switchOn/Off, bridgeToggle,
   fellOffWorld, nearCup, gimme, sink, turnStart, levelComplete, campaignComplete …).
4. **Command-based input, absolute aim.** Clients (keyboard / pointer / gamepad) each produce
   `setAim{angle,power}` and `shoot` commands plus meta commands (`restartLevel`, `continue`, `start`). The sim never
   integrates held keys; keyboard aiming is integrated client-side, pointer drag computes aim directly. Online sends
   the same commands. The server validates ranges and turn ownership. This is what makes touch, gamepad and
   netcode clean.
5. **Co-op scoring.** Every level has a **par**. The team's combined strokes vs par is the primary score; medals
   (gold = under par, silver = par, bronze = par+2 or better, else none). Per-player strokes are shown secondary.
   No "winner". Campaign results = total vs course par with per-level medals.
6. **Players: 1 or 2 only.** Solo = one player controls BOTH balls, alternating (same levels, same puzzles).
   Local 2P = same keyboard/mouse, alternating. Online 2P = each browser owns one ball. Remove the 3/4-player paths.
7. **Golfer characters stay** (they make co-op visible) but their walk-to-ball is view-only animation (~0.35 s);
   the sim only has a short deterministic `turnDelay` (~0.45 s) after a ball settles before the next player may
   shoot. A turn banner ("P2's turn" / "Your turn") covers the pacing.
8. **Art direction: bright, saturated, chunky late-Flash cartoon.** Daytime sky gradient, simple clouds, layered
   background hills, flat-shaded grass/dirt with 3–4 px dark outlines, bold rounded display font, big readable
   mechanic silhouettes WITH legible on-object labels/icons. Players are red (#ff5d73) and blue (#50b7ff) with
   matching caps/shirts and balls. Not a dark-mode UI. "Scrappy" means charming and consistent, not sloppy.
9. **Mechanic readability** is a hard requirement: a first-time player must be able to tell a spring, sand,
   bumper, fan, colour gate (hazard), pressure switch and bridge/gate apart and guess what they do.
10. **Controls:** keyboard (arrows/WASD aim+power, Space shoot), **pointer drag-to-aim** (press on/near the ball,
    pull back like a slingshot: drag direction opposite to the shot, drag length = power, release = shoot, drag back
    over the ball to cancel), and gamepad (stick aim, trigger/stick power, A shoot). Hints adapt to the last-used
    device. Must be fully playable with keyboard only AND with touch only.
11. **Audio:** Web Audio API synthesized SFX (no asset files) for every meaningful event + a mute toggle persisted in
    localStorage. Music is optional and must be gentle and short-looped at low volume; SFX-only is acceptable.
12. **Content:** exactly **4 levels = World 1 "Teach"**, each introducing ONE new idea, in order, all verified
    solvable co-op and NOT trivially bypassable (e.g. a 220 px gap that can be lobbed makes a bridge pointless;
    a "hold the switch" puzzle where the holder can never cross is a soft-lock). Pressure switches are HELD (a
    resting ball keeps them pressed); design with two switches / two routes so both balls can cross. Available
    mechanics: sand, spring, bumper, fan, colour gate (only the matching player's ball passes), pressure switch,
    bridge (appears while pressed), blocker gate (disappears while pressed). Every level needs par, a hint, an
    intended "aha", and a watch-out failure mode. Balls do not collide with each other.
13. **"Gimme" rule** (the repo is flash_gimme_golf): when a ball comes to rest within a small radius of the cup
    on the green, it is conceded — +1 stroke, auto-sink animation, "GIMME!" callout. Tunable radius.
14. **Flow:** Title → Solo / Local 2P / Online (create or join by code / invite URL) → (online lobby) →
    level intro card (name, par, hint, who goes first) → play (HUD: level, par, team strokes, player chips with
    turn highlight, mute, pause) → level results (team strokes vs par, medal, per-player) → next → campaign results
    → play again / title. Pause (Esc): resume, restart level, quit to title. Title shows a level select with best
    results from localStorage. A one-time onboarding hint on level 1 explains drag/keys.
15. **Netcode:** server-authoritative; server broadcasts COMPACT snapshots (dynamic fields only) at 20–30 Hz;
    clients interpolate ball positions between snapshots; the aiming player's live aim is shared so the partner
    sees the arc; message shapes validated; rooms destroyed when empty or idle; disconnects surfaced clearly.
    Floating-point results differ between JS engines, so clients never run the authoritative sim online.
16. **Keep** the `?state=` share link, but encode the compact SimState (level id + dynamic fields), not geometry.
17. **Tooling:** `npm run typecheck` covering server/ too, vitest suites for sim determinism, turn logic,
    switches, serialization round-trip, level validity; CI runs typecheck + test + build.
18. **Docs:** README rewritten for players + devs; CLAUDE.md gets only a status-note update (the plan is the
    owner's and stays); short ARCHITECTURE.md.

## Target file layout (names are contracts other agents will code against)

```
src/
  main.tsx  App.tsx
  sim/            pure & deterministic — no DOM, no Date, no Math.random
    types.ts      SimState, Level*, PlayerCommand, SimEvent, constants
    sim.ts        createSim(config), stepSim(state, commands) -> {state, events}
    physics.ts    ball integration + collisions
    terrain.ts    geometry helpers
    rng.ts
    serialize.ts  compact encode/decode + URL helpers
    levels/       one file per level + index.ts registry (id, par, world, hint, mechanicsIntroduced)
    __tests__/
  view/           client-only presentation
    render/       canvas drawing (world, entities, mechanics, effects, aim)
    view.ts       ViewState (camera, particles, trails, shake, golfer anim) fed by SimEvents
    audio.ts      Web Audio SFX (+ optional music), mute persistence
    input/        keyboard.ts pointer.ts gamepad.ts index.ts -> PlayerCommand stream + hint device
    GameCanvas.tsx loop glue (input -> sim -> events -> view/audio -> render)
  ui/             React: Title, Lobby, Hud, Pause, LevelIntro, LevelResults, CampaignResults, Settings
  net/            protocol.ts, GameClient.ts
server/           index.ts rooms.ts (+ tsconfig.server.json)
```

## Baseline solver facts (scratchpad/tools/current-levels.json) — why the levels must be redesigned

With the current physics (shot speed = power x 8.8 px/s, gravity 620) the max range at 45 degrees is about 1,249 px, so on
1,680-2,100 px wide levels EVERY current level is a 2-stroke hole and EVERY level is solvable SOLO by either player:
Tutorial Hills 2+2, Switch Bridge 2+2 (the 220 px gap is simply lobbed; the bridge and switch are never needed),
Hazard Cavern 2+2 (hazards, sand, spring, gate all skipped), Ricochet Heights 2+2 (the plateau is reached directly;
the bumper is optional). There is no co-op in the current content.

Therefore **shot range is a design knob**: the new constant SHOT_SPEED_PER_POWER should be LOWER than 8.8 — recommended
6.5-7.0 (max range about 700-800 px, max height about 350-400 px) so World 1 holes take 3-5 shots per ball and puzzles
cannot be lobbed over. Level proposals must state the shot speed they were verified with (solver flag --shotSpeed) and
the final architecture must use the same value. Wind in World 1 is 0. Levels may also use ceilings/overhangs (terrain
pieces whose surface is above the fairway) to block lobs where that reads clearly.

Overview renders of the current four levels (view with Read): C:\Users\KevnP\AppData\Local\Temp\claude\C--Users-KevnP\9008f5d3-9b42-45ce-82f6-49cf5037798e\scratchpad\tools\current-svg\level-1.png … level-4.png. Note that Hazard Cavern's "gate" is a flat bridge-kind rect lying on the ground beside the cup, and the colour hazards are 88-100 px pillars that any lob clears.

## Additional locked implications from the verified audit (scratchpad/design/AUDIT_FINDINGS.json — read it)

19. **Every ball is simulated every tick** (not just the active one). A parked ball whose bridge disappears must fall;
    a parked ball on a slope must settle. Only the active ball may receive a shot. Switch state is evaluated every tick
    from resting balls. Turn advancement waits until ALL balls are at rest (or sunk).
20. **Surface props are flush zones, not raised boxes.** Sand, spring and bumper modify the ground under the ball
    (a sand zone slows rolling and kills bounce; a spring pad launches a ball that touches it with a fixed upward
    impulse; a bumper pad adds a fixed outward impulse) and are drawn embedded in the surface. Bridges are extra floor
    segments that exist only while active. Blocker gates and colour gates are walls (a colour gate passes the matching
    player's ball and bounces the other). Fans are volumes applying a constant upward force. Nothing uses restitution
    > 1; springs/bumpers set velocity by impulse so bounces cannot grow without bound. Ball speed is clamped to a
    maximum that cannot tunnel at 1/60 (or the step is sub-stepped) so no ball passes through terrain or a bridge.
21. **Terrain is solid**: pieces collide on their top surface AND their side faces; a ball cannot enter dirt. Falling
    below the level respawns the ball at its last resting position with a +1 stroke penalty and an on-screen callout
    (not a silent teleport to the tee).
22. **Physics tuning pass**: friction defined in one place (no hidden 6 % tangential scrub per contact), balls do not
    freeze on steep slopes (rest only when slope is gentle and speed is low, otherwise keep rolling), the aim preview
    runs the REAL step function on a scratch ball (including terrain, props, wind) so the dotted arc lands where the
    ball lands, and the sink test cannot be skipped by rolling over the cup fast.
23. **Two-switch (or equivalent) patterns** so the switch-holder can also cross; held switches release the tick the
    presser leaves. Solo mode (one player, both balls) must be able to use every switch puzzle.
24. **Server**: tick with a wall-clock accumulator (setInterval drifts and runs at ~33 Hz on Windows), validate every
    message shape and range, cap payload size and rooms, origin allow-list, idle TTL and heartbeat, one room per socket,
    bump the `ws` dependency to the current 8.x release (8.19.0 has open advisories), Node 22 base image.
25. **No competitive framing anywhere** ("opponent", "Scoreboard", "Winner", "lowest total strokes wins" all go).
26. The HUD is React/DOM, never canvas text; the online status bar must not cover the HUD; invite links must unfurl
    (title, description, Open Graph image placeholder, favicon, theme-color).
27. Reset (R) is a pause-menu "Restart level" action with confirmation, host-only online and announced to the guest.
28. **Online is already deployed** (verified 2026-10-02): the Vercel build at https://flash-golf.vercel.app bundles
    VITE_WS_URL = wss://flash-gimme-golf.fly.dev/ws and that Fly app answers (cold start ~3-4 s). The rebuilt server
    must stay drop-in compatible with the existing Dockerfile/fly.toml deployment: HTTP health on /, WebSocket on
    /ws, PORT from env (8080 on Fly), single Node process, no database. README/CLAUDE.md status notes must be
    corrected to say online is live.
