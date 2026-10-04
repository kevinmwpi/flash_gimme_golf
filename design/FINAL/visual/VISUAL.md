# Flash Golf — FINAL visual spec (synthesis of the visual track)

Files in this folder: `VISUAL.md` (this spec), `mockup.html` → `mockup.png` (gameplay frame: local 2P, hole "Plate & Bridge", Red parked on switch A, Blue mid pointer-drag), `mockup-title.html` → `mockup-title.png`. Both pages are 1280×720, Canvas 2D for the world + DOM for the HUD, exactly as the real build (React renders the same DOM). All drawing functions in the mockup are written to be lifted into `src/view/render/` (§19).

## 0. Verdict: which proposal won and what was grafted

**Winner: `chunky`** (ranked first by all three judges, 8.2 / 8.5 / 8.5). It is the only proposal that matches locked decision 8 literally (flat fills, exactly one hard shade band, one 4 px `#241b33` outline weight, sky as the only gradient, Fredoka 700, paper HUD, red/blue reserved for players). Its palette, outline rules, golfer, cup, background, title screen, HUD skin and port map are kept as the base.

Grafted and now visible in `mockup.png`:

| From | Idea | Where in this spec |
|---|---|---|
| doodle | Colour-gate badge shows BOTH outcomes: `[owner ball + mint check] [other ball + ink cross]` on one paper badge mid-field | §4 colour gate |
| doodle | Player chips carry a status line (`AIMING` / `HOLDS SWITCH A` / `WAITING` / `IN THE CUP`) | §11 chips |
| doodle | Chasm is a dark pit (`#4a2d18 → #1a0d05`, jagged rock silhouette) with the fall-penalty sticker hanging in it before anyone falls | §4 chasm |
| doodle | Golfer face set (`smile / focus+tongue / wow / grin / sad`), idle fidget, BOTH golfers celebrate | §6 |
| doodle | Pointer drag visuals: dashed ink rubber band + ring at the pointer, red-band cancel state; partner's live aim at 55 % | §10 |
| doodle | Single `src/view/copy.ts` for every world/callout string | §17 |
| glossy | Bumper = half-dome r 22 centred on the surface line with white pinball ring and three spark ticks (flat shaded, no gloss) | §4 bumper |
| glossy | Sand = sunken 16 px band following the surface polyline with a pale scallop line and dots (not a lozenge on the grass) | §4 sand |
| glossy | Switch lamp (off `plateSh` / on `mint` + flat 35 % halo) and state words in the stickers: `SWITCH A · ON`, `BRIDGE A · ON/OFF`, `GATE A · OPEN/SHUT` | §4 switch/bridge |
| glossy | Sticker placement rules: BRIDGE sticker 18 px below the beam inside the chasm, FAN sticker under the housing, sun at (868,128) with the rule y ≥ 100, x ≤ 900 | §5, §9 |
| glossy | Turn marker numbers: 24×16 player-colour triangle 122 px above the feet, bob ±4 px at 6 rad/s | §10 |
| glossy | `labelScale = clamp(1/scale, 1, 1.8)` on top of constant-screen-scale stickers; hint hidden after 3 shots on holes > 1 | §3, §11 |
| glossy | Spring plate enlarged to 56×14 with two stacked white up-chevrons so it reads "launches up" without the sticker | §4 spring |
| glossy | Results verdict copy in medal colour; per-player strokes as two identical inactive chips | §15 |

Resolved judge concerns (each is a rule below): red/blue exclusivity audited on every graft (§1); gate shows pass AND block in Fredoka 700 ≥ 14 px (§4); every switch/bridge/gate carries a LETTER and a drawn wire (§4, §5); stickers at constant screen scale with `labelScale` (§3); no gradients beyond sky + pit, no `shadowBlur` anywhere, glow = flat 35 % ring (§2); HUD stays paper (§11); fall penalty readable before the first fall and copy identical to the callout (§4, §17); density budget (§5); flush surface props (§4); aim preview from the real `predictShot` every 4th tick (§10); sticker font ≥ 14 px except the 13 px pit sticker on narrow gaps (§5); golfer 98 px vs ball r 12, parked ball 8 px lower on a pressed cap (§4, §7); title keeps the server pill and the two-tone O (§16); pointer drag + partner aim specified (§10); one stage transform for canvas + HUD (§11); overview validation frame required before the port (§18); font loading + re-measure (§12); walk/hop rules (§6); co-op framing copied into results/tray (§15, §16).

Deliberate deviations from the judges, with reasons: the switch base stays metal (not hazard-striped yellow) because yellow + ink stripes is the SPRING's signature and the two must not share a look; lamps are `mint` on / `plateSh` off (never red/green — red is Red's colour); the angle readout lives in the DOM power meter (ARCH 1.9 + UX final), not in a canvas pill beside the arrow; callout copy follows the UX copy sheet (`OUT OF BOUNDS · +1`, `WRONG COLOUR`, `IN THE HOLE!`) rather than the judges' `OUT! +1` / `NOPE!`, so there is one copy source.

Alignment with sibling tracks (names are contracts): players are **RED / BLUE** (`PLAYER_NAMES` in `src/sim/types.ts`), never "P1/P2" in the UI; switches are lettered **A, B** from their index in `level.switches`; `BALL_RADIUS = 12`, `GIMME_RADIUS = 34`, `SHOT_SPEED_PER_POWER = 6.8`, `DRAG_FULL_POWER_PX = 220`, `DRAG_CANCEL_RADIUS_PX = 18`, `DRAG_GRAB_RADIUS_PX = 56`, `TURN_DELAY_TICKS = 27` are read from `src/sim/types.ts`; HUD clusters follow `FINAL/ux/hud-layout.html` (six anchored clusters, power meter bottom-left); event names follow `architecture/types.ts` `SimEventBody`.

---

## 1. Palette tokens (`src/view/render/palette.ts`; CSS custom properties generated from it)

Naming: `X` = flat fill, `XSh` = its single darker shade. No hex may appear outside `palette.ts`; the HUD CSS `:root{--ink:#241b33;…}` block is generated from the same object (kebab-case names).

