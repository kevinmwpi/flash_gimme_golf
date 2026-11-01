# Contributing

Node 22 (`.nvmrc`), npm. `npm ci`, then work with these scripts:

| command | what |
|---|---|
| `npm run dev` | Vite on localhost (online buttons appear only with `VITE_WS_URL` or a local server) |
| `npm run dev:all` | Vite + the WebSocket server on :3001 (the `/ws` proxy points at it) |
| `npm run typecheck` | `tsc` for the app, the server (`lib ES2022`, no DOM) and the tests |
| `npm run lint` | ESLint incl. the layer dependency rule (`eslint.config.js`) |
| `npm test` | vitest, fast suite (the solver suite is excluded) |
| `npm run test:levels` | the slow level-solver suite (one file per world) |
| `npm run solve -- <levelId\|w1\|w2\|w3\|all>` | solve and verify holes with the real sim (`--write-goldens` re-records the golden lines) |
| `npm run build` | typecheck + Vite production build |

CI runs typecheck, lint (zero warnings), test, build, `build:server` and `npm audit` on every push and
PR, and the `Levels` workflow runs the slow suite as one job per world when `src/sim/**`,
`scripts/solver.ts` or `scripts/solver/**` changed; all of it must be green before merging.

## Rules

1. `src/sim/types.ts` and `src/net/protocol.ts` are frozen contracts. Additive, optional members
   only, agreed with the lead first.
2. The sim is deterministic: nothing under `src/sim` may use `Math.random`, `Date`, `performance`,
   the DOM, `import.meta`, `Math.hypot`, `Math.pow`, `**` or `toFixed`. Tuning numbers live in
   `types.ts`, nowhere else. Rounding goes through `quantize2/4/1`.
3. Respect the layer rule (`ARCHITECTURE.md`): `sim` imports only `sim`; `view` reads `sim`; `ui`
   talks to `sim/types`, the level registry, `view/audio` and `GameClient` types; `server` uses `sim`
   and `net/protocol` only. ESLint fails the build otherwise.
4. No competitive copy ("opponent", "scoreboard", "winner"); the game is co-op.
5. No `console.log` in shipped code (ESLint `no-console`), no `any`, no TODO stubs, no dead code.
6. Replace `it.todo(...)` rows with real tests; never delete a row without the lead's note.
7. Commits: imperative, one topic each. Dependency bumps come through Dependabot or a one-line note
   to the tooling owner; versions stay exact-pinned.

## Ownership areas

Every source file starts with `// OWNER: <group>`; edit only your group's files and code against
the contracts for everything else.

| group | owns |
|---|---|
| sim | `src/sim/{sim,physics,terrain,rng,serialize,devices}.ts`, `src/sim/__tests__/` (except the levels tests and the golden lines) |
| levels | `src/sim/levels/`, `src/sim/__tests__/levels*.ts` (incl. `levels-golden.ts`, `levels-solver-suite.ts`), `scripts/solver.ts`, `scripts/solver/` |
| view | `src/view/view.ts`, `src/view/render/`, `src/view/audio.ts`, `src/view/__tests__/view.test.ts` |
| input-loop | `src/view/input/`, `src/view/GameCanvas.tsx`, `src/view/__tests__/{input-*,loop}.test.ts` |
| ui | `src/ui/`, `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `index.html`, `public/` |
| net | `src/net/GameClient.ts`, `src/net/wsUrl.ts`, `server/`, `tsconfig.server.json`, `Dockerfile`, `fly.toml` |
| tooling | `package.json`, the tsconfigs, `vite.config.ts`, `eslint.config.js`, `.github/`, `vercel.json`, the docs |

## Adding a hole

1. Create `src/sim/levels/w<world>-<NN>-<slug>.ts` (NN is the global hole number, `order`, 01-12 today)
   exporting `export const level: Level = compileLevel({...})`. The id **is** the file name without `.ts`;
   the test suite asserts it.
2. Fill every field: `name`, `world`, `order`, `par` (>= 3), `hint` (<= 220 characters), `aha`, `watchOut`
   (shown as the "Stuck?" tip), `firstPlayer`, `mechanicsIntroduced` (exactly one in World 1, at most one
   elsewhere; empty hides the intro card's NEW row), `width` (1280 or wider; height is always 720),
   `wind: 0` (every world), terrain polylines, props, plates and `startXs` / `holeX`. Rect ids and switch
   ids must not collide (`door-gate` beside a `door` plate).
3. Make it readable: every plate and every switch-driven door, window, bridge, trap and cannon carries a
   short `label` that matches the hint copy. Keep every plate edge more than `GIMME_RADIUS +
   NEAR_CUP_RADIUS` from the cup (in World 1, at least 500 px) so a gimme can never concede a holder, and
   build switch puzzles so that **both** balls can get across (two plates, or the cup wired to a switch
   with `cupHoldsSwitch`). A trap or cannon lists its release / FIRE plates in `releaseIds` / `fireIds`,
   the one the partner usually reaches first; the HUD chip names them all. A plate inside a trap must
   cover the trap's whole restable floor (BUILD_DECISIONS D10.12).
4. Register it in `src/sim/levels/index.ts` in campaign order (and in its world's id list). Level-id
   literals live only in that directory, the solver tables and the golden lines; the UI goes through
   `LEVELS`, `WORLD_IDS`, `campaignFrom` and `worldTitle`.
5. Prove it: `npm test` runs `validateLevel` and the level rules over every registered hole;
   `npm run solve -- <id>` runs every solver pass (co-op line within par + 3 and a calibrated par, no solo
   bypass, no aces, walls and gaps, launchers, flight loops, rescuable traps and cannons); add its
   scripted line and record its golden with `npm run solve -- <id> --write-goldens`; then
   `npm run test:levels`. Record the shot speed you verified at (`SHOT_SPEED_PER_POWER` in
   `types.ts`) in the level file's header comment.
