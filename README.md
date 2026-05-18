# Flash Gimme Golf

A flash-style 2D co-op golf game you can play with a friend in your browser in 10 minutes.

**Status:** Prototype. Pre-Phase 1. Not yet deployed.

---

## What this is

Two friends. One browser tab. Twelve levels. Cooperative golf puzzles where you have to work together — one player stands on a switch, the other plays through, color-coded hazards force you to coordinate routes, and the satisfaction is in solving it together.

"Flash" is a double meaning. **Nostalgic** — the era of Miniclip, Kongregate, Newgrounds. Browser-native, instant load, no install. **Fast-paced** — short sessions, quick matches, low friction.

This is *not* trying to be Golf With Your Friends. It's smaller, sharper, web-first, and built around co-op puzzle-solving rather than chaotic racing... but you can still race your friends if you want.

## Tech

- TypeScript + Vite
- HTML5 Canvas for the game, React for menu/HUD overlays
- Fixed-timestep deterministic physics (foundation for multiplayer + replays + future async mode)

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
├── src/              # Game source (TypeScript)
├── index.html        # Entry point
├── vite.config.ts    # Vite config
└── CLAUDE.md         # Vision, constraints, and phased plan (read this first)
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