| Token | Hex | Used for |
|---|---|---|
| `ink` | `#241b33` | every outline, canvas text, hard shadows, cup hole, spring slot, toasts |
| `paper` / `paperSh` | `#fff8e7` / `#e9dcc0` | stickers, HUD cards, meters, teach tags |
| `sky1` → `sky2` | `#3fb6ff` → `#c9f1ff` | sky gradient (vertical, y 0→560) |
| `sun` / `sunSh` | `#ffd93b` / `#e0a800` | sun disc, LOCAL 2P button, level number badges, gold medal, spring plate |
| `cloud` / `cloudSh` / `cloudInk` | `#ffffff` / `#d4e9f8` / `#3f6f9c` | clouds (3 px sky-tinted outline) |
| `hillFar` | `#a9e3b7` | far hills, no outline |
| `hillMid` / `hillMidInk` | `#6fcb73` / `#2f7a4b` | mid hills (3 px outline), lollipop tree trunks/outlines; tree fill `tree #3f9f4c` |
| `grass` / `grassSh` | `#6ad636` / `#45b02a` | 24 px grass band; shade = 15 px band inside it (y+15..y+30) |
| `dirt` / `dirtSh` | `#c97f3d` / `#a3602a` | terrain body; shade = 12 px band under the grass + stone blobs |
| `pitTop` → `pitBot` / `rock` | `#4a2d18` → `#1a0d05` / `#3b2516` | chasm pit gradient (y 540→720) and the jagged rock silhouette |
| `sand` / `sandSh` / `sandLine` | `#f5d98a` / `#d9b35c` / `#fff1b0` | sand band, lower shade band + dots, scallop line |
| `spring` / `springSh` / `coil` | `#ffd93b` / `#e0a800` / `#d6dcea` | spring plate (ink stripes), coil, club shaft |
| `bump` / `bumpSh` | `#ff9f1c` / `#e07a00` | bumper dome; also the `warn` colour (over par, fall-penalty sticker dot) |
| `fan` / `fanSh` | `#8d93a8` / `#6a7088` | fan housing; shared "metal" with switch base (`plate`/`plateSh`), bridge posts, club head |
| `wind` / `windLine` / `windAccent` | `rgba(140,230,255,.40)` / `rgba(255,255,255,.9)` / `#7fe7ff` | fan column, chevrons, FAN sticker dot |
| `sw` / `swSh` | `#b57bee` / `#8f55cc` | switch cap, letter tags, wires, SWITCH/BRIDGE/GATE sticker dots. Every `PressureSwitch.colour` in World 1 is `#b57bee` (validity test); pairs are told apart by LETTER + wire, not by hue |
| `plank` / `plankSh` | `#d89a4b` / `#b97a33` | bridge planks |
| `mint` / `mintSh` / `mintHalo` | `#44d67a` / `#2aa85a` / `rgba(68,214,122,.35)` | lamps ON, "to spare" chip, SOLO button, GIMME!/IN THE HOLE! callouts, gate check mark |
| `p1` / `p1Sh` | `#ff5d73` / `#d63d55` | RED: ball, cap, shirt, chip, red colour gate, RED ONLY dot |
| `p2` / `p2Sh` | `#50b7ff` / `#2f8fd6` | BLUE: ball, cap, shirt, chip, blue colour gate, ONLINE button, PAR pill |
| `skin` / `shorts` / `shortsSh` / `tongue` | `#ffcf9e` / `#3f3a5a` / `#2d2944` / `#ff8aa8` | golfer |
| `gold`/`goldSh`, `silver`/`silverSh`, `bronze`/`bronzeSh` | `#ffd93b`/`#e0a800`, `#e3eaf4`/`#9fb0c6`, `#e0905a`/`#a5612a` | medals |
| `shadow` | `rgba(36,27,51,.28)` | contact shadows (ellipses) |
| `letterbox` | `#10263d` | page background outside the 1280×720 stage |

**Red/blue exclusivity (audited):** no non-player element uses a red or blue FILL. Switch = purple, spring = yellow, bumper = orange, fan = grey/cyan, lamps mint/grey, flag chequered white/ink, fall-penalty sticker dot = `bump`, gate cross = ink, sad tear = `p2` at r 2 (tiny, on a face, acceptable). The only red/blue outside players: colour gates (which ARE the player colours) and the split medal ribbon (means "team").

## 2. Outline and shading rules

1. **Outline weight:** 4 px `ink` on anything ≥ 20 px (terrain, props, balls, golfer body, cards); 3 px on small parts (shoes, collar, hands, flag, posts, badges); 2.5 px on dots ≤ 12 px. Joins/caps `round`. Outline is stroked AFTER the fill (chunky `fs()`), so the outline straddles the geometry edge.
2. **Screen-pixel rule:** `lineWidth = clamp(OUTLINE * scale, 2, 4) / scale` world units, i.e. 4 screen px at scale 1, never below 2 screen px in overview (scale ≈ 0.64 on a 2 000 px level) and never above 4. A 12 px ball at scale 0.3 therefore gets a ~6.7 world-px (2 screen-px) outline, not 13.
3. **One shade per material.** Light is top-left. The shade is a flat band: bottom 6–10 px of a prop, right-hand 10 px of a shirt/cap, lower third of a dome, lower 15 px of the grass band. Never a second shade, never a highlight tint, never a gradient (sky and pit excepted), never blur.
4. **No `shadowBlur`, ever.** Live state is a flat 35 % ring (`mintHalo` r 11 around a lamp) or a plank slide-in. `prefers-reduced-motion` disables shake and callout scale-ins (fade only).
5. **Shade bands without save/clip/restore where possible:** for rounded rects draw the shade as a second `roundRect` path of the same radius intersected by a `fillRect` only inside the cached terrain layer; animated props (switch cap, planks, fan blades/chevrons, gate field, bumper flash) may use one clip each. Budget: ≤ 8 clips per frame outside the cached layer.
6. **Union outlines:** composite shapes (clouds, golfer silhouette parts that overlap) stroke the union thick (2× outline) first, then fill, then clip-paint the shade band. No interior lines between blobs.
7. **Rounded everything:** every rect r ≥ 4; terrain polylines rendered with r = 18 corner rounding (`appendRounded`) while the sim keeps the raw polyline (deviation ≤ 4 px at convex vertices, hidden under the outline).
8. **Hard shadows:** cards and stickers cast a solid `ink` offset shadow (0, 5 px) (stickers (0, 3)); buttons (0, 7 px) plus an inset 7 px shade band. No alpha, no blur.
9. **Contact shadows in-world:** ellipse 0.9 r × 0.32 r in `shadow` under every ball (on `surfaceY(x)` from `src/sim/terrain.ts`) and 22×6 under every golfer; airborne things visibly leave the ground.
10. **Highlights:** one white ellipse (0.3 r × 0.2 r, −35°, at (−0.32 r, −0.36 r)) on balls and the sun only.

## 3. Space, camera, scale (what is world-scaled and what is not)

- World layers are drawn under `ctx.setTransform(dpr*scale, 0, 0, dpr*scale, offX*dpr, offY*dpr)` where `scale` = 1 in follow mode and `min(1280/level.width, 1)` in overview (`cameraFor` in `view.ts`).
- `worldToScreen(p) = ((p.x − cam.x) * scale + offX, (p.y − cam.y) * scale + offY)`.
- **Stickers, callouts, the turn marker, the drag rubber band ring and the landing X are drawn AFTER resetting to the DPR-only transform at `worldToScreen(anchor)`**, so they keep screen size in overview and on phones. Their size is additionally multiplied by `labelScale = clamp(1/scale, 1, 1.8)` when the CANVAS CSS scale (stage scale) drops below 0.6 (phones), so a 15 px sticker stays ≥ 15 CSS px.
- Mechanic silhouettes, balls, golfers and particles scale with the world (they must line up with physics).
- Follow camera: active ball at 45 % width, y fixed 0, zoom 1, lerp 8/s; clamped to `[0, level.width − 1280]`. Overview: whole level, ground band at ~70 % height.

## 4. Mechanic shape language (all flush with the surface; one sticker each)

Common: silhouette in world px relative to the surface `y` at the prop centre; a paper **sticker** (§5) 20–40 px above (exceptions noted) in Fredoka 700 15 px uppercase with a 6 px accent dot in the mechanic colour. "Guess" is the acceptance test: a first-time player says this before touching it.

