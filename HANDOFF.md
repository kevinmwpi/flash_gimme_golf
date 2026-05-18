# Handoff — Phase 1 → Phase 2

**Date:** 2026-05-18
**Current phase:** Phase 1 closed. Ready for Phase 2 (validation).
**Live:** https://flash-golf.vercel.app/

This is a session-checkpoint document. It is a snapshot, not a maintained reference. The canonical strategy doc is [`CLAUDE.md`](./CLAUDE.md).

---

## Where we are

Phase 1's exit condition from `CLAUDE.md` §5 — *"a public URL anyone can play, deployed automatically, with deterministic physics and a clean repo"* — is met.

The codebase ships from `main` to https://flash-golf.vercel.app/ on every push. CI runs `npm run build` + `npm test` on every PR.

## What's in the box

- **Repo hygiene** — `.gitignore` in place, `node_modules/` and `dist/` untracked, every dependency exact-pinned
- **CI** — GitHub Actions runs `npm ci`, `npm run build`, `npm test` on push/PR
- **Auto-deploy** — `vercel.json` (SPA rewrite) wired; Vercel deploys `main` to the live URL automatically
- **Deterministic physics** — 60Hz fixed timestep, decoupled from render; same inputs → bit-identical state
- **Seeded RNG** — `src/game/rng.ts` (mulberry32). No `Math.random()` calls in gameplay code
- **Serializable state** — entire game state is one JSON-serializable object (`src/game/state.ts`)
- **URL-encodable state** — `?state=…` round-trips a complete game (level + balls + turn + scores + RNG state) through base64-encoded compact JSON
- **Determinism tests** — 5 tests in `src/game/__tests__/determinism.test.ts` covering PRNG identity, particle burst reproducibility, ball-stepping bit-identity, and serialize/deserialize round-trip

## What was deliberately not done

- **PR #2 cherry-pick** (React menu overlay) — skipped this session
- **Anything beyond Phase 1** — scope was held tight on purpose

## PRs merged this session

| PR | Title |
|----|-------|
| #5 | Add LEVEL_DESIGN.md and IDEAS.md |
| #6 | Phase 1 implementation — repo hygiene, deterministic physics, URL-encoded state |
| #7 | Physics determinism unit tests + Vitest in CI |
| #8 | README: add live URL, mark Phase 1 complete |

## Next phase — what Phase 2 actually looks like

Per `CLAUDE.md` §5, Phase 2 is 2–3 weeks of validation playtesting. No new features.

1. Recruit ~10 playtesters (mix of friends and strangers).
2. Send the URL with no instructions beyond *"play this for 10 minutes."*
3. Watch 3+ play over screenshare without explaining. Note confusion, laughter, drop-off.
4. Collect short written feedback from the rest.

**Exit condition:** 3+ playtesters express *unprompted* interest in playing again or playing with a specific friend.

**If exit fails:** the core loop needs work before anything else. Phase 3 is replaced with "redesign the core mechanic until 3+ playtesters get excited." Sunsetting is an acceptable outcome — re-read `CLAUDE.md` §5 before committing to redesign.

## Open questions to revisit before Phase 3

These are flagged in `CLAUDE.md` §9 but don't block Phase 2:

- Art direction — pixel art vs. flat vector vs. hand-drawn vs. something else
- Music and SFX direction — tone, genre, instruments
- Monetization model — Phase 4+ decision, not now

## How to pick this up cold

1. Read [`CLAUDE.md`](./CLAUDE.md) end-to-end. It overrides anything that contradicts it.
2. Skim [`IDEAS.md`](./IDEAS.md) and [`LEVEL_DESIGN.md`](./LEVEL_DESIGN.md) for context.
3. Open the live URL, play a level, confirm it still works.
4. Run `npm install && npm run dev` locally.
5. Run `npm test` to confirm determinism tests still pass (5/5).
6. The next user-facing action is **recruiting playtesters**, not writing code.
