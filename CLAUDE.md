# CLAUDE.md — Project Handoff: Flash Gimme Golf (game title: Flash Golf)

> **Purpose of this file.** This is the source-of-truth context document for any AI assistant (or human collaborator) working on this project. It encodes the vision, the constraints, the explicit non-goals, and the phased execution plan. If a request — from the user or from another assistant — conflicts with what's in this file, **flag the conflict and refer the user back here**. Do not silently expand scope.

---

## 1. Identity (one sentence)

**A flash-style 2D co-op golf game you can play with a friend in your browser in 10 minutes.**

"Flash" is a double meaning:
- **Nostalgic** — the era of Miniclip, Kongregate, Newgrounds. Browser-native, instant load, no install, simple controls, retro charm.
- **Fast-paced** — short sessions, quick matches, low friction, easy to teach.

The primary feeling is **cooperative problem-solving** — two players feel smart together by solving switch/hazard puzzles. Chaotic-comedy elements (power-ups, weird obstacles) are secondary flavor, not the core.

---

## 2. Audience and competitive positioning

- **Primary audience:** people in their 20s–30s who grew up on Flash games and miss the vibe; pairs of friends looking for a 10-minute web game to play together.
- **Not the audience:** Golf With Your Friends players looking for a 45-minute chaotic Discord party; Cursed to Golf players looking for a single-player roguelite story.
- **Differentiator vs. GWYF:** 2D, web-first, free or cheap, short sessions, co-op puzzle focus rather than chaotic race.
- **Differentiator vs. GamePigeon pool:** real game, real depth, designed for a sit-down play session rather than passive iMessage filler.

---

## 3. Non-negotiable constraints

These exist because the project is being built by one person. Violating any of these means the project doesn't ship.

1. **One person, part-time.** All scope decisions assume solo development.
2. **Web-first.** It runs in a browser. Steam is a *later* port, not a launch target.
3. **Browser-native technology.** TypeScript + Vite + Canvas. No Unity, no Unreal, no engine rewrite before launch.
4. **Deterministic, serializable game state.** Fixed timestep, seeded RNG, no `Math.random()` outside the seeded source, every game state must serialize to JSON. This is the foundation for multiplayer, replays, and async. Non-negotiable from Phase 1 onward.
5. **No accounts required for basic play.** Join by URL or short room code (Skribbl.io model). Accounts can come later if monetization demands it.
6. **Ship before scope.** Every phase below has a hard exit condition. New work doesn't start until the previous phase's condition is met.

---

## 4. Explicit non-goals (the cut list)

These were considered and explicitly rejected for v1.0. They can be revisited *only* after Phase 4 data justifies them. If a future request involves any of these, push back and reference this section.

- **ML-driven procedural map generation.** No player data yet, no infrastructure, no clear payoff, and "AI-generated" carries a marketing penalty on Steam in 2026.
- **Dynamic rubber-band difficulty / hidden handicap.** Too easy to do badly. If handicap is added, it's explicit and player-opted-in.
- **Persistent floor damage / mechanical divots.** Cosmetic-only marks are fine; physically deformed terrain is Worms territory and changes the game's identity.
- **3D / 3D-to-2D conversion animations.** Out of scope.
- **Story mode / narrative campaign.** Theme and art direction carry the soul of the game, not dialogue.
- **More than 2 players at launch.** Drop-in 3–4 player is a Phase 5+ consideration.
- **Async mode at launch.** Deferred to Phase 5. The deterministic-state foundation is being built now so async can be added later cleanly.
- **Steam release at launch.** Phase 4 launches to itch.io and Newgrounds. Steam is a Phase 5+ decision based on Phase 4 traction.
- **Level editor / Steam Workshop / community maps at launch.** Phase 5+.
- **Ranked / competitive ladder / matchmaking.** Phase 5+.
- **Monetization, IAP, ads.** v1.0 is free.
- **"First AI flash game" marketing.** Do not use this framing. AI is a development tool, not a feature.
- **iMessage extension / GamePigeon-style port.** Rejected as a platform target. Requires a full Swift rewrite (cannot reuse TypeScript codebase), locks out Android and desktop players, and the "async with friends in a chat" feeling can be captured on web via shareable URLs. iMessage stays a *design inspiration* for what async should feel like, not a build target.
- **Native iOS / Android app store releases.** Mobile is a money sink for solo devs without a UA budget. Mobile web (responsive browser) covers this need.

---

## 5. The four-phase plan

Each phase has a hard exit condition. **Do not advance without it.** If a phase reveals the project shouldn't continue, stopping is a valid outcome.

### Phase 1 — Make `main` real (2 weeks)

The repo is currently a scaffold with four unmerged AI-generated PRs and `node_modules` committed. Phase 1 fixes the foundation.