| Mechanic (sim kind) | Silhouette | Fill / shade | On-object icon | Sticker copy | Guess | Live state / feedback |
|---|---|---|---|---|---|---|
| **Sand** (`sand`) | sunken band 16 px deep following the surface polyline across `[x, x+w]` (8 samples of `surfaceY`), vertical ends, 4 px ink; the band REPLACES the grass cap there | `sand`; shade `sandSh` lower 6 px; `sandLine` 2.5 px line 4 px under the surface; `sandSh` dots r 1.8 every 12 px alternating ±2 px | dotted texture | `SAND` dot `sandSh` | "soft, slows the ball" | `enterSand`: 6 beige puffs, ball squash 1.15×0.85 120 ms, sticker pulses 1.2× 200 ms, trail colour → `sandSh` while inside |
| **Spring** (`spring`) | ink slot 40×32 from y−2 down; `coil` zigzag 3.5 px (5 turns); plate **56×14** r 5, top at y−6 (6 px proud), ink diagonal stripes pitch 12; **two stacked white up-chevrons** 18 px wide at y−16 and y−28 (ink 8 px under white 3 px) | `spring`; shade `springSh` bottom 4 px | chevrons = "up" | `SPRING` dot `spring` | "launches me up" | `spring`: plate squashes to 56×4 for 2 frames then overshoots to 56×18; 8 `sun` sparks r 5 in an up-cone 400 ms; chevrons fly up 20 px and fade 300 ms; shake 3 px/120 ms; callout `BOING!` |
| **Bumper** (`bumper`) | socket ellipse rx 27 ry 6 at y+1 (`dirtSh`, 3 px ink); **half-dome r 22 centred ON the surface line** (upper half visible); white ring r 10 (4 px) at y−4 with an ink ring r 5.5 (2 px) inside, clipped to the dome; three spark ticks 8 px long at −135°, −90°, −45° from r 27 to 35 (ink 8 under white 3) | `bump`; shade `bumpSh` lower 7 px of the dome | ring + ticks = pinball bumper | `BUMPER` dot `bump` | "pinball bumper, bounces me away" | `bumper`: dome flashes white 2 frames, ring expands 12→40 px 200 ms at .6 alpha, ticks pop outward 6 px; shake 4 px/100 ms; callout `BONK!` |
| **Fan** (`fan`) | housing 56×30 sunk 8 px (top at y−8); ink propeller disc r 11 with four `coil` blades; two ink grille bars; column `rect.w` wide (48 in the mock) from `rect.y` to y−8, `wind` fill, r 14, 2.5 px dashed white edge [8,7]; white chevrons 22 px wide every 34 px | `fan`; shade `fanSh` lower 14 px | rising chevrons + blades | `FAN` dot `windAccent`, **placed 34 px under the housing** (centre y+42) so the column top never collides with the arc or landing X | "blows the ball up" | always animated: chevrons scroll up 60 px/s, blades 2 turns/s; `fan` event: 3 white streak particles/tick on the ball, chevron speed ×2 for 300 ms |
| **Colour gate** (`colourGate`, `colour: 'red'|'blue'`) | two 32×20 emitters (bottom sunk 14 px, top floating at `top−6`); 20 px field between at alpha .42 with white 4 px diagonal stripes every 16 px and 3 px solid colour edge lines; **both-outcome badge** mid-field: paper 76×28 r 8 (3 px ink, (0,3) shadow) holding `[owner ball r 7 at −24] [mint check 3.5 px over ink 7 px at −14..−2] [other ball r 7 at +10] [ink cross 3.5 px at +21..+31]` | `p1`/`p1Sh` or `p2`/`p2Sh` | badge = who passes, who bounces | `RED ONLY` / `BLUE ONLY`, dot in the gate colour, 30 px above the top emitter | "red goes through, blue bounces" | `gatePass`: field alpha .42→.15 for 200 ms, stripe scroll ×3; `hazardBlock`: field solid for 3 frames, the blocked glyph half of the badge scales 1→1.6→1 over 150 ms, ball squash 0.7×1.3, 5 gate-colour sparks, callout `WRONG COLOUR` (white fill), sticker pulses 1.3× 400 ms |
| **Pressure switch** (`PressureSwitch`) | base 64×14 r 6, top at y−4 (metal); cap **52**×(14 up / 6 pressed) r 6 in `sw` with 6 px of skirt below; **letter tag** circle r 8 `sw` at the base's LEFT end with the letter (11 px white); **lamp** r 6 at the RIGHT end; dotted `sw` wire 4 px [2,7] from the lamp down 46 px then along the dirt to the linked rect's post | `plate`/`plateSh`; cap `sw`/`swSh` (shade lower 8 px) | letter + lamp + wire | `SWITCH A` → `SWITCH A · ON` while pressed; dot `sw` | "park a ball on it to turn A on" | `switchOn`: cap drops 14→6 over 60 ms (ball visibly sinks 8 px), 4 ink squish lines, lamp `plateSh`→`mint` with `mintHalo` r 11, wire `plateSh`→`sw`; `switchOff`: cap pops with 30 ms overshoot, lamp/wire grey; callout `SWITCH HELD` (small, 20 px) once per press |
| **Bridge** (`bridge`, `switchId`) | plank slab gap-width × 18 r 4, 3 px ink seams every 26 px; two 10×26 metal posts at `x1+8`, `x2−8` with lamps r 6 at `y−28` | `plank`/`plankSh` bottom 6 px | lamps (same language as the switch) | `BRIDGE A · ON` / `BRIDGE A · OFF`, dot `sw`, **centre 32 px below the beam top (inside the chasm)** | "the switch with the same letter makes this solid" | off: 3 px dashed ink @ .45 outline only, lamps grey; `bridgeToggle{active:true}`: planks slide in from both posts 200 ms, lamps light; `active:false`: planks slide out 150 ms + 4 `plank` chips; callout `BRIDGE OPEN` / `BRIDGE GONE` |
| **Blocker gate** (`blocker`, `switchId`) | 24 px wide barrier of ink/`sun` hazard stripes (45°, pitch 10) between two metal posts with lamps | `sun`/`sunSh` | stripes + letter tag on the top post | `GATE A · SHUT` / `GATE A · OPEN`, dot `sw` | "a door the switch opens" | retracts into the bottom post over 200 ms when its switch is held; lamps as above |
| **Cup** (`Hole`) | hole ellipse 34×12 `ink` (3 px); pole 6×78 white at x−3; **chequered** flag 34×24 (4×3 cells white/ink) at (x+3, y−80); **gimme ring**: dashed white ellipse rx = `GIMME_RADIUS` (34) ry 8 [6,5] with .28 white fill — its width IS the tunable radius | — | flag | none (level 1 only: `GIMME ZONE` 13 px shown until the first `gimme` callout) | obvious | `nearCup`: ring pulses 1.0→1.15 at 3 Hz; `gimme`: ball slides to the hole 400 ms, flag wiggles, callout `GIMME!`; `sink`: flag jumps 10 px, 12 confetti, callout `IN THE HOLE!`; `lipOut`: callout `SO CLOSE` |
| **Chasm** (`Gap`) | dark **pit**: vertical gradient `pitTop`→`pitBot` from y 540 to 720, 6 px wider than the gap; jagged `rock` silhouette along the bottom 30 px; a paper sticker **`OUT OF BOUNDS · +1`** (13 px, dot `bump`, rot +4°, alpha .92) centred in the gap at y 626 (below the BRIDGE sticker if any) | — | the sticker IS the rules text | as left | "falling costs a stroke" | `fellOffWorld`: ball shrinks into the pit with trail 300 ms, screen edge flashes ink .2 for 2 frames, shake 6 px/250 ms, ball pops in at `respawnPos` (scale 0→1.2→1 200 ms), golfer `sad`, callout `OUT OF BOUNDS · +1` (fill `bump`) |

