# Flash Golf rebuild — status and next steps (2026-10-03)

## State

The polished rebuild is complete on branch `redesign/polished-v1` and has not been pushed. Everything below was
verified on the final code.

| Check | Result |
|---|---|
| `npm run typecheck` (app, server, test configs) | clean |
| `npm run lint` (`--max-warnings 0`) | clean |
| `npm test` | 25 files, 392 tests passing |
| `npm run test:levels` (slow solver suite, about 8 min) | 40 passed, 16 skipped (mechanics absent in World 1) |
| `npm run build` and `npm run build:server` | clean |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| Headless Edge playthroughs (`design/pw/play.mjs`; use a copy that waits for `load`, not `networkidle`, because the title polls `/healthz`) | solo holes 1-4, door/plate and fall-penalty behaviour, pause, phone 844x390, and a two-browser online game with zero page or console errors |

How it was built: a 9-dimension verified audit, a judged design panel, a contract-first parallel build by seven
ownership groups, a level re-verification pass on the real sim, and three review rounds (find, skeptic-verify, fix,
re-integrate). Lead decisions D1-D9 in `FINAL/BUILD_DECISIONS.md` bind everything; D6 (no online auto-advance) and D7
(no follow-camera overscan) were the last two.

## Known remaining polish (not blockers)

1. The level floors sit about 100 px lower than the visual mockup, so the bottom HUD band (power meter and hint pill)
   covers some dirt, the dotted switch wires and the lower part of the hole-4 chasm. No ball, plate, door or golfer is
   hidden. Fix options: a follow-camera y offset with dirt and pit drawing extended to the screen bottom, or raising the
   level geometry and re-running the solver suite.
2. The power meter and the AIMING chip stay up while the ball is in flight.
3. Settings has no option to turn the control hints off.
4. On a portrait phone the title's server pill overlaps the logo.
5. `public/og.png` is a placeholder, and the iOS icons have transparent corners that iOS fills with black.
6. The fan loop would keep humming after leaving a game. World 1 has no fans, so this only matters for World 2.

Round 3 also listed 46 reviewer-rated low items that were not verified; they are in the workflow output and mostly
cover copy wording, focus order and doc drift.

## Shipping

1. Push the branch and open a PR to `main`; CI runs typecheck, lint, tests, both builds and the audit.
2. Protocol v3 is incompatible with the live server and client. Merging deploys the client on Vercel right away and
   the server on Fly after CI passes, so for a few minutes new clients cannot reach the old server. Merge at a quiet time.
3. Close PR #14 (letterboxing); the rebuild supersedes it.

## Open owner decisions

- `.claude/settings.json` auto-enables a third-party plugin marketplace (ui-ux-pro-max) for anyone who opens the repo.
- `node_modules` is still in git history (about 67 MB); removing it means rewriting history.
- Phase 2 per CLAUDE.md: recruit playtesters on the deployed build before authoring more content.