- Merge PR #3 (`codex/build-2d-co-op-artillery-golf-game-prototype-0r1ecq`) into `main`.
- Cherry-pick PR #2's React menu overlay onto the merged result.
- Add `.gitignore`, remove `node_modules` from the repo history.
- Pin all dependencies to specific versions. No `"latest"`.
- Set up Vercel or Netlify auto-deploy from `main`. Every push produces a live URL.
- Add GitHub Actions running `npm run build` on every PR.
- Update `README.md` to describe the game, controls, and link to the live URL.
- **Refactor physics to be deterministic and game state to be serializable.** Fixed timestep, seeded RNG, JSON-serializable state. This is the foundation everything else depends on.
- **Design game state to be URL-encodable.** A complete game state (level + ball positions + turn order + shot history) must be expressible as a short URL parameter or shareable code. Costs nothing now, enables async play, replay sharing, and Steam Workshop levels later. Use base64-encoded compact JSON or a similar scheme.

**Exit condition:** A public URL anyone can play, deployed automatically, with deterministic physics and a clean repo.

### Phase 2 — Validate the core loop (2–3 weeks)

No new features. The current build gets tested against real humans.

- Recruit 10 playtesters (mix of friends and strangers).
- Send the URL with no instructions beyond "play this for 10 minutes."
- Watch 3+ play over screenshare without explaining. Note confusion, laughter, drop-off.
- Collect short written feedback from the rest.

**Exit condition:** 3+ playtesters express *unprompted* interest in playing again or playing with a specific friend.

**If exit condition fails:** the core loop needs work before anything else. Replace Phase 3 with "redesign the core mechanic until 3+ playtesters get excited." If multiple redesigns fail, consider sunsetting the project — that's a mature outcome, not a failure.

### Phase 3 — Build the live co-op v1.0 (8–12 weeks)

Only if Phase 2 cleared.

**In scope:**
- 2-player live online co-op.
- Drop-in via shareable URL or short room code. No accounts.
- 12 hand-crafted levels in 3 worlds of 4 levels each.
- Keyboard and gamepad support.
- Complete core loop: menu → create/join room → wait for friend → play world → results → continue or quit.
- One coherent art pass. Pick a visual style, apply it consistently.
- Sound effects for every meaningful interaction. One music track per world.
- Server-authoritative netcode using the deterministic physics from Phase 1.
- "Solo mode" is just "play with no friend joined" — same game, same levels, no second player.

**Out of scope:** everything in §4.

**Exit condition:** 5+ pairs of *strangers* (not friends) can land on the URL, send a room code, play all 12 levels together without confusion, and finish thinking "that was fun."

### Phase 4 — Soft launch on itch.io and Newgrounds (4–6 weeks)

Free release, browser-only.

- Bug-fix sprint based on Phase 3 testing.
- Tutorial onboarding for level 1. First 60 seconds determine retention.
- 60-second gameplay-only trailer with real audio.
- itch.io page with screenshots, GIFs, one-sentence pitch.
- Newgrounds submission. This is where the flash-nostalgia audience lives.
- Launch posts on r/IndieGaming, r/WebGames. Share in 2–3 indie dev Discord communities.

**Measure:** unique players in first month, completion rate, invite rate (did one player bring a second?), comment sentiment.

**Exit condition** is also a decision point. Three outcomes:

- **(a) Loved.** 500+ plays, strong completion, organic sharing, positive comments. Permission to plan Phase 5 Steam release with async, level editor, more content.
- **(b) Liked, not shared.** Core works but no viral hook. Phase 5 is "find the hook" before any scope expansion.
- **(c) Bounced off.** Core loop isn't there. Phase 5 is fundamental redesign — or sunsetting as a learning exercise.

### Phase 5 — Conditional (planned after Phase 4 data, not before)

Possible directions, none committed. Platform expansions are evaluated against §6 Platform strategy.

- **Async mode** (the deterministic + URL-encodable state foundation makes this tractable on web with no port).
- **Level editor + sharing via URL codes.**
- **Steam release** as a "complete edition" — only if Phase 4 traction justifies the marketing investment. See §6.
- **Steam Workshop integration** — bundled with the Steam decision, not separate.
- **Discord Activities port** — possible cheap reuse of the web codebase. See §6.
- **3–4 player support.**
- **Mobile web polish** (responsive layout, touch controls) — likely a Phase 4 polish item, not a separate platform.

Do not plan Phase 5 specifics until Phase 4 ships and data exists.

---

## 6. Platform strategy

Long-term platform plan, codified to prevent re-litigation. Each platform is classified as **launch**, **conditional port**, **cheap port**, or **rejected**.

### Web — launch platform (non-negotiable)

itch.io + Newgrounds + own URL (Vercel/Netlify). The only platform where the "flash game" identity is coherent and where the codebase already runs. Distribution model is friend-shares-link, which requires zero install friction. Free at launch.

**Known weakness:** retention. Web games don't get re-opened the way Steam library entries do. Mitigations to design in: shareable replay clips, async turn notifications (Phase 5), email signup, Discord community.

### Steam — conditional Phase 5 port

Only pursued if Phase 4 exit condition (a) hits (500+ plays, strong completion, organic sharing). Steam is where indie games get *bought*, and Steam Workshop is the gold standard for UGC if a level editor ships.