Terrain: dirt body + 24 px grass band + 12 px `dirtSh` band + 11 deterministic stone blobs + tufts every 74 px (3 px `grassSh`). Side faces are part of the same outlined path so cliffs read as solid. Ceilings/overhangs (allowed by brief §12): same recipe upside down, no grass, 14–22 px ink stalactite triangles along the underside.

## 5. Sticker rules

1. **One sticker per mechanic**, 15 px Fredoka 700 uppercase, paper, 3 px ink, r 8, (0,3) ink shadow, accent dot r 6 at the left, rotated alternately ±2–4° by index. Height = size + 12. Exceptions: pit sticker 13 px (fits a 170 px gap: 156 px wide); if a gap is narrower than the sticker + 24 px the pit sticker is drawn on two lines (`OUT OF BOUNDS` / `+1`).
2. **Copy** comes from `copy.ts` (§17) plus the level's `label` field when present (`RectBase.label`, `PressureSwitch.label`); the letter is `String.fromCharCode(65 + index of the switch in level.switches)`, and every rect that references `switchId` uses the same letter. State suffixes (` · ON`, ` · OFF`, ` · OPEN`, ` · SHUT`) are appended by the renderer from `SimState.switches`.
3. **Placement:** default centre = prop centre x, y = silhouette top − 30 (sand/bumper/spring/switch), BRIDGE 32 px below the beam top, FAN 42 px below the housing top, gate 30 px above the top emitter, pit sticker at y 626. If two stickers' boxes overlap, the later one (by x order) is moved 26 px higher; if a sticker's box intersects a golfer's head box (r 19 at feet−76) it is shifted 56 px away from the golfer along x (the mock shifts SWITCH A left to x 236).
4. **Constant screen scale** (§3) with `labelScale`. Stickers are measured once per level after `document.fonts.ready` and re-measured if the font resolves later.
5. **Visibility:** always on in World 1. Alpha fades to .35 over 100 ms while a ball's drawn circle overlaps the sticker box and back to 1 within 300 ms after. Never hide the sticker of the mechanic the ball is interacting with (events pulse it instead).
6. **Density cap:** at most 6 stickers in one 1280 px window plus the pit stickers; no decorative text in the playfield (no face sun, balloon, birds, name tags); `GIMME ZONE` only on hole 1; at most 2 transient callouts on screen (newest replaces oldest); callouts are never drawn over the landing X (offset +60 px up, and +40 px further if they would overlap it).

## 6. Golfer character (`src/view/render/entities.ts: drawGolfer`)

Facing `f` = +1 right / −1 left; `gy` = feet y. Height 98 px, head 39 % (chibi). Draw order bottom-up, 4 px ink (3 px small parts).

| Part | Shape (x rel. centre, y rel. feet) | Colour |
|---|---|---|
| contact shadow | ellipse 22×6 at (0,+2) | `shadow` |
| legs | two 10×18 r 4 at x −9 / +3, y −20..−2 | `skin` |
| shoes | two 16×9 r 4 at x −11 / +1, y −8..+1 | white |
| shorts | 32×16 r 6 at y −32..−16; shade lower 8 px | `shorts`/`shortsSh` |
| shirt | 38×30 r 10 at y −58..−28; shade 10 px band on the side away from the light | player / shade |
| collar | 16×8 r 3 at y −60 | white |
| head | circle r 19 at (0, −76) | `skin` |
| cap | half-disc r 19 raised 2 px; brim 26×9 r 4 on the facing side at y −84; button r 4.5 at (0, −96); shade 12 px band back-right | player / shade |
| eyes | ink dots r 2.8 at (5f, −73) and (13f, −73) | `ink` |
| mouth | arc r 4.5 at (9f, −68), 27°..153°, 2.5 px | `ink` |
| cheek | circle r 4 at (−6f, −68) | `rgba(255,93,115,.35)` |
| arm | capsule from shoulder (12f, −52) to the hand; 14 px ink under 8 px player colour | player |
| hand | circle r 6.5 white, 3 px ink | white |
| club | 7 px ink under 3 px `coil` from hand to club end; head 16×10 r 4 `plate` | `coil`/`plate` |

**Faces** (`face: 'smile' | 'focus' | 'wow' | 'grin' | 'sad'`): `smile` default; `focus` = back eye open, front eye a 6 px squint line, raised brow line (9f..17f, −80..−82), small mouth, **pink `tongue` 8×9 r 4 out of the mouth corner when power > 60**; `wow` = eyes r 3.2 + round ink mouth r 4 (swing contact frames); `grin` = white half-disc mouth r 6 with 2.5 px ink (cheer); `sad` = inverted arc + one `p2` tear 2×3 at (15f, −67). Blink every 3–5 s (eyes scaleY 0.1 for 80 ms). Idle fidget every 4–7 s while waiting (one of: scratch head = hand to (4f, −98) 600 ms; tap club = club end bobs 6 px twice; look at partner = eyes shift 2 px toward the other golfer for 1 s).

**Poses** (hand / club-end offsets, `f` applied to x):
- `idle`: hand (18, −30), club end (30, −1); breathing scaleY 1.00→1.03 over 1.2 s pivoting at the feet.
- `aim` (whole aiming phase, face `focus`): hand (−18, −66), club end (−34, −114) at power 100; interpolate linearly from idle at power 0.
- `swing` on `ballHit` (220 ms, face `wow` 0–150 ms): t 0 = aim pose → t 90 ms contact: hand (18, −30), club end (30, −1), body leans 8° toward the shot → t 220 ms follow-through: hand (26, −34), club end (44, −72) → ease back to idle 250 ms. Contact frame spawns the hit puff.
- `watch` (own ball in flight): eyes shift toward the ball's x; when the ball is > 500 px away the free hand shades the eyes at (6f, −92).
- `walk` (view-only hand-off on `turnStart`, ≤ 350 ms): target = 42 px behind the ball's `lastRest` (facing the ball), bob y −3/0 at 8 Hz, legs alternate scaleY 1.2/0.8. Position is computed from the ball's rest position, never by interpolating along the previous tee. **If the straight line to the target crosses a `Gap` without an active bridge the golfer hops (y −24 parabola) only when the ball itself crossed that gap this turn; otherwise it teleports with a 120 ms pop (scale 0→1.1→1) at the target** so it never walks on air.
- `cheer` on `sink`/`gimme` (both golfers, 800 ms, face `grin`): arms up (hand (10, −100)), 3 hops of 14 px, cap pops 6 px on the first hop.
- `sad` on own `fellOffWorld` / `hazardBlock` (600 ms): head tilts 12°, arm drops to (10, −20), face `sad`.
- `wave` (title only): hand (30f, −96), no club.

