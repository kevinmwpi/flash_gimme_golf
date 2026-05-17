# Golf Siege — PR comparison & local playtest results

Generated after setting up all four PR worktrees, fixing PR #3/#4 Vite config, verifying production builds, and starting dev servers.

## Local URLs (servers running)

| PR | Branch | URL | Worktree folder |
|----|--------|-----|-----------------|
| [#1](https://github.com/kevinmwpi/flash_gimme_golf/pull/1) | `codex/build-2d-co-op-artillery-golf-game-prototype` | http://localhost:5173/ | `..\flash_gimme_golf-pr1` |
| [#2](https://github.com/kevinmwpi/flash_gimme_golf/pull/2) | `codex/build-2d-co-op-artillery-golf-game-prototype-vdoo3x` | http://localhost:5174/ | `..\flash_gimme_golf-pr2` |
| [#3](https://github.com/kevinmwpi/flash_gimme_golf/pull/3) | `codex/build-2d-co-op-artillery-golf-game-prototype-0r1ecq` | http://localhost:5175/ | `..\flash_gimme_golf-pr3` |
| [#4](https://github.com/kevinmwpi/flash_gimme_golf/pull/4) | `codex/build-2d-co-op-artillery-golf-game-prototype-24xmja` | http://localhost:5176/ | `..\flash_gimme_golf-pr4` |

Open all four in separate browser tabs to compare feel side-by-side.

### Controls (all builds)

| Action | Keys |
|--------|------|
| Aim | `A`/`D` or `←`/`→` |
| Power | `W`/`S` or `↑`/`↓` |
| Shoot | `Space` |
| Camera | `Tab` |
| Reset level | `R` |
| Quick start 1–4 players | `1`–`4` (PR #2/#4; PR #1/#3 also use canvas UI) |

Use **2–4 players** to experience co-op switches and colored hazards.

---

## Build verification

| PR | `npm install` | `npm run build` | Notes |
|----|---------------|-----------------|-------|
| #1 | OK | OK (Vite 8) | Ran without changes |
| #2 | OK | OK (Vite 8) | Ran without changes |
| #3 | OK | OK (Vite 7) | **Local fix applied**: `@vitejs/plugin-react` + `vite.config.ts` |
| #4 | OK | OK (Vite 5) | **Local fix applied**: `@vitejs/plugin-react` + `vite.config.ts` |

PR #3 and #4 required the Vite React plugin fix in their worktrees only (not committed to GitHub).

---

## Quality ranking (best → worst)

### 1. PR #3 — best overall build

- Richest mechanics: sand, springs, fans, switch-linked moving bumpers/bridges in level data.
- Best presentation: animated golfers, clouds, fullscreen canvas HUD (~391-line renderer).
- Pinned semver dependencies.
- **Caveat**: upstream branch missing Vite React plugin (fixed locally for testing).

### 2. PR #2 — best onboarding UX

- React HTML menu with control legend and co-op explanation.
- Clean unified rect/segment collision model; moving bridges via switches.
- Builds out of the box.
- **Caveat**: `"latest"` deps; Hazard Cavern lacks sand/spring/fans.

### 3. PR #1 — solid baseline

- Explicit `fans` / `hazards` / `gates` / `bumpers` types; richest Hazard Cavern puzzle (2 switches, 2 fans, block vs bounce hazards).
- Canvas-drawn start menu; builds without changes.
- **Caveat**: mid-tier visuals vs PR #3; `"latest"` deps.

### 4. PR #4 — good shell, thinnest core

- React overlays; pinned React 18 / Vite 5; 4-player hazard routing.
- **Caveat**: smallest engine; simpler levels; needed Vite fix locally.

---

## Playtest checklist (spec coverage)

| Criterion | PR #1 | PR #2 | PR #3 | PR #4 |
|-----------|:-----:|:-----:|:-----:|:-----:|
| 3 levels | Yes | Yes | Yes | Yes |
| 1–4 local players | Yes | Yes | Yes | Yes |
| Trajectory preview | Yes | Yes | Yes | Yes |
| Switch / bridge co-op | Yes | Yes | Yes | Yes |
| Colored hazards | Yes | Yes | Yes | Yes |
| Fans | Yes | — | Yes | Yes |
| Sand / springs | — | — | Yes | — |
| HTML help menu | Canvas | React | Canvas | React |
| Production build | Pass | Pass | Pass* | Pass* |

\*After local Vite plugin fix.

---

## Recommendation

**Merge PR #3** as the primary candidate, with a follow-up commit adding `@vitejs/plugin-react` and the React plugin in `vite.config.ts` (already applied in `flash_gimme_golf-pr3` worktree for reference).

**If you prefer friendlier first-run UX**, merge **PR #2** instead, or cherry-pick its `GameCanvas.tsx` menu overlay onto PR #3.

**If you want lowest friction today**, **PR #1** runs with zero config fixes and has the deepest Hazard Cavern switch/fan layout.

---

## Cleanup (when finished playing)

```powershell
cd c:\Users\KevnP\Downloads\flash_gimme_golf
git worktree remove ..\flash_gimme_golf-pr1
git worktree remove ..\flash_gimme_golf-pr2
git worktree remove ..\flash_gimme_golf-pr3
git worktree remove ..\flash_gimme_golf-pr4
```

Stop dev servers with Ctrl+C in their terminal sessions.
