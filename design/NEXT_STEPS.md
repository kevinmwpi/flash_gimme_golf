# Flash Golf rebuild — handoff (session ended at the usage limit, 2026-10-02)

## State
- Branch `redesign/polished-v1` (from origin/main 8f1fda4). Working tree holds ONLY this `design/` package; no game code
  has been rewritten yet. Baseline build/tests on main are green.
- Audit done (95 confirmed findings in `AUDIT_FINDINGS.json`), design done (`FINAL/*`), lead reconciliation done
  (`FINAL/BUILD_DECISIONS.md`), contracts patched (`FINAL/architecture/types.ts`, `protocol.ts`).
- Verified facts: the ws server is LIVE at wss://flash-gimme-golf.fly.dev/ws and the Vercel build points at it;
  the current four levels are all 2-stroke solo-solvable holes (no real co-op) because max shot range is ~1,249 px.

## To launch the build (next session)
1. Copy this `design/` folder's helper scripts back to a scratch dir, or run them in place:
   - `tools/solver.ts` (old-physics solver, used only by the design phase), `pw/shot.mjs`, `pw/play.mjs`
     (headless Edge via `playwright-core`, install it with `npm i playwright-core` in that folder).
2. Patch `build-workflow.js` (the last patch did not apply because of a shell quoting error):
   a. In `common`, reference `${DOCS.decisions}` (BUILD_DECISIONS.md) as binding over every other doc.
   b. Replace the scaffold prompt's step list with: follow ARCH.md §8 (scripts/tsconfigs/deps) and §9 (stub strategy)
      exactly; copy `FINAL/architecture/types.ts` + `protocol.ts` verbatim; stubs for every contracted module incl.
      the D3 audio additions; `it.todo` test files per ARCH §4; index.html meta/OG/favicon/Fredoka link; verify
      typecheck + test + build + a placeholder-scene screenshot.
   c. Insert a `levels-verify` agent between Implement and Integrate (LEVELS owner, second pass): build
      `scripts/solver.ts` on the NEW sim (`runReplay`/`predictShot`/`evaluateSwitches`), run the co-op beam search,
      solo-bypass, wall/gap sweeps, stall and lip checks from LEVELS.md on all four levels, adjust geometry/par with
      evidence, and make `levels-solver.test.ts` real; feed its report to the integrator.
3. Launch: `Workflow({ scriptPath: '<path>/build-workflow.js', args: { project, scratch, devPort: 5199, maxRounds: 3,
   docs: { brief: LEAD_BRIEF.md, decisions: FINAL/BUILD_DECISIONS.md, arch: FINAL/architecture/ARCH.md,
   visual: FINAL/visual/VISUAL.md, levels: FINAL/levels/LEVELS.md, ux: FINAL/ux/UX.md, audio: FINAL/audio/AUDIO.md,
   findings: AUDIT_FINDINGS.json }, owners: [SIM, LEVELS, VIEW, INPUT+LOOP, UI, NET, TOOLING] } })` with the file
   lists from ARCH.md §9 and per-owner prompts summarising their track doc + BUILD_DECISIONS.md.
4. After the workflow: run `npm run typecheck && npm test && npm run build`, drive every screen with `play.mjs`,
   view the screenshots, run `npm run test:levels`, then commit on the branch and open a PR to main. Merging to main
   auto-deploys the server to Fly (protocol v3 is incompatible with the old client, so merge client + server together;
   Vercel previews will show a VERSION_MISMATCH message until then — by design).

## Open items the owner should decide
- `.claude/settings.json` auto-enables a third-party plugin marketplace (ui-ux-pro-max); keep or remove.
- `node_modules` is still in git history (~67 MB); rewriting history is the owner's call.
- PR #14 (letterboxing) is superseded by the rebuild; close it when the rebuild merges.