Inactive golfer is drawn at full opacity (co-op must stay visible). Which golfer is "mine" online: a 12 px white-on-player-colour `YOU` tag 22 px above my golfer's cap for the first 6 s of each level and whenever it is my turn (UX §4.5).

## 7. Ball (`drawBall`)

Drawn at `BALL_RADIUS` (12) with the 4 px ink outline straddling the physics edge. Fill = player colour, white highlight ellipse. Rolling: the highlight orbits by `distance / r` radians. Airborne: squash along the velocity vector, scale (1 + |v|/2400, 1 − |v|/2400) clamped to [0.85, 1.15]. Trail (view state): 6 ghost discs at the last 6×2 ticks, r 10→4, alpha .35→.05, player colour; cleared on rest and on respawn. A ball resting on a pressed switch sits 8 px lower (the cap height difference), which is what the sim's `SWITCH_CONTACT_TOLERANCE` already produces. Sunk ball: `sinkT` shrinks it 1→0 over 250 ms into the hole ellipse.

## 8. Cup, flag, gimme ring

As in §4 Cup. Flag waves as a 2-frame flip (cells skew ±6°) at 2 Hz; never red or blue (chequered white/ink, finial none). The gimme ring's rx is `GIMME_RADIUS` read from `src/sim/types.ts`; if the constant changes the art follows.

## 9. Background layers and parallax (follow camera scrolls x only)

| Layer | Content | Parallax | Notes |
|---|---|---|---|
| sky | gradient `sky1`→`sky2` y 0→560, flat `sky2` below | 0 | fills 1280×720 before the camera transform |
| sun | disc r 44 at **(868, 128)** + halo r 62 @ .28 white + `sunSh` band below y 154; rule: y ≥ 100 and x ≤ 900 so it never sits under the chips/buttons or a turn banner | 0 | hidden behind a transient banner is fine |
| clouds | 3 blobs (5 circles, scale 0.8–1.15) at y 92–176, 3 px `cloudInk` union outline, flat `cloudSh` underside | 0.15 + drift 6 px/s | tile every 1600 px |
| far hills | rounded polyline 380–470, `hillFar`, no outline | 0.25 | tile every 1280 px |
| mid hills | rounded polyline 455–520, `hillMid` + 3 px `hillMidInk`, 5 lollipop trees | 0.45 | tile every 1280 px |
| pit | §4 chasm gradient + rocks, per gap | 1.0 | drawn before terrain |
| terrain | pieces + tufts | 1.0 | cached per level per DPR (§18) |
| props / wires / bridges / gates / cup / golfers / balls / aim / particles | §4, §6, §7, §10 | 1.0 | |
| stickers / callouts / turn marker / drag ring / landing X | §5, §10, §14 | 1.0 anchor, screen-scale size | drawn after resetting the transform |

Decoration budget: clouds, sun, two hill bands, lollipop trees, tufts, stones. Nothing else (no balloon, birds, face sun, boil, hatching) in the gameplay frame.

## 10. Aim, drag and turn visuals (`src/view/render/aim.ts`)

- **Preview:** `ViewState.aimPreview` is filled from `predictShot(level, state.switches, ball, playerId, aim)` (ARCH 1.4) on every `setAim`; the renderer draws one dot per **4th tick** (`points.filter((_, i) => i % 4 === 3)`), max 40 dots, r 5 → 2.5 shrinking by 0.18 per dot, player-colour fill with 2.5 px ink outline. Dots stop at `landing`; the **landing marker is an X of two 22 px strokes** in the player colour over ink (3.5 over 8.5 px), centred on the contact point. Hidden while `turnDelayTicks > 0`, while flying, and in `intro`/results phases.
- **Turn marker:** 24×16 player-colour triangle (4 px ink, `Sh` band on the right third) pointing down, apex 122 px above the active golfer's feet, bob ±4 px at 6 rad/s. Also appears on the partner's golfer online when it is their turn.
- **Pointer drag (brief 10):** on press within `DRAG_GRAB_RADIUS_PX` (56) of the active ball (or anywhere on the lower half on touch), draw a dashed `ink` 4 px [6,6] **rubber band** from the ball centre to the pointer and a 12 px ring (white .85 fill, 3 px ink) at the pointer; below `DRAG_DEAD_ZONE_PX` (14) only the ring shows. Power = `(|d| / 220) * 90 + 10`; the HUD meter mirrors it live. **Cancel state:** when the pointer is within `DRAG_CANCEL_RADIUS_PX` (18) of the press point the band turns `p1Sh` red, the ring gets a 2 px ink cross, and a 12 px paper sticker `CANCEL` appears 32 px above the ball; releasing there emits no `shoot`. Aims pointing downward (clamped by the sim) draw the band in `bump` with a 12 px sticker `AIM UPWARD`.
- **Keyboard / gamepad:** same arc and marker; no band. Angle/power numbers live only in the DOM meter (§11).
- **Partner's live aim (online, brief 15):** the partner's `setAim` arrives in snapshots; draw the same dots + X in their colour at **55 % alpha** plus a 14 px world tag `BLUE AIMING` (white on `p2`, 3 px ink) 40 px above their ball; the HUD meter shows their power tinted in their colour (UX §4.5). No rubber band.
- The mockup uses a closed-form 1/60 integration only for the picture; the port never does.

## 11. HUD (React/DOM, `src/ui/Hud.tsx`; boxes in 1280×720 logical px)

**Stage rule (one layout system):** the canvas AND the HUD live inside one `.stage` div 1280×720 scaled by a single `transform: scale(stageScale)` (stageScale = `min(vw/1280, vh/720)`), centred with `translate(-50%,-50%)`. HUD clusters are anchored to the six corners/edges and additionally scaled by `hudScale = clamp(0.9/stageScale, 1, 1.7)` from their own anchor, so a 48 px button is never under 43 CSS px. Below `stageScale 0.85` the `.compact` class applies: level name hidden, chips collapse to dot + status + count, team card 200 px, hint max 300 px; on touch the meter hides while not dragging. The letterbox around the stage is `letterbox`.

All cards: `paper`, 4 px ink border, r 16, hard shadow (0,5) ink, height 48, Fredoka 700, `font-variant-numeric: tabular-nums`. **Nothing dark**: the hint pill is `rgba(255,248,231,.92)` paper with ink text (overrides the ink pill in `FINAL/ux/hud-layout.html`); only transient toasts are ink.

