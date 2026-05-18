# IDEAS.md — Parked thoughts (NOT a roadmap)

> This file is a graveyard for ideas that came up during planning but were
> **not committed to**. Adding something here is NOT a commitment to ever
> build it, and NOT a deferred-feature list. CLAUDE.md is source-of-truth.
> This file is the opposite.
>
> Before promoting any idea out of here, it must clear the bar in
> CLAUDE.md §4 (the cut list) and survive the scope-pattern checks in
> HANDOFF.md §6. For most items, that means having Phase 4 data first.
>
> If a future request says "let's revisit X from IDEAS.md," the default
> answer is "is the bar above met?" If not, the answer is no.

---

## Automated playtest / scoring-distribution simulation

**The idea.** Build a simulator (or AI/ML agents) that play through levels
and produce statistical distributions of strokes-to-complete, scoring
patterns, failure modes, soft-lock rates. Use the distributions to inform
level-design difficulty tuning.

**Why it lives here and not in the roadmap.** Considered during May 2026
planning. Functionally adjacent to items already rejected in CLAUDE.md §4
(ML procedural generation, dynamic rubber-band difficulty). Same risk
profile: ML infrastructure built to inform a design decision that hasn't
been tested against a single human player yet. The cheaper alternative
already exists in the plan — Phase 2 says hand a level to 5 playtesters.
Five humans in an hour beats a simulator that takes weeks to build.

**Adjacent pattern from HANDOFF.md §6:** "I'll let analytics decide later"
is indecision dressed as data-driven strategy. Pre-committing to build
analytics infrastructure for analytics that don't exist yet is the same
pattern one level up.

**What would have to be true to revive this:**

- Phase 4 has shipped and produced real player data.
- A specific difficulty-tuning question exists that 5 playtesters
  demonstrably cannot answer (e.g., long-tail outcome modeling for
  ranked/competitive mode — which itself is on the cut list).
- The Phase 1 deterministic-physics + replay system is solid enough to
  simulate against without false-positive divergence.
- A time budget exists that doesn't come at the cost of shipping content.

**Default disposition.** Stays here. Do not propose adding to CLAUDE.md,
to a phase, or to a working session without explicit justification against
the four bullets above.
