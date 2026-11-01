# Architecture

The one-page map of the rebuilt code. The binding contracts are `design/FINAL/architecture/ARCH.md`
(module APIs, loop, test plan) and `design/FINAL/BUILD_DECISIONS.md` (the lead's reconciliation,
which wins over every other design document); this file condenses them and tracks the code as it
exists. Numbers quoted here are the exported constants in `src/sim/types.ts` and
`src/net/protocol.ts`; when they disagree with this page, the code wins and this page is wrong.

## Layers and the dependency rule

```
src/sim/              pure, deterministic rules: 60 Hz stepSim(state, commands) -> { state, events }
  types.ts            FROZEN data contract + every tuning constant (quantize2/4/1, medalFor, LIMITS of the sim)
  sim.ts              createSim, stepSim, runReplay, allowedCommands, seatOf/canControl/isHost
  physics.ts          launchVelocity, stepBall (one ball, one tick), evaluateSwitches, predictShot
  terrain.ts          geometry: groundAt, solidColliders, pieceEdges, isRectActive, placeOnSurface
  rng.ts              mulberry32 as pure functions over a uint32 (SimState.rng is a number)
  serialize.ts        compact SimSnapshot encode/decode with range checks; ?state= share links (base64url)
  devices.ts          trap and cannon queries: isTrapArmed, isCannonLit, trapHolding, cannonHolding,
                      waitingOf, releaseLabel (the ONLY place a device's activeWhen polarity is read)
  levels/             authoring.ts (compileLevel, validateLevel), index.ts registry (LEVELS, WORLDS,
                      WORLD_IDS, campaignFrom, nextWorld, worldTitle), w1-01 .. w3-12
src/net/
  protocol.ts         FROZEN wire contract (PROTOCOL_VERSION, parsers that rebuild objects, LIMITS)
  GameClient.ts       browser socket: snapshot ring, interpolation, aim coalescing, reconnect token
  wsUrl.ts            VITE_WS_URL or same-origin /ws on localhost; null => online hidden
src/view/             client-only presentation; may use Math.random/performance; never writes SimState
  view.ts             ViewState: camera, particles, trails, shake, golfer anims, callouts, aim preview
  render/             Canvas 2D in a fixed 1280x720 logical space (world, mechanics, devices: trap jaws and
                      cannons with their predictLaunch arc, parts: shared hardware, surface: terrain
                      queries, entities, aim, text)
  input/              keyboard, pointer (mouse + touch slingshot), gamepad -> PlayerCommand + UiAction
  audio.ts            Web Audio synthesized SFX/music; owns flashgolf.audio.* persistence
  GameCanvas.tsx      the loop (below), canvas letterboxing by DPR, HUD CSS variables at 60 Hz
src/ui/               React: Title, Lobby, Hud, Pause, LevelIntro/Results, CampaignResults, Settings,
                      Callouts, OnboardingHint; copy.ts, storage.ts (fg.v1.*), url.ts, eventBus.ts, holderTip.ts (when the stall-tap tip shows),
                      worlds.ts (world picker and Continue-to-next-world helpers)
src/App.tsx           screen state machine title -> lobby -> game; builds local/online sessions
server/               index.ts (http + ws glue, origin allow-list, tick driver) and rooms.ts (RoomManager)
scripts/solver.ts     the solver CLI; scripts/solver/ holds the game driver, the co-op and solo searches, the
                      sweeps and OPT_OUTS, scripted lines and goldens, and the launchers/loops/traps passes
```

Imports may only point down this list (ARCH.md §0), enforced by `eslint.config.js`
(`no-restricted-imports` per directory) and by `src/sim/__tests__/sim-purity.test.ts`:

| from | may import |
|---|---|
| `sim/*` | `sim/*` only; no packages, no DOM, no `Date`, no `Math.random`, no `import.meta` |
| `sim/levels/*` | `sim/types`, `sim/terrain`, `levels/authoring`, sibling level files |
| `net/protocol.ts` | `sim/types` only |
| `net/GameClient.ts` | `net/protocol`, `net/wsUrl`, `sim/types`, `sim/serialize` |
| `view/*` | `sim/*` (read-only), `view/*`; `net` types only |
| `view/input/*` | `sim/types`, `sim/sim`, `view/view`, siblings |
| `ui/*` | `sim/types`, `sim/levels/index` (never a level-id literal), `sim/devices`, `view/audio`, `GameClient` types, `ui/*` |
| `server/*` | `sim/*`, `net/protocol`; never `view`/`ui`; never decodes a snapshot |

## State and commands

`SimState` holds only what the rules need: phase (`intro | aiming | flying | levelResults |
campaignResults`), level id, two players (strokes, aim), two balls (pos, vel, asleep, sunk, lastRest),
switch pressed flags, active player, `turnDelayTicks`, `flightTicks` (consecutive ticks in `flying`,
for the 30 s flight watchdog), tick, rng, campaign results. Everything else (camera, particles,
golfer walk, toasts) is view state driven by `SimEvent`s. CAUGHT and LOADED are never stored: they
are derived from position, the rest flag and the switches (`devices.ts`).

Input is command-based with absolute aim: `setAim{angle,power}`, `shoot`, `continue`, `restartLevel`,
each stamped with a `playerId`. `allowedCommands(state, seat)` is the single phase x role table;
the host is seat 0 in every mode and in solo seat 0 owns both slots. Every ball is simulated every
tick; switches are re-evaluated from resting balls every tick; a turn advances only when all balls are
settled and no switch changed that tick. Who tees off first is `level.firstPlayer`.

**Devices and the WAITING rule (BUILD_DECISIONS D10.4-D10.6).** A trap is a rect ARMED while none of
its release plates is held; a ball that comes to rest inside an armed trap is caught. A cannon breech
is a pad LIT while any FIRE plate is held: a lit breech fires like a spring (`cannonFire`), a cold one
is ground and a ball resting there is loaded, firing the tick its cannon lights. At every hand-off the
next shooter is the first of [the other ball, the same ball] that is neither sunk nor waiting; each
passed-over waiting ball gets a `turnSkipped` before the `turnStart`. If nobody can shoot, the scoped
reset sends the waiting ball that moved last to its safe spot (`lastRest`, recorded only while the
ball is free) with +1 (`trapReturn`), then the other, then (a guard the solver proves never runs) to
its tee; a reset that changes a switch defers the hand-off to the next settled tick, so a switch change
and a `turnStart` never share a tick. A flight still running after `FLIGHT_WATCHDOG_TICKS` (30 s)
returns every moving ball to its safe spot with no stroke (`flightTimeout`).

## The loop

**Local (solo / two players, `GameCanvas.tsx`).** One `requestAnimationFrame` loop with a fixed-step
accumulator (`DT = 1/60`, frame delta clamped to 0.25 s, reset on `visibilitychange`). One
`input.poll` per frame; its commands and the React overlays' commands go into a **persistent pending
queue** (a `setAim` replaces the last pending `setAim` of the same slot in place, so order against a
`shoot` is preserved). The first step of a frame drains the queue; then per step:
`stepSim -> view.applySimEvents -> audio.handleEvents -> onEvents (React event bus)`. After stepping:
`updateView(prev, next, alpha)` interpolates ball positions, the aim preview is `predictShot` on the
real physics (memoised on aim, switch mask and ball positions), `renderFrame` draws, the HUD power
meter is written as CSS custom properties on the HUD element every frame, and a throttled (10 Hz)
`FrameSummary` feeds React. Pause freezes the accumulator but keeps rendering and queuing.

**Online.** The same loop body with the steps replaced by `client.interpolated(now)`: a ring of the
last `SNAPSHOT_RING_SIZE` (8) decoded snapshots rendered `CLIENT_RENDER_DELAY_MS` (100) behind the
server clock, extrapolated for at most `MAX_EXTRAPOLATION_MS` (150) on a stall, and **snapped**
(no interpolation) across any discontinuity: a gap above `SNAPSHOT_GAP_DISCONTINUITY_MS`, an
`immediate` snapshot, or an event in `IMMEDIATE_SNAPSHOT_EVENTS`. Events are buffered per snapshot
and released by `drainEvents(renderTime)`, so sound and particles never lead the picture. Local
`setAim` echoes immediately into the preview and power meter; the partner sees the arc from the
snapshot's aim at 55 % alpha.