| Cluster | Box | Content |
|---|---|---|
| TL level card | (16, 12, auto ≈ 356, 48) | ink badge `HOLE 2/4` 14 px → name 22 px uppercase (hidden in compact) → `PAR 9` pill `p2Sh` 15 px |
| TC team card | centred x 640, (≈505, 12, ≈270, 48) | `TEAM` 13 px/.08em → `5` 28 px → `/ PAR 9` 13 px → delta chip 14 px: **mid-hole copy `4 TO SPARE` (mint) / `AT PAR` (paper, ink text) / `2 OVER` (`bump`)** computed as par − teamStrokes; the golf delta (`−1`, `E`, `+2`) is used only on results cards and the tray. (Deliberate override of UX §4.1 "−3 / E / +2" mid-hole, which reads as a finished score; flagged for the lead.) |
| TR chips | right-aligned, ending 8 px before the buttons; each ≥ 150×48, gap 8 | `dot` 18 px → two rows: name `RED`/`BLUE` 18 px + **status 12 px/600/.06em** → count badge (ink pill 16 px). Status copy derived from SimState only: active → `AIMING`; ball resting with centre inside a pressed switch's `[x, x+w]` → `HOLDS SWITCH A`; sunk → `IN THE CUP`; else `WAITING`. Online prefixes `YOU · ` / `PARTNER · ` (compact drops the prefix). Idle chip .72 opacity; active chip player-colour fill, white text, raised 3 px, shadow 8 px, scale 1.06, `▶` glyph before the dot, count badge white with `Sh` text. A sunk ball's chip shows `⛳` instead of `▶`. |
| TR buttons | mute (1168, 12, 48, 48), pause (1220, 12, 48, 48) | round paper buttons, 22 px ink icons; tooltips `Mute (M)`, `Menu (Esc)` |
| BL meter | (16, 660, 300, 48) | `POWER` 13 px → bar 18 px tall (3 px ink, white, quarter ticks) filled in the active player's colour with a 6 px `Sh` inset band → `76` 22 px → `58°` 14 px/600. Visible while the local active player aims (and tinted for the partner's live aim online); hidden while flying |
| BL hint pill | right of the meter, (328, 664, ≤ 600, 40) | device copy (UX §5.5): keyboard `← → aim · ↑ ↓ power · SPACE shoot` with keycaps (3 px ink, r 7, 13 px); mouse `Drag back from your ball to aim · release to shoot · drag onto the ball to cancel`; touch `Pull back from your ball, let go to shoot`; gamepad `◀▶ aim · RT power · Ⓐ shoot`. While the other player aims: `Blue is lining up a shot…`; while flying: `Red's shot…`. **Hidden after the local player's 3rd shot on holes > 1; always shown on hole 1.** |
| BR | (1188, 680, 76, 28) net pill (online only: `● 48 ms`, dot mint < 120 ms, `bump` < 300, `p1Sh` otherwise) + overview button (1216, 660, 48, 48) `Overview (Tab)` |
| Turn banner | (390, 84, 500, 56), player-colour fill, 4 px ink, r 16, (0,5) shadow; 28 px white text with 2 px ink text-stroke; slides down from y 40 in 200 ms, holds 1.2 s, slides up | solo `RED'S TURN` / `BLUE'S TURN`; local `RED'S TURN · PLAYER 1` / `BLUE'S TURN · PLAYER 2`; online me `YOUR TURN`, partner `BLUE'S TURN` + 15 px sub-line `your partner` |
| Toast | (440, 616, 400, 40), ink, white 16 px, 2.5 s | `Blue teed off`, `Red restarted the level`, `Reconnected`, … (UX §4.5) |
| Online status | inside the partner chip's status line (`PARTNER · RECONNECTING 42 s`) — never a separate bar | |

Playfield band y 68–652 stays clear of persistent HUD. Phone portrait (390 px): stageScale ≈ 0.30; compact HUD, hint replaced by the one-time onboarding card (UX §5.6); stickers at `labelScale` 1.8.

## 12. Typography and font loading

- Font **Fredoka** 600/700 only, one `<link>` with `display=swap`; fallback `'Arial Rounded MT Bold', 'Trebuchet MS', system-ui, sans-serif`.
- `GameCanvas.tsx`: `await Promise.race([document.fonts.load('700 16px Fredoka'), timeout(1500)])` before the first frame; on `document.fonts.ready` invalidate the sticker measurement cache and the cached terrain/sticker layer (sticker boxes measured with the fallback are wrong by up to 12 %).
- Sizes: logo 92/118; menu buttons 26; HUD level name 22; team strokes 28; chip name 18, chip status 12; meter number 22; stickers 15 (pit 13, GIMME ZONE 13, CANCEL 12); hint 15/600; badges 13–14; callouts 44; banner 28; results heading 40 (team number 56 on the results card per UX §7); body copy 18/500.
- Uppercase + .04–.08 em tracking for labels/buttons/stickers/badges; sentence case for hints and intro copy.
- Display text strokes: DOM uses `-webkit-text-stroke` + `paint-order: stroke fill` + hard `text-shadow 0 Npx 0 ink`; canvas uses `strokeText` (lineWidth 2× the outline, round joins) under `fillText`.

## 13. Feedback / juice mapped to `SimEvent`s (view-side only, `src/view/view.ts`)

Shake = peak screen offset, linear decay. Particles are flat discs/squares with 3 px ink outline when ≥ 6 px. Max 40 live particles; nothing here touches `SimState`.

| SimEvent (architecture/types.ts) | Visual | Shake | Callout (§14, copy §17) | SFX cue |
|---|---|---|---|---|
| `levelStart` | overview camera, level intro card over it | — | — | — |
| `playStart` | camera eases to follow 400 ms | — | — | — |
| `turnStart{playerId, readyInTicks}` | golfer walk/hop; chip arrow slides 350 ms; turn marker; banner; hint pill shown | — | banner (§11) | two-note chime (Red low, Blue high) |
| `ballHit{power}` | swing clip; 8 white dust puffs r 4–7 300 ms; ball squash; trail on | 2 px·80 ms ×power/100 | — | thwock, pitch ∝ power |
| `bounce{strength, surface}` | 3–6 puffs by strength (grass white, dirtWall `dirtSh`, bridge `plankSh`); squash 1.2×0.8 2 frames | strength > .6 → 3 px·100 ms | — | tok |
| `enterSand` | 6 `sand` puffs; sticker pulse; trail → `sandSh` | — | `SAND…` (28 px, small) | shh |
| `spring{launch}` | §4 spring | 3 px·120 ms | `BOING!` `sun` | boing |
| `bumper{outVel}` | §4 bumper | 4 px·100 ms | `BONK!` `bump` | pinball ding |
| `fan` | 3 white streaks/tick; chevrons ×2 300 ms | — | — | wind loop in/out |
| `gatePass` | field alpha dip, stripes ×3 | — | — | soft whoosh |
| `hazardBlock{colour}` | field solid 3 frames, blocked glyph pops 1.6×, 5 gate-colour sparks, squash 0.7×1.3, own golfer `sad` | 3 px·120 ms | `WRONG COLOUR` (white) | buzz |
| `switchOn{switchId}` | cap drop, lamp + wire light, sticker suffix ` · ON`, chip status `HOLDS SWITCH A` | — | `SWITCH HELD` small 20 px above the plate | click-down |
| `switchOff{switchId}` | cap pop, lamp/wire grey | — | — | click-up |
| `bridgeToggle{rectId, kind, active}` | planks slide in/out, lamps, sticker suffix | — | `BRIDGE OPEN` / `BRIDGE GONE` (or `GATE OPEN` / `GATE SHUT` for blockers) | wooden clatter / hum |
| `fellOffWorld{respawnPos}` | §4 chasm; golfer `sad` | 6 px·250 ms | `OUT OF BOUNDS · +1` (`bump`) | descending whistle + thud |
| `ballRest` | trail cleared; nothing else | — | — | — |
| `nearCup` | ring pulse 3 Hz | — | — | tick |
| `lipOut` | cup squash 1.1×0.9 2 frames | — | `SO CLOSE` (white) | clink |
| `gimme` | ball slides to the cup 400 ms, flag wiggle, 10 confetti, both golfers `cheer` | — | `GIMME!` `mint` 1.3× with 3 `sun` stars | pop + short fanfare |
| `sink` | flag jumps 10 px, 12 confetti (`p1`,`p2`,`sun` 6 px squares 700 ms gravity 400), both golfers `cheer` | 3 px·150 ms | `IN THE HOLE!` `mint` | fanfare |
| `levelComplete{result}` | 600 ms hold, overview camera, 35 % ink scrim, results card slides up | — | banner `HOLE COMPLETE` | medal sting |
| `campaignComplete` | confetti rain 2 s (30 pieces), golfers high-five | — | — | long fanfare |
| `levelRestart` | ink flash .2 2 frames, everything resets | — | toast `Red restarted the level` | — |

