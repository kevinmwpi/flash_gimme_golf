# LEVEL_DESIGN.md — Difficulty axes for level authoring

Design vocabulary for the 12 hand-crafted levels in Phase 3. Read
[CLAUDE.md](./CLAUDE.md) first. Phase exit conditions there override
anything in this file.

---

## Why this file exists

12 levels in 3 worlds of 4 levels each. Each world needs a readable
difficulty curve. Each level should change at least one axis vs. the
previous one. Across all 12, difficulty should escalate without spiking.

This is **informal vocabulary, not a scoring algorithm.** Rate each axis
1-5 by gut feel. The numbers are for talking about levels with playtesters
("the jump from level 3 to 4 felt rough on co-op coordination"), not for
math.

---

## The five axes

### 1. Geometric — the shape of the hole

- **Distance to cup** (1 = adjacent, 5 = full traversal across multiple screens)
- **Verticality** — height change required to reach the cup
- **Cup approach width** — how precise the final shot has to be

### 2. Path complexity — routing decisions

- **Par** — intended number of strokes
- **Obstacles requiring deliberate avoidance**
- **Path branching** (1 = one viable route, 5 = many viable routes)
- **Precision corridor** (1 = wide highway, 5 = needle threading)

### 3. Mechanic load — the machinery on the level

- **Distinct mechanics present** — count of sand, fans, springs, switches, hazards, bumpers, color gates
- **New mechanics introduced this level** vs. mechanics already taught
- **Sequencing requirement** — do mechanics need to be triggered in a particular order

### 4. Co-op coordination — the differentiator

**Weight this axis heaviest in your difficulty curve.** Co-op coordination
is the thing this game is about. Difficulty along this axis is the
differentiator vs. single-player golf and vs. chaotic multiplayer.

- **Co-op puzzles** — count of switches, color-locked gates
- **Simultaneity requirement** — one player holds while the other plays vs. asynchronous turns
- **Communication load** — how much verbal planning the team has to do

### 5. Recovery cost — how forgiving the level is

- **Hazard density** — probability that a small mistake costs a respawn
- **Soft-lock potential** — can the team get wedged and need a full level reset

---

## Anti-patterns — do not introduce

- **Timing-based obstacles.** Clashes with the pickup-and-play flash feel. Hard to tutorialize for two players communicating over voice.
- **Hidden / invisible mechanics.** Anti-puzzle. Players default to trial-and-error instead of insight, which kills the co-op-puzzle feel.
- **Endurance challenges (15+ strokes).** Breaks the 10-minute session length the game is targeting.
- **Single-player gates.** A puzzle one player solves while the other watches is not a co-op puzzle.

---

## Per-level sketch template

Fill this out when authoring or rebalancing a level.

```
Level N — <Name>  (World: Tutorial Hills | Switch Bridge | Hazard Cavern)

Geometric:      distance <1-5> | verticality <1-5> | cup-width <1-5>
Path:           par <#> | obstacles <1-5> | branching <1-5> | precision <1-5>
Mechanic load:  distinct <#> | new-this-level <#> | sequencing <1-5>
Co-op:          puzzles <#> | simultaneity <1-5> | communication <1-5>
Recovery:       hazard-density <1-5> | softlock-risk <1-5>

"Aha" moment intended:
  <one sentence describing the puzzle insight the team should hit>

Failure mode to watch for in playtest:
  <one sentence describing the most likely point of confusion>
```

---

## Curve guidance

- **World 1, levels 1-4 (Teach).** Mostly 1-2 across all axes. Each level introduces exactly one new mechanic. Co-op simultaneity stays at 1-2 — players are still learning the controls.
- **World 2, levels 5-8 (Combine).** Mix two taught mechanics per level. Co-op coordination climbs to 3-4. New mechanics introduced sparingly.
- **World 3, levels 9-12 (Test).** Combine three or more taught mechanics. Co-op coordination at 4-5. Branching maxes out so playtesters find their own solutions.

**No level should max out all five axes simultaneously.** A level that's
5 on everything is unfair, not hard. The point of an axis system is to
make tradeoffs visible.
