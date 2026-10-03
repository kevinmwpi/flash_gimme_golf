# Physics notes — what to keep, what to fix, how (FINAL, post-critique)

Target files: `src/sim/physics.ts` (+ geometry in `src/sim/terrain.ts`). Owner: SIM agent. Every number quoted
here is a constant in `types.ts`; do not re-declare numbers in physics.ts. `Vec` is immutable (`readonly x/y`):
physics keeps `px, py, vx, vy` as locals (or a `MutVec`) inside a tick and writes `ball.pos = { x, y }` /
`ball.vel = { x, y }` once per sub-step.

## 0. Floating-point hygiene (binding; enforced by `sim-purity.test.ts`)

- Inside `src/sim/**` only `+ - * /`, `Math.sqrt`, `Math.round`, `Math.floor`, `Math.ceil`, `Math.abs`,
  `Math.min`, `Math.max` are used for integration and collision.
- `vec.len(v)` = `Math.sqrt(v.x*v.x + v.y*v.y)`. **`Math.hypot` is banned** (its implementation changed between
  V8 versions and differs across engines). **`Math.pow` and `**` are banned** (per-tick damping is a multiply:
  `vx *= ROLL_DAMP`, never `0.992 ** (dt*60)`). `toFixed` is banned.
- `Math.sin`, `Math.cos`, `Math.atan2` appear ONLY inside `launchVelocity(aim)` in physics.ts. Everything that
  reaches the sim as an angle is already a 4-dp number (`quantize4`), so `launchVelocity` is a pure function of
  two short decimals on every engine.
- The only rounding helpers are `quantize2 / quantize4 / quantize1` from `types.ts`. There is no `REST_QUANTUM`.
- `Number.isFinite` is checked UNCONDITIONALLY on every number written into `SimState` at the end of `stepSim`
  (~20 numbers per tick; a non-finite value throws `new Error('sim: non-finite state')`, which the server
  catches per room and local mode surfaces as a toast + fresh sim). The sim cannot know "dev mode" (`import.meta`
  is banned), so there is no dev-only branch.

## 1. Keep verbatim from the current build (`src/game/physics.ts`, `terrain.ts`, `rng.ts`)

| current code | keep as |
|---|---|
| `rng.ts` mulberry32 body (`rngNext`) | `sim/rng.ts`, but functional: returns `[nextState, value]` |
| `add/sub/mul/dot/clamp/normalize/distance` | `terrain.ts` `vec` namespace + `clamp` (`len` rewritten with `Math.sqrt`, see §0) |
| `closestPointOnSegment` (with the `Math.max(dot(ab,ab), EPSILON)` guard) | `terrain.ts` |
| `surfaceYOnPiece` linear interpolation between control points (the `Math.max(b.x - a.x, 1)` guard) | `terrain.ts` `surfaceYOnPiece` |
| `isRectActive` semantics: `pressed === (rect.activeWhen ?? default)` | `terrain.ts` (default `true` except blocker `false`; **no `switchId` ⇒ always active**) |
| gravity 620, airborne drag → per tick `vx *= AIR_DRAG` | `stepBall` |
| rolling branch: tangential gravity `dot({0,GRAVITY}, tangent) * SLOPE_GRAVITY_SCALE(0.85)` | `stepBall` grounded branch |
| `GROUND_ROLL_DAMP 0.992` as `ROLL_DAMP`, `SAND_ROLL_DAMP 0.91 → 0.90` | grounded branch, applied once per tick |
| circle-vs-AABB closest-point test (`clamp` the centre into the rect) | rect collisions |
| `rectEscapeNormal` (nearest-face ejection when the centre is inside a rect) | rect collisions |
| level side walls: clamp x to `[radius, width - radius]` and reflect | keep, restitution `WALL_RESTITUTION` 0.45 (was 0.5) and emit `bounce{surface:'levelEdge'}` |
| sinking rule "slow enough over the cup" | keep the idea; see §3.9 for the swept version |