Particles vanish without alpha fade (Flash style). `prefers-reduced-motion`: no shake, callouts fade only.

## 14. Callout style (canvas, `effects.ts`)

Anchored at `worldPos` (the ball or the mechanic), offset 60 px up (+40 px more if overlapping the landing X), screen-scale. Fredoka 700 44 px uppercase (small variants 20–28 px), fill colour per §13, 8 px ink stroke (`strokeText` lineWidth 16 under `fillText`) plus a hard ink shadow (0, 6). Rotation −4°. Animation: scale 0.4→1.15 (90 ms ease-out) →1.0 (80 ms), hold 500 ms, rise 24 px while fading 250 ms. Max 2 on screen. The UX track's DOM callouts at (640, 170) are NOT used for world events (double feedback); the DOM shows only banners and toasts.

## 15. Results, medals, intro, pause (React; paper language)

- **Medal:** circle 42 px (results 96 px), 4 px ink, `gold`/`silver`/`bronze` fill, inset bottom shade band 9 px (results 20 px), ink ★ (white on bronze), ribbon behind 18×16 (results 40×36) split `p1`|`p2` with 3 px ink (= "team"). No medal: dashed ink @ .45 circle with `?`.
- **Level results card** 720×440 at (280, 140) (UX §7 sizes), paper r 22, (0,7) shadow: ink badge `HOLE 2 COMPLETE`; `TEAM 7` 56 px with `PAR 8` 24 px beside; verdict 28 px in the medal colour: gold `1 UNDER PAR`, silver `PAR`, bronze/none `2 OVER PAR` (`bump`), flavour line 16 px per UX §7; medal 96 px left, dropping in from scale 1.6 with a 2-frame squash; per-player row: two identical **inactive-style chips** `● RED 3` `● BLUE 4` (never ranked, always Red then Blue, no highlight); `Best on this hole: 7 · GOLD` / `NEW BEST!` badge; buttons `Next hole` (mint 240×52), `Retry hole` (paper 200×48), `Quit to title` (ghost). Online guest: `Retry hole` disabled with caption `Ask Red to retry`; `Next hole` enabled for either player with a 12 s countdown ring in `sun`.
- **Campaign results** 820×480: `WORLD 1 COMPLETE`, `TEAM 29 · COURSE PAR 32` 48 px, verdict, four rows with 28 px medals, per-player columns in grey 16 px, `PERFECT ROUND` ribbon when all gold, buttons `Play again` / `Title`.
- **Level intro card** 520×300 over the overview camera: hole badge + name 32 px, `PAR 9` `sun` tag, hint 18 px/500, teach tag `NEW: PRESSURE SWITCH` (paperSh, from `mechanicsIntroduced`), first-player line with the ball dot (`Blue goes first` / online `You go first` / solo `You shoot both balls, alternating. Red first.`), `TEE OFF` button; hole 1 adds the onboarding strip (drag pictogram + keycaps).
- **Pause overlay**: ink @ .45 scrim; card 420×320: `RESUME`, `RESTART HOLE` (confirm `Restart for both players?`; online host-only, guest sees it disabled with `host only`), `QUIT TO TITLE`, mute toggle. Online header line `The game keeps running for Blue.`
- Forbidden words anywhere: opponent, scoreboard, winner, wins, leaderboard, rank, 1st/2nd.

## 16. Title screen (`mockup-title.html`)

- Logo `FLASH` 92 px `sun` over `GOLF` 118 px white, 9 px ink text-stroke, (0,9) ink shadow, block rotated −3°; the **O is a 92 px two-tone ball** (left `p1`, right `p2`, 8 px ink, highlight) — reused on medals, favicon and the OG image.
- Tagline sticker `CO-OP PUZZLE GOLF · TWO BALLS, ONE TEAM` 17 px, +2°.
- Buttons 400×56 r 18 with (0,7) shadow + 7 px inset shade: `SOLO` (`mint`, one red ball, sub `YOU PLAY BOTH BALLS`), `LOCAL 2P` (`sun`, two overlapping balls, sub `TAKE TURNS ON THIS SCREEN`), `ONLINE` (`p2`, white link icon, white text, sub `ROOM CODE OR INVITE LINK`). Hover raise 2 px / shadow 9 px; press drop 5 px / shadow 2 px; keyboard focus 3 px dashed ink outline offset 4 px.
- Level tray (150, 488, 980×190): header `WORLD 1` badge + `TEACH · 4 HOLES` + medal legend `GOLD: UNDER PAR · SILVER: PAR · BRONZE: PAR +2 OR BETTER`; four cards 226×118 with a `sun` number badge overhanging, name 17 px uppercase, `PAR n` in `p2Sh`, 42 px medal + `TEAM n` / `1 UNDER PAR` / `PAR` / `2 OVER PAR` / `NOT PLAYED`, teach tag `NEW: …`. **Names, pars, teach tags come from `LEVELS` (`levelById`, `mechanicsIntroduced`) and best results from `fg.best.v1`; the mock's "First Fairway / Boing Bluff / Plate & Bridge / Colour Glass" are the level track's current placeholders.** The next unplayed card gets a 4 px `p2` outline offset 3 px.
- Corner pill `ONLINE SERVER: OK` (mint dot) / `WAKING…` (grey dot, pulsing) / `OFFLINE` (`bump` dot), from a non-blocking `fetch(HEALTH_URL, {signal: 5 s timeout})` — never gates the menu. Footer version pill; round mute button.
- Backdrop canvas: same layers as gameplay with a lawn at y 600; Red waves (`wave`, face `grin`), Blue idle beside the cup; clouds drift; sun static.

## 17. `src/view/copy.ts` (every world/callout/banner string; UI copy sheet is UX §14)

