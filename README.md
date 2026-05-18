# Flash Gimme Golf

A flash-style 2D co-op golf game you can play with a friend in your browser in 10 minutes.

**Play it:** https://flash-golf.vercel.app/

**Status:** Phase 1 complete — deterministic foundation in place, deployed, ready for Phase 2 playtesting.

---

## What this is

Two friends. One browser tab. Twelve levels. Cooperative golf puzzles where you have to work together — one player stands on a switch, the other plays through, color-coded hazards force you to coordinate routes, and the satisfaction is in solving it together.

"Flash" is a double meaning. **Nostalgic** — the era of Miniclip, Kongregate, Newgrounds. Browser-native, instant load, no install. **Fast-paced** — short sessions, quick matches, low friction.

This is *not* trying to be Golf With Your Friends. It's smaller, sharper, web-first, and built around co-op puzzle-solving rather than chaotic racing... but you can still race your friends if you want.

## Tech

- TypeScript + Vite, exact-pinned dependencies
- HTML5 Canvas for the game, React for the app shell
- Fixed-timestep deterministic physics with a seeded PRNG — the foundation for multiplayer, replays, and future async mode
- Game state is JSON-serializable and URL-encodable: a complete state (level + balls + turn + scores + RNG seed) round-trips through `?state=…` so any moment can be shared as a link

## Running locally

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173/`).

## Controls

| Action       | Keys              |
| ------------ | ----------------- |
| Aim          | `A`/`D` or `←`/`→` |
| Power        | `W`/`S` or `↑`/`↓` |
| Shoot        | `Space`           |
| Camera       | `Tab`             |
| Reset level  | `R`               |
| Quick start (1–4 players) | `1`–`4` |

## Project structure

```
flash_gimme_golf/
├── src/                 # Game source (TypeScript)
│   └── game/
│       ├── engine.ts    # Turn/phase state machine
│       ├── physics.ts   # Deterministic ball physics
│       ├── rng.ts       # Seeded PRNG (mulberry32)
│       ├── state.ts     # JSON-serialize + URL-encode game state
│       └── …
├── .github/workflows/   # CI: `npm run build` + `npm test` on every PR and push to main
├── vercel.json          # Vercel deploy config (SPA rewrite)
├── index.html           # Entry point
├── vite.config.ts       # Vite config
└── CLAUDE.md            # Vision, constraints, and phased plan (read this first)
```

## Roadmap

Development follows a four-phase plan with hard exit conditions. Each phase must complete before the next begins.

- **Phase 1 — Foundation.** Merge prototypes, deploy publicly, refactor physics for determinism.
- **Phase 2 — Validation.** Playtest with 10 humans. Don't proceed unless the core loop earns it.
- **Phase 3 — Live co-op v1.0.** 2-player online co-op, 12 hand-crafted levels, full art and sound pass.
- **Phase 4 — Soft launch.** Free release on itch.io and Newgrounds. Real player data decides what comes next.

Full plan, constraints, and explicit non-goals live in [`CLAUDE.md`](./CLAUDE.md).

## Contributing

This is currently a solo project. Issues and discussion are welcome; pull requests outside the active phase plan probably won't be merged.

## License

MIT — see [`LICENSE`](./LICENSE).
