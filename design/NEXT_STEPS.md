# Flash Golf — status and next steps (2026-11-01)

## State

Worlds 2 and 3 (holes 5-12) were merged into `main` in PR #28 and are the live build: the client on Vercel at
https://flash-golf.vercel.app and the server on Fly at `wss://flash-gimme-golf.fly.dev/ws`. The design is
`design/proposals/worlds-2-3/LEVELS.md`; the binding build decisions are `design/FINAL/BUILD_DECISIONS.md` D10; every
deviation from the design is in `src/sim/levels/README.md`.

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` (`--max-warnings 0`), `npm run build`, `npm run build:server` | clean |
| `npm test` | 40 files, 684 tests |
| `npm run test:levels` (one CI job per world: about 4 / 8 / 14 min) | 161 passed, 70 gated skips, 0 failed |
| World 1 equivalence | 176,180 per-tick states and 50 event lists identical to the pre-change sim; goldens differ only in the snapshot version and the appended `flightTicks` 0 |
| Solver passes on holes 5-12 | launchers 24,138 drops on target, 0 re-fires; loops 0 of 207,552 flights reach the watchdog; traps 0 tee-guard runs, every waiting state rescuable |
| Monte Carlo "noisy human" playtest (3,120 games, sigma 2 deg / 3 power) | every hole 100 % complete, 0 softlocks, 0 watchdog endings, medians at or under par (worst par + 1 at double noise) |
| Server == local | all 12 golden lines and World 1 -> 2 -> 3 through Continue: 33,436 ticks identical, 11,305 snapshots decoded, 0 errors |
| Real-browser playthroughs | solo holes, a two-browser online World 3 hole with real input (exact aims, browser state equal to the sim's prediction), touch press-anywhere and its cancel rules |

How it was built: a contract (D10) from seven subsystem scouts, the sim core first (with a recorded World 1
baseline), the levels, then view, UI, audio and solver groups in parallel, then three adversarial review rounds
(sim/levels, net/audio/tooling, visual/UX) where every claim was re-checked by a skeptic before a fixer touched it.
Verification found and closed three real defects in the approved geometry or engine: the Bait strip softlock, the
Crossfire flat softlock and a door-ejection freeze (Colour Lift, and latently World 1's Two Doors).

## Known issues and watch items

1. **Crossfire residual.** Blue LOADED in the cold cannon with red free on the near side cannot be undone except by
   the host's *Restart hole*. It takes two deliberate shots back across the chasm; random play, the solver and the
   Monte Carlo never reached it. A door-top rescue plate was rejected (levels README). Watch for it in playtests.
2. **Touch.** A swipe of 24 px or more anywhere on your turn now shoots (taps and returning to the press point still
   cancel). Ask touch playtesters whether any shot surprised them.
3. **Phones.** The bottom-left HUD cluster can cover a device on a y-640 floor while it shows (L9 BAIT seat, L12 pit
   behind the hint pill, L6 snare at the meter/pill seam). Suggested fix: hide the hint pill while a ball waits.
4. **Gamepad menus.** Gameplay works on a pad; menu navigation with a pad (UX §5.3) is not implemented.
5. **Online reconnect mid-flight.** A client that reconnects during a cannon flight keeps the camera on the active
   ball until the next `turnStart` (it missed the `cannonFire` event that latches the follow).
6. **Difficulty.** Under the Monte Carlo model World 2 plays easiest relative to par (sum of means 25.3 against par
   29); the hardest beats on new holes are finishing putts out of catch basins (L10 from B, L12 from TOP, L6 from
   FAR), not the device shots. Revisit pars only with real playtest data.
7. **Audio loudness.** Listen for the skip cue (`TUNE.turnSkipped`) and the trap clink (`TUNE.trapClink`) in long
   sessions, and for L10's chain reaction, now the loudest moment in the game (within AUDIO.md's policy).
8. **Coverage gap.** The watchdog's immediate online broadcast (`flightTimeout`) is proven only by a scratch harness;
   no shipped hole can fly 30 s, and `RoomManager` has no public way to seat a crafted state.
9. From the browser playthroughs (all low): `pullReachable` (and so `input-reach.test.ts`) counts pulls inside
   the 24 px cancel ring as shots, so three beats in that test use a 15.6-power tap the slingshot would cancel
   (every line still completes with a 24 px minimum, power 19.0); on compact touch the floating power number
   follows the 10 Hz summary and lags the drag by about 90 ms; online, a long waiting chip ('LOADED · needs FIRE or
   TOP') shortens the level chip's hole name with an ellipsis.
10. Older polish items still open: the floors sit about 100 px lower than the mockup, so the bottom HUD band covers
   some dirt; the power meter and AIMING chip stay up in flight; on a portrait phone the title's server pill
   overlaps the logo; `public/og.png` is a placeholder and the iOS icons have transparent corners.

## Next (CLAUDE.md §5, Phase 3)

- The exit test: 5+ pairs of **strangers** land on the URL, send a room code, play all 12 holes without confusion
  and finish thinking "that was fun". Reuse the Phase 2 kit (`design/playtest/phase-2/`) with a fresh tracker;
  add the watch items above as observer questions (skipped turns read as the device, not a bug; pairs who refuse
  the bait; first-time reads of the cannon).
- Gamepad menu navigation and a consistency check of the scrappy art across all 12 holes.

## Open owner decisions

- `.claude/settings.json` auto-enables a third-party plugin marketplace (ui-ux-pro-max) for anyone who opens the repo.
- `node_modules` is still in git history (about 67 MB); removing it means rewriting history.
