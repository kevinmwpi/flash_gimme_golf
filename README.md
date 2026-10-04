# Flash Golf

A flash-style 2D **co-op** golf game for two, in your browser. Pull back from your ball like a
slingshot, let go, and solve switch, door, colour-gate and bridge puzzles *together* across
World 1 "Teach": four holes, about ten minutes. No install, no account.

- **Play now:** https://flash-golf.vercel.app
- **Online server:** `wss://flash-gimme-golf.fly.dev/ws` (Fly.io; the first room of the day wakes it
  in a few seconds)
- **Status:** the polished rebuild lives on branch `redesign/polished-v1` (this tree). `main` still
  serves the previous prototype until the rebuild is merged.

## The game

Every hole has a **par for the team**. Your combined strokes against it earn a medal: **gold** under
par, **silver** on par, **bronze** at par + 2 or better. There is no winner and no loser, only the
two of you against the course; per-player strokes are shown as a footnote.

- **Shots.** Aim and power are set before every stroke; the dotted arc is honest (it runs the real
  physics), so where the dots land is where the ball lands.
- **Gimme.** A ball that stops within a ball's width of the cup is conceded: +1 stroke and it hops in
  ("GIMME!"). The repo is named after this rule.
- **Out of bounds.** A ball that falls off the world comes back to where it last rested, +1 stroke.
- **Turns.** Red and blue alternate. After a ball settles there is a short hand-off before the next
  player may shoot; who tees off first is set per hole.
- **Mechanics, one new idea per hole:** sand (kills bounce and roll), **pressure plates** (held
  while a ball *rests* on them; leave and the door shuts or the bridge vanishes), **doors and
  windows** (open only while their plate is held), **colour gates** (only the matching player's ball
  passes; the other bounces off), and a **bridge** across a gap that exists only while a plate is
  held. A ball that has sunk keeps holding the switch its hole is wired to, so finishing first helps
  your partner instead of stranding them. Balls never collide with each other.

### Modes

| mode | who controls what |
|---|---|
| **Solo** | You play **both balls**, alternating red and blue. Same holes, same puzzles: hold a plate with one ball, cross with the other. |
| **2 players, one screen** | Red and blue take turns on the same keyboard, mouse, touchscreen or pads. |
| **Online with a friend** | Create a room and share the 5-letter code or the invite link (`?room=CODE`). Each browser owns one ball; the host is red, and who tees off first is set per hole (blue opens Colour Keys). The server runs the game; a dropped player has 60 s to rejoin the same seat. |

The title screen shows the four holes with your best team result on this device; pick any hole to
start the course from there. Local games can be shared mid-course with the pause menu's
**Copy share link** (`?state=...`), which encodes the compact game state.

### Controls

Keyboard only and touch only are both complete. Hints on screen follow whichever device you used last.

| action | keyboard | mouse / touch | gamepad |
|---|---|---|---|
| aim | ← → or A D (hold 0.6 s for a fast sweep) | press on or near **your** ball, pull back (slingshot: the shot goes the other way) | left stick (absolute) |
| power | ↑ ↓ or W S | drag length (full power at 240 px) | right trigger up, left trigger down, or right stick ↑↓ |
| shoot | Space or Enter | release the drag | A |
| cancel a shot | — | drag back into the ring around the ball, second finger, or right-click | — |
| camera (follow / overview) | C | camera button | X |
| pause | Esc | pause button | Start |
| mute | M | speaker button | Y |
| hints | H | tap the hole chip | — |

Stray taps never cost a stroke: a press away from your ball just shows where to grab.

## Develop

Requirements: Node 22 (`.nvmrc`; `engines` enforces `>=22.12 <23`, the runtime the server and CI
use) and npm. Everything also runs on Node 20.19+ with an `EBADENGINE` warning.

```sh
npm ci
npm run dev          # Vite on http://localhost:5173 (localhost only)
npm run dev:all      # Vite + the WebSocket server on :3001 (Vite proxies /ws to it, so online works locally)
npm run typecheck    # tsc for the app, the server (ES2022 lib, no DOM) and the tests
npm test             # vitest, fast suite (the level solver is excluded)
npm run lint         # ESLint incl. the layer dependency rule (ARCHITECTURE.md)
npm run build        # typecheck + vite build -> dist/
```