## Determinism rules (`src/sim`)

1. Imports only from `src/sim`; no `Math.random`, `Date`, `performance`, DOM globals, timers or
   `import.meta` (grep-tested); no `Math.hypot`, `Math.pow`, `**` or `toFixed`.
2. `stepSim`/`stepBall` depend only on their arguments; the only module-level state is `WeakMap`
   caches of geometry derived from immutable level objects.
3. Arithmetic is `+ - * /`, `Math.sqrt`, `round/floor/ceil/abs/min/max`; `sin/cos` only in
   `launchVelocity`. Numbers come from `types.ts`.
4. Iteration is array order (`level.switches`, `level.rects`, `balls`); no `sort` without a
   comparator, no `Object.keys` driving rules.
5. Rest positions and aims are quantised (`quantize2`, `quantize4`, `quantize1`) so a settled state
   round-trips losslessly through `encodeSnapshot/decodeSnapshot`.
6. Every number written into `SimState` passes `Number.isFinite` every tick (throws otherwise).
7. The seed comes from `SimConfig`; cosmetics never touch the rng.
8. Online clients never run `stepSim`; the server is the only sim and never decodes a snapshot.
   `runReplay` plus the server equivalence test prove the two paths agree. Node is pinned (`.nvmrc`)
   and the replay golden lives in its own test so an engine change is recognisable.

## Netcode summary (`server/rooms.ts`, `src/net/GameClient.ts`)

- **Handshake.** The first frame must be `hello{protocol: PROTOCOL_VERSION}`; anything else counts
  toward `badMessagesBeforeClose` (5) and a version mismatch is refused. A socket silent for
  `HELLO_TIMEOUT_MS` (5 s) is closed, and an IP holds at most `MAX_SOCKETS_PER_IP` (16) open sockets
  (`SERVER_FULL`, close 1013). `PROTOCOL_VERSION` is 4. Vercel publishes the client as soon as
  `main` moves and Fly redeploys the server after CI passes, so a protocol bump leaves a few minutes
  in which online play answers `VERSION_MISMATCH`.
- **Rooms.** One room per socket; 5-letter codes from an alphabet without `0/O/1/I`; caps on rooms
  and rooms per IP (IP from `fly-client-ip`, else the first `X-Forwarded-For` hop). The host picks
  the starting hole in the lobby (`setLevel`) and starts; the campaign is `campaignFrom(levelId)`,
  which runs to the end of that hole's world. On the world results card the host's `playAgain` may
  name the next world's first hole (`levelId`) to continue; without one it replays the same campaign.
- **Tick.** Wall-clock accumulator in integer units of 1/60 ms, capped at `MAX_CATCHUP_MS`, driven
  every 8 ms by `index.ts`; a paused room (peer disconnected) does not advance and resumes with no
  catch-up burst.
- **Messages.** `parseClientMessage` rebuilds every object and checks ranges; `playerId` is overwritten
  with the socket's slot; a token bucket (40/s, burst 60) rate-limits; a non-active slot's `setAim` is
  dropped silently, its `shoot` answered with `NOT_YOUR_TURN`; `restartLevel` is host-only; a late
  `continue` (Tee off / Next hole race) is left to the sim's silent `wrongPhase`. One ordered pending
  queue per room with in-place `setAim` replacement, like the local loop; while the room is paused
  commands are refused (`WRONG_PHASE`) and the client sends none, so nothing fires on resume.
- **Snapshots.** Compact positional tuples (`SimSnapshot`, dynamic fields only), broadcast every
  `SNAPSHOT_EVERY_TICKS` (3, i.e. 20 Hz) while anything changed, once per second when idle, and
  immediately on `IMMEDIATE_SNAPSHOT_EVENTS`. Each slot has an event cursor so a skipped socket
  (backlog above `MAX_SOCKET_BACKLOG_BYTES`) still receives every event later.