Delete entirely: `Segment`/platform pipeline (audit #56), moving rects `vx/vy` (#57), `Particle` + `burst` (#82 — view
owns particles), `trail`/`prevPos`/`sinking`/`sinkT` on the ball (#58; the view animates the sink), `predictArc`
(#18), `updateGolferHandoff` (view), `messageTimer` (#27), the `normal.y` sign hack (#55), the `0.06` tangential
scrub in `resolveCollision` (#16), the 4-player start arrays, `Date.now()` seeds (#61), `Math.hypot` / `**` (§0).

## 2. Ground queries — `groundAt` replaces the x-only family (soft-lock fix)

```ts
// terrain.ts
export type Ground = {
  y: number;              // surface y under the ball centre x
  normal: Vec;            // outward unit normal (y < 0), {0,-1} for rect tops
  slope: number;          // |dy/dx| of the surface at x (0 for rect tops)
  permanent: boolean;     // true for terrain pieces and permanent rects (no switchId)
  source: 'piece' | 'bridge' | 'blocker' | 'colourGate';
  index: number;          // index into level.terrain.pieces or level.rects
};
/**
 * The surface the ball at `pos` is (or would be) standing on: among every candidate whose x-range
 * contains pos.x — terrain piece tops, ACTIVE bridge tops, ACTIVE blocker tops, colour-gate tops
 * whose colour !== PLAYER_GATE_COLOUR[playerId] — pick the SMALLEST y that satisfies
 * y >= pos.y + BALL_RADIUS - GROUND_SEARCH_SLACK (4). null when nothing is below the ball.
 * This is exactly the collider set of step 3, so "supported" and "collides" can never disagree.
 */
export function groundAt(level: Level, switches: Readonly<Record<string, boolean>>, pos: Vec, playerId: PlayerId): Ground | null;
export function hasSupport(level, switches, ball, playerId): boolean;   // g !== null && |g.y - (ball.pos.y + R)| <= SUPPORT_TOLERANCE (2)
```
- A ball resting on the fairway UNDER an overhang: the overhang's surface y is far above `pos.y + R - 4`, so it
  is excluded; the fairway is chosen. No wake loop.
- A wrong-colour ball resting on TOP of a colour gate, or any ball on top of a blocker: that rect top is in the
  candidate set, so it is supported (fixes the aiming→flying→aiming 6-tick loop).
- A ball on a stacked pillar: the pillar top is above the covered fairway surface and satisfies the bound, so it
  wins (smallest y). The fairway under the pillar is never chosen because the pillar's walls stop the ball
  ever being there.
- `evaluateSwitches` uses `groundAt(...)` too: pressed when `ball.grounded && x in [sw.x, sw.x + sw.w] &&
  |pos.y + R - sw.surfaceY| <= SWITCH_CONTACT_TOLERANCE && g.source === 'piece'` (a ball parked on a blocker
  above a plate does not press it).
- `restsOnPermanentGround(level, switches, pos, playerId)` = `groundAt(...)?.permanent === true`.

Authoring-only (compile time, `levels/authoring.ts` and `validateLevel`), never called by physics:
```ts
/** LOWEST (largest y) terrain-piece surface at x = "the fairway". null in a gap. */
export function surfaceYAt(level: Level, x: number): number | null;
export function surfaceSlopeAt(level: Level, x: number): number;   // of the fairway piece at x
export function placeOnSurface(level: Level, x: number): Vec;      // { x: quantize2(x), y: quantize2(surfaceYAt(x) - BALL_RADIUS) }; throws in a gap
```
`compileLevel` passes `switch.surfaceY`, `hole.rimY`, `starts[i]` through `quantize2`, so the sunk-ball position
`{ hole.x, hole.rimY + SUNK_BALL_DROP }` and tee positions are exactly representable in a snapshot.

## 3. Step order inside `stepBall(ball, ctx, out)` — one tick, DT = 1/60

`ctx = { level, switches, playerId, colliders }` where `colliders = solidColliders(level, switches)` is computed
ONCE per tick by `stepSim` (cached per `(level, switchMask)` in a `WeakMap<Level, Map<number, Collider[]>>`),
then filtered per ball to drop the matching colour gate.

```
0  if ball.sunk: return 0
1  if ball.asleep:
     if any ACTIVE fan AABB contains pos: wake (asleep=false, restTicks=0, emit fan)   // switch-driven fan under a parked ball
     else if hasSupport(level, switches, ball, playerId): return 0
     else: ball.asleep = false; ball.restTicks = 0                                   // support vanished (bridge gone) -> fall
   startX = pos.x; wasGrounded = ball.grounded; phaseAtStart handled by stepSim
2  forces (per tick): vy += GRAVITY*DT; vx += wind*DT
   fan: for each ACTIVE fan whose AABB contains pos: vy -= force*DT; vy = max(vy, -FAN_MAX_LIFT); emit 'fan' on entry (AABB did not contain startPos)
3  speed = len(v); n = clamp(ceil(speed*DT / SUBSTEP_MAX_MOVE), 1, MAX_SUBSTEPS); h = DT/n
   contact = none; onSand = false
   repeat n times:
     p += v*h
     for iter in 1..2:                                           // resolve the deepest penetration twice
       hit = deepestContact(p, ctx.colliders)                    // terrain edges + active bridge/blocker/wrong-colour gate AABBs
       if !hit: break
       eject: p += hit.normal * (R - hit.distance + 0.05)
       vIn = dot(v, hit.normal)
       if vIn < 0:
         if hit is a terrain TOP edge or bridge/blocker/gate TOP (normal.y < -0.5):
           sandHere = first rect in level.rects order with kind 'sand', active, and p.x in [x, x+w]   // decided BEFORE restitution
           e = sandHere ? 0 : (restitution by table below); if sandHere and !onSand: onSand = true; sandRect = sandHere
         else e = restitution by table
         v -= hit.normal * (1 + e) * vIn
         if -vIn >= BOUNCE_EVENT_MIN_IMPACT: emit bounce{strength: min(1, -vIn/MAX_BALL_SPEED), surface}
         if hit is a wrong-colour gate: emit hazardBlock
       if hit.normal.y < -0.5: contact = hit (grounded this tick); impact = max(impact, -vIn)
   pointInPiece safety: if any piece contains p -> eject to the closest edge (R + 0.05 along its normal), zero the inward velocity
4  pads (only when contact is a piece top or bridge top; evaluated once per tick; first match in level.rects order among ACTIVE rects):
     sand   -> onSand = true; emit enterSand when ENTRY: !wasGrounded (landing) OR startX outside the pad range (rolled in)
     spring -> v = rect.launch; emit spring{launch}; contact = none (airborne now)
     bumper -> if impact >= PAD_MIN_IMPACT: v = n*BUMPER_SPEED + t*(dot(v,t) + sign(p.x - centre)*BUMPER_SIDE_KICK); emit bumper{outVel}; contact = none
5  colour gates: a gate whose colour === PLAYER_GATE_COLOUR[playerId] is NOT in this ball's colliders;
   crossing its x-range (startX and p.x on different sides of the gate's centre x) emits gatePass once
6  level edges + ceiling: x clamp to [R, width - R] with WALL_RESTITUTION and bounce{levelEdge}; if p.y < CEILING_Y: p.y = CEILING_Y, vy = max(0, vy), bounce{ceiling}
7  kill line: if p.y > level.height + KILL_MARGIN: pos = lastRest; vel = {0,0}; asleep = true; restTicks = REST_TICKS; grounded = true; emit fellOffWorld{respawnPos}; return FALL_PENALTY
8  grounded branch (contact set):
     tangent = {-n.y, n.x} oriented so tangent.x >= 0; gTan = dot({0,GRAVITY}, tangent)*SLOPE_GRAVITY_SCALE; v += tangent*gTan*DT
     v *= (onSand ? SAND_ROLL_DAMP : ROLL_DAMP)                   // once per tick, whole vector
   else: vx *= AIR_DRAG
9  speed cap: if len(v) > MAX_BALL_SPEED: v *= MAX_BALL_SPEED/len(v)
10 ball.grounded = contact !== none; write ball.pos = {x: p.x, y: p.y}; ball.vel = {x: vx, y: vy}
11 cup test (§4.9): may set sunk and return 0 (sink) — before the rest test so a slow ball over the cup drops
12 rest test (§4.5): may set asleep, quantise pos, update lastRest if restsOnPermanentGround; then gimme (§5) may set sunk and return 1
13 return 0
```

**Stroke accounting**: the number returned by `stepBall` for ball index `i` is added to `players[i].strokes` —
the FALLING/conceded ball's OWNER — never to `activePlayer` (the other ball may be the one that fell off a
vanished bridge during the active player's shot).

Contact response table (`vIn` = incoming normal speed, negative = approaching):

| surface | restitution | tangential | event surface |
|---|---|---|---|
| terrain top edge (normal.y < -0.5) | `GROUND_RESTITUTION` 0.35; **0 when the contact x is inside an active sand rect** | unchanged (NO scrub) | grass |
| terrain side/base edge | `WALL_RESTITUTION` 0.45 | unchanged | dirtWall |
| bridge (any face) | `BRIDGE_RESTITUTION` 0.35 (top: 0 on sand — never happens, sand is not authored on bridges) | unchanged | bridge |
| blocker (any face; permanent or switch-driven) | `WALL_RESTITUTION` 0.45 | unchanged | blocker |
| colour gate, wrong colour | `GATE_RESTITUTION` 0.5 | unchanged | (hazardBlock event instead of bounce) |

`resolveCollision` becomes: `v -= n * (1 + e) * dot(v, n)` only when `dot(v, n) < 0`. Nothing else. Rolling
friction lives ONLY in step 8 (audit #16): a 300 px/s roll on flat grass now travels `300/60 * Σ0.992^k` ≈ 625 px.

## 4. Bugs from the audit and the fix for each

### 4.1 Tunnelling (#19) — sub-stepping + swept-safe thresholds
`MAX_BALL_SPEED` 1100 ⇒ 18.3 px/tick; `SUBSTEP_MAX_MOVE` 8 ⇒ ≤ 3 sub-steps, each moving the centre ≤ 8 px while the
detection radius is 12 px, so no edge (terrain or a 16 px bridge slab) can be skipped. The point-in-polygon pass in
step 3 is the belt-and-braces for terrain; for rects, `rectEscapeNormal` ejects through the nearest face. Test:
28 phase offsets × speeds {600, 900, 1100} dropped vertically and at 30° onto terrain and onto a 16 px bridge ⇒ never
below the surface, never inside a piece.

### 4.2 Energy gain / unbounded bounces (#15)
No restitution > 0.5 anywhere. Springs SET velocity to a designer-chosen `launch` vector (bounded by the validity test
to `|launch| ≤ MAX_BALL_SPEED`), bumpers SET the normal speed to `BUMPER_SPEED` 440 and add a side kick of 90 px/s away
from the pad centre so a vertical pogo drifts off the pad within 2 bounces. Global speed cap in step 9 and the soft
ceiling in step 6. Test: 600 ticks bouncing on a bumper and on a spring ⇒ `len(vel) ≤ 1100`, `y ≥ CEILING_Y`, ball
eventually rests or leaves the pad.

### 4.3 Terrain not solid (#2) — edges + point-in-polygon
`pieceEdges(piece)` emits: top polyline edges with outward normals (`normalize({-dy, dx})` flipped so `y < 0`);
right side `(last.x, last.y) → (last.x, baseY)` normal `{1,0}`; base `(last.x, baseY) → (first.x, baseY)` normal
`{0,1}`; left side `(first.x, baseY) → (first.x, first.y)` normal `{-1,0}`. `pointInPiece` handles the inside case:
if the centre is inside, find the closest edge, move the centre to `closest + normal*(R+0.05)` and zero the inward
velocity. Audit #55: `Ground.normal` is the OUTWARD one (`{tangent.y, -tangent.x}` normalised, y < 0 on flat ground);
`stepBall` derives the tangent from it. Overhangs/ceilings are ordinary pieces: their BASE edge (normal `{0,1}`)
is what a lobbed ball hits (`bounce{surface:'dirtWall'}`). Test: a ball at (900,648) with vel (300,100) next to a
cliff at x=958 ends with x ≤ 946 and `pointInPiece` false every tick; respawn count 0.

### 4.4 Only the active ball simulated (#3) and switches stale
`stepSim` steps every non-sunk ball every tick in `aiming` and `flying`. A sleeping ball costs one `groundAt`
lookup (+ one fan AABB test per active fan). `evaluateSwitches` runs after all balls each tick (§2). Rect
activation uses the switch map from the START of the tick (one-tick latency, deterministic). `stepSim` leaves
`flying` only when `allSettled && !switchesChangedThisTick` so the latency can never produce a double `turnStart`.

### 4.5 Rest rule freezes on slopes (#17) — and quantisation uses the encoder's expression
`g = groundAt(...)`; `restCandidate = grounded && len(vel) < REST_SPEED && g !== null && g.slope < REST_MAX_SLOPE
(tan 15°)` — on a rect top the slope is 0. `restTicks = restCandidate ? restTicks+1 : 0`; at `REST_TICKS` (6):
`vel = {0,0}`, `asleep = true`, `pos = { x: quantize2(pos.x), y: quantize2(pos.y) }` (the SAME `quantize2` the
encoder uses, so `decodeSnapshot(encodeSnapshot(s))` deep-equals `s` for settled states), emit
`ballRest{onPermanentGround}`; if `g.permanent` then `lastRest = pos`. On a 70° face `|gTan|·DT ≈ 8.3 px/s per tick`
keeps the ball accelerating, so it rolls down. Level validity requires plates and tees on slope ≤ `RESTABLE_MAX_SLOPE`.

### 4.6 Flush props (#4) and the floating bridge (#1)
Sand/spring/bumper are pad RANGES: physics only asks "is the ball in ground contact with `pos.x` inside
`[rect.x, rect.x+rect.w]`"; they have no collision geometry. The renderer draws them embedded (sand sunk 6 px,
spring plank + coil in a cut-out, bumper as a striped dome of 10 px). Bridges: `compileLevel` sets the bridge AABB
from the gap: `x = gap.x1, w = gap.x2 - gap.x1, y = quantize2((surfaceYAt(gap.x1 - 1) + surfaceYAt(gap.x2 + 1)) / 2), h = 16`
and `validateLevel` fails when either lip differs from `y` by more than `BRIDGE_LIP_TOLERANCE` (3 px) or when a piece
does not end/resume exactly at the gap. Test: a 120 px/s roll from 60 px before the gap crosses a pressed bridge and
rests on the far side; the same roll with the bridge inactive falls and respawns at `lastRest` with +1.

### 4.7 Aim preview mismatch (#18) — `predictShot` IS the sim, including switches
```ts
export function predictShot(
  level: Level, switches: Readonly<Record<string, boolean>>, ball: Readonly<BallState>, playerId: PlayerId,
  aim: Aim, otherBalls: readonly Readonly<BallState>[], maxTicks = 150,
): { points: Vec[]; landing: Vec | null; outcome: 'rest' | 'sink' | 'gimme' | 'fell' | 'running' } {
  const scratch: BallState = { ...ball, vel: launchVelocity(aim), asleep: false, restTicks: 0, grounded: false };
  const others: BallState[] = otherBalls.map((b) => ({ ...b }));       // stepped too: a parked ball may fall or roll
  let sw: Record<string, boolean> = { ...switches };
  const out: StepBallOut = { events: [] };
  const points: Vec[] = []; let landing: Vec | null = null; let outcome: Outcome = 'running';
  for (let i = 0; i < maxTicks; i++) {
    const colliders = solidColliders(level, sw);
    stepBall(scratch, { level, switches: sw, playerId, colliders }, out);           // the REAL function, same DT
    for (let j = 0; j < others.length; j++) stepBall(others[j], { level, switches: sw, playerId: otherId(j), colliders }, out);
    sw = evaluateSwitches(level, sw, playerId === 0 ? [scratch, others[0]] : [others[0], scratch]); // slot order; re-evaluated every scratch tick (same as stepSim)
    points.push(scratch.pos);
    if (landing === null && scratch.grounded) landing = scratch.pos;
    if (scratch.sunk) { outcome = out.events.some(e => e.type === 'gimme') ? 'gimme' : 'sink'; break; }
    if (out.events.some(e => e.type === 'fellOffWorld' && e.playerId === playerId)) { outcome = 'fell'; break; }
    if (scratch.asleep) { outcome = 'rest'; break; }
    out.events.length = 0;
  }
  return { points, landing, outcome };
}
```
Because it is the same function with the same inputs AND the same switch re-evaluation, the preview point at tick k
equals the real ball position at tick k on every level including switch levels (tested exactly on a switch fixture
where the shot ball lands on a plate that opens a blocker). `stepSim` calls `stepBall` with `playerId` = ball index,
so `otherId(j)` is the slot of `otherBalls[j]` (the caller passes `[balls[1 - playerId]]`). The renderer draws a dot
every 3rd point up to `landing` (plus 12 more faded) and a landing marker; it does NOT show the full solution of a
bounce chain beyond `maxTicks` (hint, not oracle). Cost: 150 steps × 2 balls × ~30 segment tests ≈ 0.4 ms;
recomputed only when the memo key changes: `angle|power|switchMask|balls[0].x|y|balls[1].x|y`.

### 4.8 Switch semantics (#47, #23)
Held means held. The plate releases the tick the ball leaves contact; no latch and no timer. Co-op works because
levels have two plates / two routes (level agent's job) and because a resting ball keeps pressing while the OTHER ball
shoots. Solo plays both balls so the same levels work. `restartLevel`/`createSim` set every switch to `false`;
the first stepped tick recomputes them from the fresh ball positions (never stale, fixes the URL-load case).

### 4.9 Sink cannot be skipped by speed (#22) — swept cup test
Each tick, after step 10, with `h = level.hole`:
```
near    = |pos.y + R - h.rimY| <= 8 && (grounded || groundAt(...)?.y - (pos.y + R) <= 8)
crossed = (startX - h.x) * (pos.x - h.x) <= 0          // x-span of this tick straddles the cup
over    = |pos.x - h.x| <= h.radius - SINK_INSET        // 12 px window
if near && (over || crossed):
   if len(vel) <= SINK_MAX_SPEED (240): sunk = true; pos = {h.x, h.rimY + SUNK_BALL_DROP}; vel = {0,0}; asleep = true; emit sink{speed}; return 0
   else if crossed: vel = {x: vel.x * LIP_OUT_DAMP, y: vel.y}; emit lipOut (at most once per tick)
```
`crossed` uses the tick's full x-span, so even at 1100 px/s (18 px/tick) the 12 px window cannot be stepped over.

### 4.10 Other audit items touched by physics
- #21 camera: gone from the sim. #25 per-player aim: `players[i].aim`. #27: every failure now emits an event
  (`fellOffWorld`, `hazardBlock`, `lipOut`, `nearCup`). #48 colour gates are tall walls (validity ≥ `MIN_WALL_HEIGHT`
  120 px) so they cannot be hopped at 373 px max height unless the level puts a ceiling piece above them; the level
  agent decides per level (the solver's sweep proves it).
- Wind in World 1 is 0, but `wind` stays in the integrator (airborne only) and in `predictShot` so a later world can use it.
- Ball–ball collision: none (locked). Balls may overlap at the tee; tees are ≥ `MIN_TEE_SEPARATION` apart.

## 5. The gimme rule
After a ball comes to rest (step 12, same tick `asleep` becomes true) and is not sunk:
```
d = distanceToCup(level, pos)            // from the ball's bottom point (pos.x, pos.y + R) to (hole.x, hole.rimY), vec.len
if d <= GIMME_RADIUS (34):
   strokes += 1 (returned to stepSim, which adds it to players[ballIndex].strokes)
   sunk = true; pos = {hole.x, hole.rimY + SUNK_BALL_DROP}; vel = {0,0}
   emit gimme{strokes: <level total after the +1>}
else if d <= NEAR_CUP_RADIUS (90): emit nearCup{distance: d}
```
- Only on the rest TRANSITION, never while rolling, so a ball that rolls past the cup at 300 px/s is a lip-out, not a gimme.
- The +1 is the concession stroke (what a real "gimme" costs); the HUD shows "GIMME! +1" and the view plays a
  0.5 s hop-into-cup animation driven by the `gimme` event, then SNAPS the render ball to the cup (the sim already
  considers the ball sunk; the turn delay of 0.45 s plus the results card timing covers the animation).
- Tunable: `GIMME_RADIUS` only. 34 px = 12 px sink window + 22 px fringe ≈ "a ball's width from the lip". If playtests
  say it feels generous, 28; if it feels stingy, 40. Never larger than `hole.radius + 3·R` (52) or holes stop
  mattering.
- Turn flow: the gimme happens inside the flying phase's settle, so `stepSim` sees the ball as settled+sunk and proceeds
  exactly as after a real sink (other ball's turn, or `levelResults` if both are in).
- Test (`cup.test.ts`): rest at 20 px ⇒ gimme, strokes +1, sunk; rest at 60 px ⇒ nearCup, strokes unchanged; a ball
  that stops exactly on the rim edge at `d = 34.0` ⇒ gimme (inclusive).

## 6. Initial state literals (shared by `createSim`, `restartLevel` and the lead's stub `createSim`)

```ts
const start = level.starts[i];                         // already quantize2'd by compileLevel
balls[i] = { pos: start, vel: { x: 0, y: 0 }, asleep: true, sunk: false, grounded: true, restTicks: REST_TICKS, lastRest: start };
players[i] = { strokes: 0, aim: DEFAULT_AIM };          // DEFAULT_AIM is frozen; sharing the object is safe
switches = Object.fromEntries(level.switches.map((s) => [s.id, false]));   // evaluateSwitches runs on the first stepped tick
activePlayer = levelIndex % 2; turnDelayTicks = 0 (intro) ; phase 'intro'
```
A ball created asleep on a tee that sits inside an active fan is woken on the first tick (step 1), which is
intentional and a validity test forbids tees inside fans so it never happens in shipped levels.

## 7. Aim handling inside the sim (lossless invariant)
`setAim` handler in `stepSim`:
```ts
const angle = quantize4(clamp(cmd.angle, AIM_ANGLE_MIN, AIM_ANGLE_MAX));   // bounds are 4-dp exact, so the result stays in range
const power = quantize1(clamp(cmd.power, MIN_POWER, MAX_POWER));
players[activePlayer] = { ...players[activePlayer], aim: { angle, power } };   // only when changed (dedupe: no new object otherwise)
```
`launchVelocity(aim)` therefore uses exactly the numbers the partner receives in `PlayerSnap`, keyboard integration
can never leak arbitrary doubles into state, and `decodeSnapshot(encodeSnapshot(s))` deep-equals `s` whenever both
balls are settled.