| script | what |
|---|---|
| `dev` / `dev:lan` | Vite dev server; `dev:lan` adds `--host` so a phone on the same network can open it (online mode on the phone needs the two env vars below, see *LAN testing*) |
| `server` | the game server via `tsx` (`PORT` 3001 by default) |
| `dev:all` | `dev` + `server` side by side |
| `build` / `preview` | production client build (runs `typecheck` first) / serve `dist/` locally |
| `build:server` / `start` | esbuild bundle of `server/index.ts` to `dist-server/index.mjs` / run it (what the Docker image does) |
| `typecheck` | `tsconfig.json` (app), `tsconfig.server.json`, `tsconfig.test.json` |
| `test` / `test:levels` | vitest without / only the slow solver suite (`src/sim/__tests__/levels-solver.test.ts`) |
| `solve -- <levelId>` | beam-search solver over the real sim; proves a hole is co-op solvable and not solo-bypassable |
| `lint` | ESLint flat config (`eslint.config.js`) |

### Environment variables

| variable | where | meaning |
|---|---|---|
| `VITE_WS_URL` | client, **build time** (Vercel project env) | WebSocket URL of the game server, e.g. `wss://flash-gimme-golf.fly.dev/ws`. Unset: on `localhost` the client uses the same-origin `/ws` dev proxy; anywhere else online mode is hidden with an inline note. |
| `ALLOWED_ORIGINS` | server | Comma-separated browser origins allowed to open a socket and to read `/healthz` cross-origin (CORS); `*` wildcards are allowed (`https://flash-golf-*.vercel.app` covers Vercel previews). Default: the production and preview Vercel origins plus `http://localhost:5173` / `http://127.0.0.1:5173`. Note that any Vercel account can claim a `flash-golf-*.vercel.app` name, so once previews no longer need the live server, set this on Fly to the exact production origin. |
| `PORT` | server | Listen port. `8080` on Fly (`fly.toml`), `3001` locally. |
| `VITE_APP_VERSION` | client, build time (optional) | Text of the title screen's version pill. Unset: `vite.config.ts` uses `package.json`'s version, suffixed with the short `VERCEL_GIT_COMMIT_SHA` on Vercel (`0.2.0+ab12cde`). |

**LAN testing.** A phone opening `http://<lan-ip>:5173` is not `localhost`, so online mode is hidden unless the
client knows the server URL and the server allows the phone's origin: run
`ALLOWED_ORIGINS=http://<lan-ip>:5173 npm run server` and `VITE_WS_URL=ws://<lan-ip>:3001/ws npm run dev:lan`.

The server has no database and no other configuration. It answers `GET /` with `200 ok` (Fly health
check), `GET /healthz` with JSON room stats (both carry `Access-Control-Allow-Origin` for an allowed
`Origin`, which the title screen's health pill relies on), and upgrades `/ws`.

### Deploy

**Client (Vercel).** The project auto-deploys from `main`; `vercel.json` sets the build command
(`npm run build`), the output directory (`dist`) and the SPA rewrite, which still serves
`/favicon.svg`, `/og.png` and `/manifest.webmanifest` as files so invite links unfurl. Set
`VITE_WS_URL` in the project's environment variables; it is baked into the bundle at build time.

**Server (Fly.io).** `fly.toml` (app `flash-gimme-golf`) builds `Dockerfile`: a multi-stage image
that bundles the server with esbuild and runs it as `node` on `node:22-alpine`. CI
(`.github/workflows/ci.yml`: `npm ci`, typecheck, lint, test, build, `build:server`,
`npm audit --omit=dev --audit-level=high`) runs on every push and PR; each `main` commit gets its own
run that a newer push never cancels. `levels.yml` runs the slow
level-solver suite (`npm run test:levels`, ~12 min) whenever `src/sim/`, `scripts/solver.ts` or the package
files change, and on demand (*Run workflow*). `fly-deploy.yml` deploys only
after CI succeeded on `main` **and** a server-relevant file changed (`server/`, `src/sim/`,
`src/net/protocol.ts`, package files, `Dockerfile`, `fly.toml`, the tsconfigs) since the commit that
is live on Fly (the last run whose `flyctl deploy` step succeeded), so a change is never lost when
GitHub replaces a queued run, and a commit older than the live one is never deployed. It needs the
`FLY_API_TOKEN` repository secret. The machine sleeps when idle (`min_machines_running = 0`) and
wakes on the first connection.

**Run exactly one machine.** Rooms live in one process's memory, so a second machine would answer
joins and reconnects for rooms it does not hold with `ROOM_NOT_FOUND`. Fly's first deploy creates
two machines; the workflow deploys with `--ha=false` and then runs `flyctl scale count 1 --yes`.
Manual deploy: `flyctl deploy --remote-only --ha=false` then `flyctl scale count 1`.
`[http_service.concurrency]` in `fly.toml` raises Fly's default 25-connection cap to 700 (above
`LIMITS.maxRooms` x 2), so a full server answers `SERVER_FULL` instead of the proxy queueing sockets.