- **Disconnects.** A dropped player's slot is held for `reconnectGraceMs` (60 s) with a token the
  client keeps in `sessionStorage`; the peer sees a pause, and a lone WAITING host's blip keeps the
  room (and the invite link) alive for the same window. A rejoin refused with `ROOM_NOT_FOUND` /
  `SERVER_FULL` / `RATE_LIMITED` is final on the client (`error{recoverable:false}` => the LOST
  overlay). Both players dropping together (one Wi-Fi blip, one heartbeat sweep) keeps the started room
  paused with a grace per slot; it closes with `peerTimeout` when the first grace lapses. Liveness runs
  both ways: the client pings every 2 s, shows the net pill `--bad` after 3 s without a reply and tears a
  half-open socket down into the reconnect loop after three missed pings; the server ws-pings a socket
  silent for 10 s and terminates it 5 s later if nothing answers, besides the `heartbeatMs` (30 s)
  sweep. Rooms are destroyed after `roomIdleMs` idle, when a grace expires, on a deliberate leave, or
  on shutdown (`roomClosed` with a reason to everyone). The client replays buffered events
  only within `EVENT_REPLAY_WINDOW_MS` of render time: a tab that was hidden re-syncs from the next
  snapshot instead of firing every missed sound and toast at once.
- **No auto-advance.** Intro and results cards wait for a `continue` from either seat (first wins),
  so neither player can stall the other and nobody loses a hint mid-read (BUILD_DECISIONS D6).