```ts
export const COPY = {
  stickers: { sand: 'SAND', spring: 'SPRING', bumper: 'BUMPER', fan: 'FAN', gateRed: 'RED ONLY', gateBlue: 'BLUE ONLY',
              switch: (l) => `SWITCH ${l}`, bridge: (l) => `BRIDGE ${l}`, blocker: (l) => `GATE ${l}`,
              on: ' · ON', off: ' · OFF', open: ' · OPEN', shut: ' · SHUT', pit: 'OUT OF BOUNDS · +1', gimmeZone: 'GIMME ZONE',
              cancel: 'CANCEL', aimUp: 'AIM UPWARD', partnerAiming: (name) => `${name} AIMING`, you: 'YOU' },
  callouts: { gimme: 'GIMME!', sink: 'IN THE HOLE!', oob: 'OUT OF BOUNDS · +1', wrongColour: 'WRONG COLOUR', switchHeld: 'SWITCH HELD',
              bridgeOn: 'BRIDGE OPEN', bridgeOff: 'BRIDGE GONE', gateOn: 'GATE OPEN', gateOff: 'GATE SHUT', spring: 'BOING!', bumper: 'BONK!',
              sand: 'SAND…', lipOut: 'SO CLOSE' },
  banners: { yourTurn: 'YOUR TURN', turn: (name) => `${name.toUpperCase()}'S TURN`, local: (name, n) => `${name.toUpperCase()}'S TURN · PLAYER ${n}`,
             partnerSub: 'your partner', holeComplete: 'HOLE COMPLETE' },
  chipStatus: { aiming: 'AIMING', holds: (l) => `HOLDS SWITCH ${l}`, waiting: 'WAITING', inCup: 'IN THE CUP', you: 'YOU', partner: 'PARTNER' },
  teamDelta: { spare: (n) => `${n} TO SPARE`, atPar: 'AT PAR', over: (n) => `${n} OVER` },
};
```
`BONK!` and `GATE OPEN/SHUT` extend the UX copy sheet (it had no bumper or blocker line); everything else is verbatim from it.

## 18. Performance contract and validation

- Terrain layer: one offscreen canvas per level per DPR (cap 4096 px wide, tile beyond), holding pit gradients, dirt, grass, stones, tufts, sand bands, spring slots/coils, bumper sockets, fan housings, switch bases, wires (unlit colour), gate posts, cup hole/pole. Redrawn only on level load, DPR change or `fonts.ready`. Per frame: background tiles, animated prop parts (switch cap/lamp, planks, fan blades/chevrons/column, gate field/badge, lit wires, bumper dome, spring plate), balls, golfers, aim, particles, stickers, callouts — < 200 draw calls, ≤ 8 clips, 0 `shadowBlur`, 2 gradients (sky, pit cached). Target < 2 ms/frame at DPR 2 on a 2019 laptop.
- `render/` never reads `Date`/`Math.random`; time comes from `ViewState.timeSec`; confetti uses a view-local xorshift.
- **Before the port starts**, render one overview frame of the widest World 1 level (≈2 000 px, scale ≈ 0.64) with this style and confirm: outlines at 2–4 screen px, stickers 15 px and non-overlapping (rule §5.3), spring/bumper/switch silhouettes identifiable at 0.6×, pit stickers inside their gaps. Also one 844×390 phone frame with the compact HUD.

## 19. Port map into `src/view/render/` (ARCH 1.9 signatures; mockup function → file)

| File | From the mockup | Exports / notes |
|---|---|---|
| `palette.ts` | `P`, `INK`, `LW`, `PLAYER` | `PALETTE` (§1), `INK`, `OUTLINE = 4`, `FONT(weight, px)`, `PLAYER_VIEW[0|1] = {col, sh, name}`; also exports `THEME` in the shape ARCH 1.9 declares (`sky, hills, grass, grassDark, dirt, dirtDark, outline, sand, spring, bumper, fan, bridge, blocker, cupDark, flag, red, blue`) mapped from these tokens so both contracts hold. **Request to the lead:** ARCH 1.9 says `OUTLINE_WIDTH = 3` and "18 px display font" for labels; this spec fixes 4 px and 15 px stickers (decision 8 says 3–4 px). Use 4 / 15. |
| `primitives.ts` | `fs`, `rr`, `circ`, `line`, `inkLine`, `appendRounded`, `sticker` | `fillStroke(ctx, fill, lw?)`, `roundRect`, `circle`, `inkLine`, `roundedPolyline(ctx, pts, r, move)`, `sticker(ctx, x, y, text, {accent, rot, size, alpha, fill, color}) → width`, `screenLineWidth(scale)` (§2.2) |
| `world.ts` | `drawSky`, `cloud`, `hills`, `drawPit`, `drawPiece`, `drawCup` | `drawSky(ctx, view)` (parallax §9, tiling), `renderTerrainLayer(level, dpr) → HTMLCanvasElement` (cached), `drawTerrain(ctx, level)` (blits the layer), `drawCup(ctx, level, flagWobble)` |
| `mechanics.ts` | `drawSand`, `drawSpring`, `drawBumper`, `drawFan`, `drawSwitch`, `drawWire`, `drawBridge`, `drawGate` | `drawRect(ctx, rect, active, anim, switchColour?)` dispatching on `rect.kind`; `drawSwitch(ctx, sw, pressed01)`; `drawWire(ctx, sw, rect, lit)`; `letterOf(level, switchId)`; blocker gate per §4 |
| `entities.ts` | `drawBall`, `drawGolfer`, `drawFace` | `drawBall(ctx, playerId, pos, squash, sinkT)`, `drawTrail`, `drawGolfer(ctx, playerId, anim: GolferAnim & {pose, face, power}, isActive, isLocal)` (adds `pose/face/fidgetT` to `GolferAnim` — request to the lead to extend the type) |
| `aim.ts` | `drawAim`, `turnMarker` | `drawAim(ctx, ball, aim, preview, device, ready, drag?: {pointer: Vec, cancel: boolean})`, `drawTurnMarker`, `drawPartnerAim(ctx, ball, preview, playerId)` |
| `effects.ts` | — | `drawParticles`, `drawCallouts` (§14), shake offset, confetti |
| `labels.ts` | sticker placement | `layoutStickers(level, state) → Sticker[]` (copy + letters + state suffix + collision stacking, §5), cached per level and recomputed on switch events |
| `index.ts` | `draw()` | `renderFrame(ctx, scene)` in the order: sky → sun → clouds → far hills → mid hills → [camera transform] pits → terrain layer → lit wires → props → bridges/blockers → gates → cup → golfers (inactive first) → balls → partner aim → aim → particles → [reset transform] stickers → callouts → turn marker → drag ring / landing X |

Everything in the HUD, intro, results, pause and title is React with CSS custom properties generated from `palette.ts`; no canvas text except stickers, callouts, the `YOU`/`BLUE AIMING` world tags and the switch letters.

## 20. Open items for the lead (cross-track conflicts this spec resolved one way)

1. Hint pill: paper (this spec) vs ink 78 % (`FINAL/ux/hud-layout.html`). Decision 8 says not a dark UI; paper is used.
2. Mid-hole team delta: `4 TO SPARE / AT PAR / 2 OVER` (this spec) vs `−3 / E / +2` (UX §4.1). Results and tray keep the golf delta.
3. Switch word: stickers default to `SWITCH A`; the level track's `label: 'PLATE A'` would override it. Recommend the level files drop the label or use `SWITCH A` so stickers, chip status (`HOLDS SWITCH A`) and the callout `SWITCH HELD` agree.
4. ARCH `OUTLINE_WIDTH = 3` / 18 px labels → 4 px / 15 px (§19).
5. Callouts are canvas at the ball (ARCH `ViewState.callouts`), not DOM at (640,170) (UX §4.4).