**Protocol version.** `PROTOCOL_VERSION` in `src/net/protocol.ts` is checked in the first message of
every connection; a mismatch is refused with a clear error. Client and server **ship together**:
change the protocol, the sim rules or `src/sim/types.ts` in one commit so that the same push deploys
both. A client-only change (`src/view`, `src/ui`) never redeploys the server, by design.

### Project structure

```
index.html, public/        entry page, favicon, Open Graph image, web manifest (UI-owned)
src/
  main.tsx, App.tsx        React root; screen state machine title -> lobby -> game
  sim/                     pure, deterministic rules: 60 Hz stepSim(state, commands) -> { state, events }
    types.ts               the frozen data contract and every tuning constant
    sim.ts physics.ts terrain.ts rng.ts serialize.ts
    levels/                one file per hole (compileLevel) + registry (LEVELS, WORLD1_IDS, campaignFrom)
    __tests__/             determinism, turns, switches, physics, cup, serialization, level validity
  view/                    client-only presentation; never writes to the sim
    view.ts                ViewState (camera, particles, trails, shake, golfer anims) fed by SimEvents
    render/                Canvas 2D drawing in a fixed 1280x720 logical space
    input/                 keyboard, pointer (mouse + touch slingshot), gamepad -> PlayerCommand stream
    audio.ts               Web Audio synthesized SFX and music; owns mute/volume persistence
    GameCanvas.tsx         the fixed-step loop: input -> sim -> events -> view/audio -> render
  ui/                      React menus, HUD, overlays, copy, local storage, URL params
  net/                     protocol.ts (frozen wire contract) and GameClient.ts (socket, interpolation, reconnect)
server/                    Node ws server: RoomManager runs the only online sim and broadcasts compact snapshots
scripts/solver.ts          level solver (npm run solve)
design/                    the redesign package this rebuild is built from (see below)
```

`ARCHITECTURE.md` is the one-page map (layers, loop, determinism, netcode, tests);
`CONTRIBUTING.md` has the working rules and how to add a hole.

### The `design/` folder

The rebuild was specified before it was coded. `design/LEAD_BRIEF.md` holds the locked decisions,
`design/FINAL/BUILD_DECISIONS.md` the lead's reconciliation of the tracks (it wins over every other
document), `design/FINAL/architecture/ARCH.md` the module contracts, loop and test plan, and
`design/FINAL/{visual,levels,ux,audio}/` the visual, level, UX and audio specs. `design/AUDIT_FINDINGS.json`
is the verified list of defects in the previous code; the rebuild must not reproduce them. These
are working documents for the rebuild; the project's identity, constraints and plan live in
`CLAUDE.md`.

### Developer notes

- Determinism is non-negotiable: `src/sim` has no `Math.random`, `Date`, `performance`, DOM or
  `import.meta`, and no `Math.hypot`/`Math.pow`/`**`/`toFixed` (ESLint and a grep test enforce it).
  Online clients never run the sim; the server is the only authority.
- `src/sim/types.ts` and `src/net/protocol.ts` are frozen contracts; additive optional members only.
- `.claude/settings.json` is the project's Claude Code configuration (it registers a third-party
  skill marketplace and enables its plugin for anyone opening the repo in Claude Code). It is left as
  the owner configured it; review it before trusting it, and keep secrets out of it.
- `CLAUDE.md` is the handoff document for any assistant working here: identity, constraints, the cut
  list and the phased plan. Read it first.

## License

MIT, see `LICENSE`.