- **Process.** `server/index.ts`: HTTP `200 ok` on `/`, JSON stats on `/healthz` (both with CORS for
  allowed origins, so the title screen's health pill works cross-origin), `/ws` upgrade behind the
  `ALLOWED_ORIGINS` glob list, `PORT` from env, SIGTERM shutdown, exit 1 on a failed bind. Bundled by
  esbuild into `dist-server/index.mjs` and run on `node:22-alpine` (`Dockerfile`, `fly.toml`).

## Serialization

Transport is JSON. `SimSnapshot` (`SNAPSHOT_VERSION` 2, `flightTicks` appended last) is a versioned positional tuple: positions and velocities
`quantize2`, angle `quantize4`, power `quantize1`, flags and switch state bit-packed in
`level.switches` order, campaign entries' par and medal recomputed from the level registry.
`decodeSnapshot` validates every element and range and throws `SerializeError`; the client turns that
into a terminal `BAD_SNAPSHOT` status instead of crashing the loop. The `?state=` share link is
`base64url(JSON ShareLinkPayload)` (config + snapshot, around 350 characters); legacy links fail
version validation and show a "from an older version" card.

## Test map (vitest; `npm test` runs everything except the solver suite)

| file | proves |
|---|---|
| `src/sim/__tests__/sim-purity.test.ts` | the grep rules above; `types.ts` exports every constant; no level-id literal outside `src/sim/levels` |
| `src/sim/__tests__/contract.test.ts` | every contracted export exists with the right type (fails the moment a contract is renamed) |
| `src/sim/__tests__/replay.test.ts` | `runReplay` is bit-identical across runs and across a split run; golden snapshot; ticks matter |
| `src/sim/__tests__/turns.test.ts` | the allowed-command table, seats in solo/local, turn delay 27 -> 26, level and campaign transitions |
| `src/sim/__tests__/switches.test.ts` | held plates, release timing, bridges appearing and vanishing under a parked ball, no wake loops, solo can hold and cross |
| `src/sim/__tests__/physics.test.ts` | no tunnelling at any speed, bounded energy on springs/bumpers, friction, slopes, colour gates, sand, `predictShot` parity with real shots |
| `src/sim/__tests__/cup.test.ts` | sink vs lip-out by speed, gimme radius inclusive, near-cup callout, swept detection |
| `src/sim/__tests__/serialize.test.ts` | round-trip idempotence, lossless settled states, size budget, every rejection path |
| `src/sim/__tests__/devices.test.ts` | traps catch only resting balls and free/re-catch with their plates (and the cup); cannons load cold and fire on entry or the tick they light; the WAITING rule, `turnSkipped`, scoped resets, the R5 deferral and the tee guard; safe spots; the flight watchdog; flush-footed doors; device validity rules; replay determinism and snapshot round trips of device scenarios |
| `src/sim/__tests__/levels.test.ts` | every registered hole (12) passes `validateLevel`; ids match filenames; worlds, orders, campaigns and course pars; introduced mechanics per world; labels, first player, plate distances, back bunkers, the overview rule, device tables; golden lines replay bit-exactly |
| `src/sim/__tests__/levels-solver-w{1,2,3}.test.ts` | (`npm run test:levels`, a CI matrix job per world) co-op solvable, par calibrated, not solo-bypassable, no aces, walls and gaps hold (with the explicit `OPT_OUTS`), scripted lines, stall taps, decks, launchers land, no flight loops, every trapped or loaded ball can be freed |
| `src/net/__tests__/protocol.test.ts` | parsers accept every documented shape, rebuild objects, reject every bad one |
| `src/net/__tests__/client.test.ts` | aim coalescing and flush order, ring/interpolation, discontinuity snaps, reconnect |
| `server/__tests__/rooms.test.ts` | the whole room lifecycle on fake sockets with an injected clock: handshake, caps, tick arithmetic, turn checks, cursors, grace, idle, stats back to zero |
| `server/__tests__/equivalence.test.ts` | the server path equals `runReplay` on the same command log (server == local) |
| `server/__tests__/devices.test.ts` | a device scenario (catch, reset, skips, free, load, partner-fired cannon) on the server equals `runReplay`, snapshots and events |
| `src/view/__tests__/{input-keyboard,input-pointer,loop}.test.ts` | adapter maths (drag 120 px => power 55), press-anywhere drags anchored at the ball, wrong-ball presses, the cancel gate, persistent pending queue, coalescing, continue-after-pause, `FrameSummary.waiting` |
| `src/view/__tests__/{view,audio}.test.ts` | snap flags on teleports, no interpolation of sunk balls, SFX debounce; every device event's sound, the skip cue, one music bed per world on white keys, the fan stop |
| `src/view/__tests__/{devices-view,stickers-levels}.test.ts` | jaws, barrels, lamps and arcs follow the switches; device callouts and their priority; the camera follows launched balls; golfers beside waiting balls; every must-label prop on holes 5-12 keeps its sticker under the cap at every follow position |
| `src/ui/__tests__/{copy,storage,worlds,callouts}.test.ts` | no competitive copy; `fg.v1.*` storage validates ids and survives blocked storage; world picker and continue helpers; skip banner lines |
| `src/ui/__tests__/holderTip.test.ts` | no holder tip on any golden line; a short crossing tips the holder; shared plate, deck, bridge planks, doorway middle, own colour field, unknown spots, waiting balls and device-only plates never tip |

## Tooling

`tsconfig.json` (app: strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, DOM lib,
`types: []`), `tsconfig.server.json` (ES2022 lib only, `types: ["node"]`, `server/` + `src/sim` +
`src/net/protocol.ts`), `tsconfig.test.json` (tests, `scripts/`, vitest globals). `npm run typecheck`
runs all three. `vite.config.ts` binds the dev server to localhost, proxies `/ws` to :3001 and holds
the vitest `include`. CI (`.github/workflows/ci.yml`) runs typecheck, lint (warnings fail), test, build,
`build:server` and `npm audit`, giving every `main` commit its own uncancelled run; `levels.yml` runs the
slow solver suite when `src/sim/**` or the solver changed; `fly-deploy.yml` deploys the server after CI
succeeds on `main` when a server-relevant file changed since the commit live on Fly, and keeps Fly at one
machine (rooms are process-local). Dependabot bumps the exact-pinned versions weekly, never across a
Node major.