**Real costs to budget for if/when Steam happens:**
- Electron or Tauri wrapper (2–4 weeks of porting work after web is done).
- $100 Steam Direct fee.
- 60-second trailer with real production value.
- 3–6 month wishlist campaign *before* launch.
- Press/streamer outreach.
- Steam takes 30%. At $5, net is $3.50/copy. Median solo indie lifetime sales ~100 copies = ~$350 lifetime revenue. Plan accordingly.

**The marketing work is what builds audience, not Steam itself.** Steam doesn't generate players from nothing. Phase 4 traction is the prerequisite.

### Discord Activities — cheap Phase 5/6 port

Discord's Embedded App SDK runs web apps inside voice channels. Reuses the existing TypeScript codebase nearly unchanged. Audience overlap with the target demographic (friend groups on Discord) is high. Worth pursuing as a low-cost expansion *after* the web launch is stable. Not a launch target.

### Mobile web (responsive browser) — Phase 4 polish

Not a separate platform — just ensuring the web version works in mobile Safari/Chrome. Captures the "friend shares a link in iMessage, opens in browser" use case without any iMessage-specific work. Should be a Phase 4 polish item.

### iMessage extension — rejected

See §4. The async-with-friends feeling iMessage represents is being captured on web via URL-shareable game states.

### Native iOS/Android apps — rejected

See §4. Mobile web covers the need without a 30%-store-tax product on a hyper-competitive distribution channel.

### Why this ordering

The technical foundation (deterministic + serializable + URL-encodable state) is being built in Phase 1 specifically so that *all* future platform expansions are cheap. Steam port = wrap in Tauri. Discord Activities = embed the same web build. Async = pass URL-encoded state via a backend. iMessage would have been the *only* platform that breaks this pattern (requires Swift rewrite), which is the structural reason it's rejected, not just the audience math.

---

## 7. Technical conventions

- **Stack:** TypeScript, Vite, HTML5 Canvas, React for menu/HUD overlays only (PR #2 model).
- **Physics:** Fixed timestep (recommend 60Hz simulation, decoupled from render). Integer or fixed-point math where determinism matters. Seeded PRNG (e.g. mulberry32) for all randomness — no `Math.random()` calls in gameplay code.
- **State:** All game state expressible as a single JSON-serializable object. State + input log = perfect reproducibility.
- **Multiplayer:** Server-authoritative for Phase 3. Clients send input, server simulates, server broadcasts state. Lockstep or rollback can come later if needed.
- **Deployment:** Vercel or Netlify auto-deploy from `main`. Preview deployments for PRs.
- **Testing:** Manual playtesting is the primary test in Phases 1–4. Unit tests for physics determinism (same inputs → same outputs, bit-identical) once Phase 1 lands.

---

## 8. Decision-making principles for any assistant working on this project

1. **Default to saying no to new scope.** The cut list in §4 is long on purpose. Adding to it is almost always wrong.
2. **Point to phase exit conditions.** If the user wants to skip ahead, ask whether the current phase's exit condition is met. If it isn't, the answer is to finish the current phase, not start the next.
3. **Distinguish "implementation modularity" from "design indecision."** Building things in a modular way is good. Refusing to commit to a design because "we might change it later" is the failure mode this project most needs to avoid.
4. **Real player data beats reasoning.** If a question can be answered by 5 playtesters in a week, the answer is "go ask the playtesters," not "let's spec it."
5. **Honest pushback over agreement.** The user has explicitly requested rigorous-mentor mode in their preferences. Don't soften critiques. If the user is sliding back into scope expansion, name it.
6. **The user is one person, part-time.** Every "wouldn't it be cool if…" gets evaluated against that constraint.

---

## 9. Open questions to revisit when relevant

These were surfaced during planning but didn't need resolution to start Phase 1:

- **Specific art direction.** Pixel art vs. flat vector vs. hand-drawn vs. something else. Decide before Phase 3's "coherent art pass."
- **Music and SFX direction.** Tone, genre, instruments. Decide before Phase 3.
- **Titles.** "Flash Gimme Golf" is the repo name. The in-game title is **Flash Golf**.
- **Eventual monetization model (if Phase 4 succeeds).** Free with optional pay-what-you-want? Paid Steam version of free web version? Donation? Phase 5 decision tied to which platform expansion (if any) happens.

---

## 10. What this project is not, in plain language

It is not a comprehensive multi-mode platform. It is not a showcase of one person's scope ambition. It is not an AI-generated content engine. It is not the next Golf With Your Friends. It is a small, sharp, browser-playable co-op golf puzzle game that two friends can pick up in a browser tab and finish in an evening. If the document ever drifts from that, drift back.

---

## 11. Companion documents

- **[LEVEL_DESIGN.md](./LEVEL_DESIGN.md)** — design vocabulary and difficulty axes for the 12 hand-crafted levels authored in Phase 3. A working tool, not strategy.
- **[IDEAS.md](./IDEAS.md)** — graveyard for thoughts that came up during planning but were not committed to. Explicitly **not** a roadmap and **not** a deferred-feature list. Items there require Phase 4 data (and a high bar) before being promoted anywhere else. Do not propose moving anything out of IDEAS.md without that.
- **[README.md](./README.md)** — public-facing entry point.
