# Flash Golf — FINAL UX spec (flows, screens, HUD, controls, co-op/online, onboarding)

Synthesised from the `ux-onboard` proposal (base) with the `ux-coop` grafts the judges asked for, reconciled against the
frozen architecture contracts (`design/architecture/types.ts`, `protocol.ts`, `ARCH.md`) and the lead brief. Every number
below is a shipping default. Where this spec needs something the frozen contracts do not provide, it is listed as a
**contract delta (CD-n)** in §12 with a fallback, so nothing here silently depends on an unapproved change.

Companion files in this folder: `hud-layout.html` (the HUD cluster/scale mechanism, implemented in real CSS) rendered as
`hud-1280x720.png`, `hud-1024x768.png`, `hud-844x390.png`; `lobby-layout.html` rendered as `lobby-1280x720.png`,
`lobby-844x390.png`. Section §13 says what each screenshot proves.

---

## 0. Judges' concerns → decisions (read this first)

| # | Concern | Decision in this spec |
|---|---|---|
| 1 | `--hud-scale` on fixed rects collides at phone scale | HUD = six corner/centre-anchored clusters that scale from their own anchor (§4.1). Normal and compact variants have enumerated widths; compact engages at `stageScale < 0.85`. Verified at 844×390 and 1024×768 (§13): no overlap, 48-px buttons ≥ 43 CSS px. |
| 2 | Names vs colours | **Colour-only.** Players are Red (slot 0, `#ff5d73`) and Blue (slot 1, `#50b7ff`) everywhere; online chips add YOU / PARTNER. No name input on any path, no `{name}` interpolation, `hello.name` is never sent. |
| 3 | Intro/results auto-advance | Intro is the sim phase `intro` left by `continue`. A hole's **first** view never auto-advances. Repeat views (same levelId already seen this session) auto-`continue` after **10 s online** (countdown ring on the button) and never in local modes. Results **never** auto-advance. |
| 4 | Touch tuning constants | `GRAB_RADIUS_TOUCH 80`, `GRAB_RADIUS_MOUSE 48`, `DRAG_DEAD_ZONE 24` (= cancel ring), `PULL_MAX 240`, tap `< 8 px && < 250 ms` = no shot. `PULL_MAX` is 240 (not 280): 216 px for 90 power units = 2.4 logical px per unit (1.3 CSS px at the smallest scale), and the pull stays inside the stage for every shot the levels require (§5.2, §4.6, CD-5). |
| 5 | Intro-card ownership | Sim phase `intro` (already in `types.ts`); `continue` accepted from either online player (CD-1), first wins, toast to the other. No client-local gating of `shoot`. |
| 6 | Turn banner colour | Ribbon = active player's colour (`--p1`/`--p2`), white 28 px text with 2 px ink stroke; contrast of white-on-`#50b7ff` with the ink stroke measured ≥ 4.5:1 via the stroke (paint-order stroke fill). |
| 7 | Minimum text/targets | Nothing in the HUD below 15 px logical × `--hud-scale`; no HUD control under 48 px logical (≥ 43.2 CSS px at the smallest supported scale 0.54; ≥ 44 at ≥ 0.55). |
| 8 | Reconnect vs server grace | Client retries every 2 s for the whole 60 s `reconnectGraceMs` (up to 30 attempts), copy shows seconds left, not "attempt n of 5" (CD-6). If the server ships without grace, PARTNER_AWAY collapses into PARTNER_LEFT (§3.9). |
| 9 | Type/name contracts | One set, aligned to `types.ts`/`protocol.ts`/`ARCH.md`: `SimMode = 'solo'|'local'|'online'`, `InputDevice = 'keyboard'|'pointer'|'touch'|'gamepad'`, `ClientStatus` from `GameClient`, storage keys `fg.v1.*` + NET-owned `sessionStorage['fg.reconnect']`, `Settings.reducedMotion: 'system'|'on'|'off'`, music default **on** (audio track's measured −18 dB bed), gamepad A shoot / B back / Start pause / Y camera / X hints / Select mute (§5.3, §7). |
| 10 | Sim features both specs assumed | All exist in `types.ts`/`ARCH.md`: `players[i].aim`, `turnDelayTicks` 27 with client-side queued shoot, `commandRejected` (local only), `nearCup`, `lipOut`, `firstPlayer = levelIndex % 2` in `levelStart`, `Level {id, world, order, name, par, hint, mechanicsIntroduced}`. No `shootRejected`: power is clamped to `[MIN_POWER 10, 100]` client-side and validated server-side. The NEW-mechanic one-liners come from `MECHANIC_COPY` keyed by `MechanicKind` (§9.3), so the `Level` type is untouched. |
| 11 | Net pill placement | Bottom-right cluster, left of the camera button, never in the top row; verified not to touch the hint pill at compact scale (§4.1, §13). |
| 12 | Lobby card layout / short viewports | Title, Lobby and every modal card are **viewport-space DOM** (CSS px, scrollable, max-width 640/720), not stage-scaled. Only the canvas, HUD, banner, toasts and coach live in the 1280×720 stage. The on-screen keyboard therefore scrolls the lobby instead of squashing it (§1.1). Verified at 844×390 (§13). |
| 13 | Banner/callout over the arc | Turn banner lives in the top HUD band slot (y = band + 12); mechanic/ball callouts are **world-anchored canvas text** at the thing that caused them (view art, like the SAND/BOING stickers), so there is no fixed callout slot to collide with the arc. |
| 14 | Pull range vs stage edge | Follow camera leads opposite to the aim (ball at 45 % width when aiming right, 55 % when aiming left), may overscan up to 220 px past the level's left edge while the active ball is within 280 px of it, and levels must place tees ≥ 280 px from the left edge and keep restable surfaces within y 220–580 (CD-5). Pointer capture keeps a drag alive over the letterbox. |
| 15 | Scope cuts | Removed: typed names, shape-coded balls, `prefers-contrast`, haptics, `fg.v1.campaignBest`, standalone How-to-play modal (H / level-chip tap replays the coach), host "Keep room open" after a mid-game leave (the frozen protocol closes the room on `guestLeft`). Kept: RotatePrompt and compact HUD. |
| 16 | Medal copy | Bronze = par + 2 or better everywhere: `results.medal.none.sub` = "par +2 or better for bronze"; delta chips `−1` / `E` / `+2`; verdicts "1 UNDER PAR" / "PAR" / "2 OVER PAR". |
| 17 | Keyboard scoping | Space/Enter shoot and Tab camera only when `document.activeElement` is `body`, the canvas or `.stage`; DOM buttons keep native Enter/Space/Tab. |
| 18 | React render rate | HUD state = `FrameSummary` at 10 Hz (ARCH `onFrame`) + `onEvents`; derived `HudSnapshot` memoised by shallow equality; the canvas draws band/arc/meter mirror at 60 Hz. |
| 19 | Fonts/icons | Self-hosted `public/fonts/Fredoka-{500,600,700}.woff2`, `font-display: swap`; no Google Fonts `<link>` in the shipped build; all icons inline SVG (no emoji). DOM outlined text uses `paint-order: stroke fill` + `-webkit-text-stroke`; canvas uses `strokeText` under `fillText`. |
| 20 | Forbidden words | `opponent, scoreboard, winner, wins, leaderboard, rank, 1st, 2nd` banned in `src/ui/**` and `src/view/render/calloutCopy.ts`, enforced by `src/ui/__tests__/copy.test.ts` (§9.4). |

---

## 1. Conventions

### 1.1 Two coordinate spaces
- **Stage space** (logical 1280×720, letterboxed): `canvas#world`, `.hud-layer` (HUD clusters, turn banner, toasts, coach, grab ring is canvas). `stageScale = min(viewportW/1280, viewportH/720)`.
  ```
  #root  { position:fixed; inset:0; background:var(--letterbox); padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left) }
  .stage { position:absolute; left:50%; top:50%; width:1280px; height:720px;
           transform:translate(-50%,-50%) scale(var(--stage-scale)); transform-origin:center; overflow:hidden;
           outline:4px solid #1b1612; border-radius:6px }      /* absolute+translate, NOT grid centring: a grid track grows when the stage overflows and pushes it to the start */
    canvas#world  { position:absolute; inset:0; width:1280px; height:720px; touch-action:none }   /* backing store ×DPR */
    .hud-layer    { position:absolute; inset:0; pointer-events:none }   /* controls set pointer-events:auto */
  ```
  `--stage-scale` and `--hud-scale` are set by a `ResizeObserver` on `#root` plus `matchMedia('(resolution: Ndppx)')` for DPR changes.
- **Viewport space** (CSS px): Title, Lobby, LevelIntro, LevelResults, CampaignResults, PauseMenu, Settings, ConfirmDialog, NetOverlay, RotatePrompt, SharedStateCard. These are `position:fixed; inset:0` layers with a scrim, `display:flex; align-items:safe center; justify-content:center; overflow:auto; padding: 16px + safe-area`. Cards: `width:min(92vw, 720px)`, `max-height:92vh`, internal scroll. Font sizes are CSS px (body 18, label 15, display 32–56) and therefore readable on every device without scaling. In-game cards still sit over the live world (the canvas keeps rendering underneath).
- `--letterbox: #10263d` with a 1 px `#1d3a58` inner line: an "embedded SWF" frame only. Nothing inside the stage reads as dark-mode UI (locked 8).

### 1.2 HUD scale
`--hud-scale = clamp(1, 0.9 / stageScale, 1.7)`; **compact mode** = `stageScale < 0.85` (class `.compact` on `.hud-layer`). Sizes inside clusters are logical px and scale by `transform: scale(var(--hud-scale))` from the cluster's anchor corner (§4.1). Smallest supported scale is 0.54 (390×844 phone landscape); below 0.5 the RotatePrompt (§3.11) is the expected state.

### 1.3 Tokens (names are the contract; values are the visual track's and may be re-tuned there)
`--ink #241b33`, `--paper #fff8e7`, `--paper-sh #e9dcc0`, `--grass #6ad636`, `--grass-sh #45b02a`, `--sun #ffd93b`, `--sun-sh #e0a800`, `--mint #44d67a`, `--mint-sh #2aa85a`, `--p1 #ff5d73`, `--p1-sh #d63d55`, `--p2 #50b7ff`, `--p2-sh #2f8fd6`, `--warn #ff9f1c`, `--bad #e23b4f`, `--gold #ffd93b`, `--silver #e3eaf4`, `--bronze #e0905a`, `--scrim rgba(36,27,51,.45)`, `--letterbox #10263d`.
Panels: `--paper` fill, 4 px `--ink` border, radius 16 (cards 18), hard shadow `0 5px 0 var(--ink)` (cards `0 6px`). Primary buttons: `--mint` fill, white text with 1.5 px ink text-stroke, 52 px tall, press = `translateY(4px)` + shadow 1 px. Secondary: `--paper`. Destructive confirm: `--bad`. Focus ring: 4 px `--sun` outside the border, `:focus-visible` only. Minimum hit target 44 CSS px everywhere.
Type: display/body **Fredoka** 500/600/700 self-hosted, fallback `"Arial Rounded MT Bold","Trebuchet MS",system-ui,sans-serif`. Logical sizes before `--hud-scale`: display-XL 56, display-L 40, display-M 28, label 20, body 18, small 15 (floor).

### 1.4 Identity, modes, seats
- `SimMode = 'solo' | 'local' | 'online'` (from `types.ts`). Seat = the human; slot = the ball. Solo: seat 0 owns slots 0 and 1. Local: seats 0/1 on one device. Online: host = seat 0 = Red, guest = seat 1 = Blue.
- UI names: **Red** / **Blue** (`PLAYER_NAMES`), never "Player 2" in solo; local 2P adds "P1"/"P2" sub-labels; online adds "YOU"/"PARTNER". The partner is "your partner", never anything competitive.
- Team score is primary everywhere; per-player strokes are secondary, fixed order Red then Blue, never sorted or highlighted.

### 1.5 Aim contract (one convention)
- Docs/HUD show **degrees**: 0 = right, 90 = straight up, 180 = left. Code sends **radians** per `types.ts`: `angleRad = -deg × π/180` (y-down; `AIM_ANGLE_MIN = -π+0.03`, `AIM_ANGLE_MAX = -0.03`).
- Client clamp **[3°, 177°]** (`AIM_DEG_MIN/MAX`), strictly inside the sim/server range (±1.72° from horizontal), so every client value validates server-side. Power **[MIN_POWER 10, MAX_POWER 100]**, integer, clamped on every device. No reject path is needed for power.
- `setAim` is emitted only on change, at most once per frame locally and coalesced to 20 Hz online (server allows 30/s), with a final value on release/key-up before `shoot`.
- Per-player aim memory is sim state (`players[i].aim`, reset to `DEFAULT_AIM` = 45°/55 per level). The HUD readout "45° · 62" is the exact pair sent.

### 1.6 Input device and hints
`InputDevice = 'keyboard' | 'pointer' | 'touch' | 'gamepad'` (ARCH). Initial guess: `touch` when `navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches`, else `pointer`. Updated by the adapter that most recently produced a non-empty frame; `Settings.hintDevice` overrides (`'auto'` = detected). Every hint string has four variants (§9).

---

## 2. App state machine

```
boot ─┬─ ?state=…  ──► TITLE (+ SharedStateCard)
      ├─ ?room=CODE ──► LOBBY{autoJoin:true}  (Title skipped; join attempted exactly once)
      ├─ sessionStorage fg.reconnect ──► GAME(online) with NetOverlay RECONNECTING ("Rejoining room K7PQ2…")
      └─ else ──────► TITLE

TITLE ── Solo ─────────────► GAME(local session, seats [0], startLevelId)
      ── 2 players ────────► GAME(local session, seats [0,1], startLevelId)
      ── Online ───────────► LOBBY{autoJoin:false}
      ── gear ─────────────► SETTINGS (overlay)
LOBBY  menu → connecting → hosting | joined → ready → (server `start`) ► GAME(online session, seat)
       any → error → menu ; Esc/Back → TITLE (confirm if hosting/joined)
GAME   sim phases: intro ─continue─► aiming ⇄ flying ─(both sunk)─► levelResults ─continue─► intro(next) | campaignResults
       overlays (stack, top wins input): pause, confirm, settings, net, rotate, coach(view-only, never blocks)
       exits: Quit/Leave (confirm) → TITLE ; campaignResults "Title" → TITLE ; roomClosed → NetOverlay → TITLE
```

```ts
// src/App.tsx
type Overlay = 'pause' | 'settings' | 'confirm' | 'net' | 'rotate';
type AppRoute =
  | { kind: 'title'; shared?: { config: SimConfig; state: SimState } | 'invalid' }
  | { kind: 'lobby'; initialCode?: string; autoJoin: boolean }
  | { kind: 'game'; session: LocalSession | OnlineSessionView };          // from src/view/GameCanvas.tsx
```
- Boot precedence: `fg.reconnect` token present → reconnect (never also a `?room=` join); else `?room=` → auto-join once (`useRef` guard, StrictMode-safe); else `?state=` → Title card. URL params are stripped with `history.replaceState` **before** connecting/decoding. A failed auto-join lands in `LOBBY.error` with the code prefilled and an explicit "Try again"; the app never auto-rejoins.
- Browser Back: `pushState` on entering LOBBY and GAME; `popstate` in GAME opens the pause menu, in LOBBY acts as Back (with the hosting/joined confirm). Leaving the site mid-game always goes through a confirm.
- Lobby substates are derived from `GameClient.ClientStatus` (ARCH §1.14):
  `connecting` → LOBBY.connecting · `waiting{peerConnected:false}` → LOBBY.hosting · `waiting{peerConnected:true}` → LOBBY.ready · `joined` → LOBBY.joined · `error` → LOBBY.error(mapped) · `closed{serverUnreachable|timeout}` → LOBBY.error(unreachable) · `playing` → GAME.

---

## 3. Screens (viewport space unless stated)

### 3.1 TITLE `<Title>` — the only start screen
Backdrop: a full-viewport canvas (cover-fit, same renderer layers: sky, sun, clouds drifting 6 px/s, hills, lawn at 83 % height) with Red waving at 8 % width and Blue idle beside a cup + flag at 92 % width; static under reduced motion. DOM layer on top, reference layout at 1280×720 (CSS px, centred column, max-width 960):
- Logo block top 56: "FLASH" 92 px `--sun` over "GOLF" 118 px white, 9 px ink text-stroke, hard shadow `0 9px 0 var(--ink)`, block rotated −3°; the O of GOLF is the two-tone red/blue ball mark. Tagline sticker under it (17 px, paper, +2°): **"Two balls, one team. Aim, shoot, flip switches for each other."**
- Mode buttons, stacked, each 400×56, radius 18, gap 12, first at y 236:
  1. **SOLO** (`--mint`, one red ball icon) — sub "You play both balls"
  2. **2 PLAYERS · ONE SCREEN** (`--sun`, two balls icon) — sub "Take turns on this keyboard or touchscreen"
  3. **ONLINE WITH A FRIEND** (`--p2`, white link icon, white text) — sub "Send a link, play together"
  All three are coloured primaries (one emphasis system); the **default-focused** button is `settings.lastMode` (fallback Solo) and carries the focus ring on mount. Accelerator keys 1/2/3.
  If `getWsUrl()` returns null (no `VITE_WS_URL` at build time and not localhost) the Online button is disabled with the inline note "Online isn't configured on this build." — never a hostname guess (audit #33). On the deployed build it is enabled.
- Level tray `<LevelSelect>` at y 488: header badge "WORLD 1 · TEACH · 4 HOLES"; four tiles 226×118, gap 24: `--sun` number badge, name (17 px uppercase from `level.name`), "PAR {par}" in `--p2-sh`, 42 px medal disc + "TEAM {n} · 1 UNDER" / "ON PAR" / "+2 OVER" / "NOT PLAYED", tag "NEW: {MECHANIC_COPY[kind].name}" from `mechanicsIntroduced[0]` (hidden when empty). Medal is **recomputed at read time** with `medalFor(best.teamStrokes, level.par)`. Selected tile: 4 px `--p2` outline offset 3 px + "START HERE" ribbon. Default selection = first level with no best, else hole 1. Tiles are radios: click/←→ selects; Enter/Space/A on a tile starts **solo** there. Nothing is locked (4 short levels; locking only blocks playtesters). Hover/tap on a medal: tooltip "Gold: under par · Silver: par · Bronze: par +2 or better".
- Corner: bottom-left version pill "v{version}"; bottom-right round Mute 44×44 and Settings gear 44×44. Live region announces "Flash Golf. Solo, 2 players, or online with a friend." once.
- SharedStateCard (§3.12) when `route.shared` is set, above the mode buttons; the buttons shift down 96 px.
- Audio unlock: `audio.unlock()` inside the first `pointerdown`/`keydown` (capture listener installed at boot) and again in every mode button's click handler; a short "uiClick" confirms audio. One-time toast "Sound is on — use the speaker button to mute" (iOS ringer switch is irrelevant to WebAudio).
- Transitions: Solo/2 players → GAME (intro of the selected level); Online → LOBBY.menu; gear → Settings overlay.

### 3.2 ONLINE LOBBY `<Lobby>` — card `width:min(92vw,640px)`, scrollable, top bar "← Title" 44 px and a you-chip "● RED · YOU (HOST)" / "● BLUE · YOU"
**LOBBY.menu** — title "PLAY ONLINE" 32 px; sub "Two browsers, one team. Share a 5-letter code or a link." Primary **"Create a room"** 100 % × 56. Divider "or join a friend's room". `<form>`: code input 100 % × 56 (`inputMode="text" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={5}`, font 32 px CSS, letter-spacing .2em, uppercase, **16 px minimum CSS font so iOS never zooms**) + **"Join"** 120×56, disabled until exactly 5 valid chars; Enter submits; pasting an invite URL extracts `room=`; input normalises `0→O`, `1→I`, strips spaces (alphabet `ROOM_CODE_ALPHABET`, no 0/O/1/I). Footer 15 px: "No account needed. Rooms close when empty." Focus order: Create, code, Join, Back.
**LOBBY.connecting** — spinner + "Connecting…"; after **1.5 s** the line becomes "Waking up the server — this can take a few seconds." (Fly cold start 3–4 s); **"Cancel"** 160×48 is an intentional close (never surfaces an error). Hard timeout **15 s** → error(unreachable).
**LOBBY.hosting** — title "YOUR ROOM"; label "ROOM CODE"; code tile 100 % × 80, 56 px, letter-spacing .22em, `user-select:all`; row of 52-px buttons **"Copy code"**, **"Copy invite link"**, **"Share…"** (only when `navigator.share` exists; shares `{ title:'Flash Golf', text:'Play a round of co-op golf with me — room K7PQ2', url }`). Success: label "Copied!" 1.5 s; clipboard failure: a read-only selectable input with the URL appears under the row, hint "Long-press to copy". Status (aria-live polite): pulsing dot + "Waiting for your partner to open the link…". **Start-hole picker**: label "START AT", four 44-px toggles "Hole 1"…"Hole 4" (default Hole 1; the host's choice is sent as `start{levelIds: WORLD1_IDS.slice(i)}`; the guest learns it from the intro card — no live sync, see CD-3). **"Start game"** primary, **disabled** with caption "Needs 2 players"; **"Cancel room"** ghost. `document.title` = "Flash Golf · room K7PQ2". Invite URL: `https://flash-golf.vercel.app/?room=K7PQ2`.
**LOBBY.ready** (peerJoined) — status "**Blue joined!** Press Start when you're both ready." + chips "● RED · YOU", "● BLUE · PARTNER"; `partnerJoined` SFX; Start enables, label becomes **"Start game — Blue is here!"**, auto-focus, 3-bounce attention animation (fade only under reduced motion). If the guest leaves before start: status "Blue left. Waiting for a partner…", same code, Start disabled again.
**LOBBY.joined** (guest) — title "JOINED ROOM K7PQ2"; chips "● RED · HOST", "● BLUE · YOU"; status "Waiting for Red to start the game…"; pre-teach line "While you wait: you play the **blue** ball. Pull back from it to shoot."; **"Leave room"** ghost (sends `leaveRoom`). No Start button; the guest is told who presses it (audit #26).
**LOBBY.error** — title "COULDN'T JOIN" / "COULDN'T CONNECT"; copy mapped from `ErrorCode` / close reason, raw server text never shown:

| code | copy | buttons |
|---|---|---|
| ROOM_NOT_FOUND | "Room {code} isn't open. It may have ended or the code is mistyped." | **Try again** · Create my own room |
| ROOM_FULL | "Room {code} already has two players." | Back |
| unreachable / timeout | "Can't reach the game server. Check your connection and try again." | **Retry** · Play solo instead |
| SERVER_FULL | "The server is busy right now. Try again in a minute." | Retry · Back |
| VERSION_MISMATCH | "Your game is out of date — reload the page to update." | **Reload** |
| BAD_TOKEN (boot rejoin) | "Couldn't rejoin: the room moved on without you." | Back to title |

Bindings: Tab cycles normally (nothing on this screen preventDefaults Tab); Enter submits/Starts; Esc = Back/Cancel/Leave (confirm "Leave the room?" when hosting with a partner or joined); gamepad A/B mirror Enter/Esc.
Confused-playtester fix: the guest sees exactly who starts and what ball they own; the host's Start button bounces, sounds and renames itself the moment the partner arrives.

### 3.3 Open Graph / unfurl (`index.html`, locked 26)
`<title>Flash Golf — join my game</title>`, `og:title "Flash Golf"`, `og:description "Co-op golf for two. Join my room and beat par together."`, `og:image /og.png` (1200×630 render of the title scene; placeholder shipped), `og:type website`, `twitter:card summary_large_image`, `<meta name="theme-color" content="#3fb6ff">`, `<link rel="icon" href="/favicon.svg">` (two-tone ball mark) + `favicon.ico`, `manifest.webmanifest` (name, icons, `display: standalone`, `orientation: landscape`). Viewport: `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`; `color-scheme: light`.

### 3.4 LEVEL INTRO `<LevelIntro>` — sim phase `intro`
World behind in **overview** camera, 35 % scrim. Card `min(92vw,640px)`:
- "HOLE {order} OF 4" 15 px tracking .15em; level name 40 px display uppercase; "PAR {par}" `--sun` pill 20 px.
- NEW row (only when `mechanicsIntroduced.length > 0`): 48×48 mechanic icon + "NEW: {MECHANIC_COPY[kind].name}" 18 px + one-line blurb `MECHANIC_COPY[kind].blurb` 16 px.
- Hint 18 px italic: `level.hint`.
- First-player line with the ball dot, from `state.activePlayer` (sim rule `levelIndex % 2`): solo "You shoot both balls, alternating. **Red** first." / local "**Blue** goes first (Player 2)" / online "**You** go first" or "**Blue** goes first — that's your partner".
- Primary **"Tee off"** 240×52, auto-focused; under it "or tap anywhere / or press Space / or press Ⓐ" by device. Tapping the scrim also continues.
- Online: Tee off from **either** player sends `continue` (CD-1); the other client sees toast "Blue teed off". Repeat view (levelId in `seenIntro` this session): a countdown ring on the button auto-sends `continue` after 10 s. First view: waits.
- Esc opens the pause menu over the card (the sim stays in `intro`).
- Live region: "Hole 2 of 4, {name}. Par 9. Blue goes first."

### 3.5 In-game HUD — see §4 (stage space).

### 3.6 PAUSE `<PauseMenu>` — Esc / pause button / Start / browser Back; closes on Esc / B / Resume / scrim tap; focus trap, focus to Resume, restored to the canvas on close; `InputSystem.setEnabled(false)` while open.
Local/solo (title "PAUSED"; the loop stops stepping, keeps rendering):
1. **Resume**
2. **Restart hole** → inline confirm "Restart hole {order}?" body "Both balls go back to the tee and this hole's strokes reset to 0. Earlier holes are kept." [**Restart**] [Keep playing] → `restartLevel` (sim goes to `aiming`; banner "HOLE RESTARTED" then the turn banner; no intro card).
3. **Copy share link** (sub "Anyone with the link resumes this exact game.") → `buildShareUrl`; label "Copied!" 1.5 s.
4. **Settings** (nested; Back returns here)
5. **Quit to title** → confirm "Quit this game?" body "Progress on this hole is lost. Best medals are saved." [**Quit** `--bad`] [Stay]
Online (title "MENU"; header line "The game keeps running for Blue." — the sim is not paused; the turn banner and chips stay visible at the scrim edges):
1. **Resume**
2. Room row: "Room K7PQ2" + **Copy invite link** (so a dropped partner can be re-invited)
3. **Restart hole** — host only; guest sees it disabled with caption "Only Red (host) can restart". Host confirm adds "Blue will see a notice." → `restartLevel`; guest gets toast "Red restarted the hole".
4. **Settings**
5. **Leave game** → confirm "Leave the game?" body "Blue will be left waiting." [**Leave**] [Stay] → `client.leave()` (intentional; never an error overlay).

### 3.7 LEVEL RESULTS `<LevelResults>` — on `levelComplete`, after the 1.2 s "HOLE COMPLETE!" banner; overview camera, 35 % scrim; card `min(92vw,720px)`
- "HOLE {order} COMPLETE" 15 px tracking; headline "TEAM **{team}**" 56 px with "PAR {par}" 24 px beside it; verdict 28 px coloured: "{k} UNDER PAR" (`--mint-sh`) / "PAR" (grey) / "{k} OVER PAR" (`--warn`); flavour 16 px: ≤ −2 "Eagle territory!", −1 "Birdie!", 0 "Par — solid.", +1 "Bogey, still bronze.", +2 "Double bogey, bronze.", worse "No medal — try again for bronze."
- Medal disc 96 px (ribbon split red/blue) + word GOLD / SILVER / BRONZE / NO MEDAL (sub "par +2 or better for bronze"); pops in 300 ms after the headline with its SFX; gold adds a 12-particle DOM sparkle (none under reduced motion). Rules (locked): gold < par, silver = par, bronze ≤ par+2, else none — always via `medalFor`.
- Per-player row 18 px, identical styling, fixed order: "● Red 3 · ● Blue 4" (online appends "(you)" to your colour). Never ranked.
- Best line: "NEW BEST!" rotated sticker when `teamStrokes < best.teamStrokes` (or no best) else "Best on this hole: {n} · {MEDAL}". Writes `fg.v1.best[levelId]` on both browsers online.
- Buttons: **Next hole** 240×52 primary auto-focus ("See results" on the last hole) · **Retry hole** 200×48 (host only online; guest caption "Ask Red to retry"; requires CD-2, else hidden) · **Quit to title** ghost (online: Leave confirm).
- Online: Next from **either** player sends `continue` (CD-1); the other sees toast "Blue moved on to the next hole". No auto-advance.
- Keys: Enter/Space/A = Next; Esc = pause menu. Live region: "Hole 2 complete. Team 7, par 8, 1 under par, gold medal."

### 3.8 CAMPAIGN RESULTS `<CampaignResults>` — on `campaignComplete`
Full-viewport sky; both golfers high-five (two frames, 0.4 s loop ×3) at the centre bottom; red/blue/gold confetti (30 pieces, 2 s; none under reduced motion); fanfare. Panel `min(92vw,820px)`:
- "WORLD 1 COMPLETE" 20 px; "TEAM {total} · COURSE PAR {par}" 48 px; verdict "{k} UNDER COURSE PAR" / "EVEN WITH COURSE PAR" / "{k} OVER COURSE PAR" 28 px.
- Scorecard, 5 columns **Hole · Par · Team · ± · Medal**, 4 rows + TOTAL row; per-player totals line 16 px grey "Red 14 · Blue 15".
- "PERFECT ROUND" ribbon when all four are gold; summary "4 gold · 0 silver · 0 bronze".
- Buttons: **Play again** (local: new sim at hole 1; online: host sends `playAgain`, guest sees "Waiting for Red to start a new round…" and a **Title** button) · **Level select** (→ TITLE with the tray focused) · **Title**. Online Title/Level select = Leave confirm.

### 3.9 Error / disconnect states `<NetOverlay>` — online only; every transition also goes to the live region; terminal states have exactly one exit; non-terminal ones never auto-navigate
| state | trigger (`ClientStatus` / message) | visual | actions |
|---|---|---|---|
| RECONNECTING | own socket closed unexpectedly (`reconnecting`) or boot with `fg.reconnect` | centre card: spinner, "CONNECTION LOST", "Reconnecting… {s} s left" (60 → 0, from the drop time); boot variant "Rejoining room {code}…" | **Leave game** ghost. Success → toast "Reconnected", overlay closes, latest snapshot applied |
| LOST | `closed`/`error{BAD_TOKEN|ROOM_NOT_FOUND}` after the window | "COULDN'T RECONNECT" sub "The room has closed or the connection is down. Your best medals are saved." | **Back to title** · Copy room code |
| PARTNER_AWAY | `peerLeft{reason:'disconnected', graceMs}` + `paused{true}` | top-band banner (world stays visible): "Blue lost connection. Waiting {s} s for them…" with a countdown ring; sub "They can rejoin with room code {code}" | **Keep waiting** (default) · Leave game |
| PARTNER_BACK | `peerReconnected` + `paused{false}` | toast "Blue is back!" 1.5 s | — |
| PARTNER_LEFT | `roomClosed{guestLeft|hostLeft}` or `roomClosed{peerTimeout}` | modal "BLUE LEFT THE GAME" / "BLUE DIDN'T COME BACK" sub "Thanks for playing together." | **Back to title** · Create a new room (host) |
| ROOM_CLOSED | `roomClosed{idle|serverShutdown}` | "THE ROOM CLOSED" sub "The server closed this room. Your best medals are saved." | **Back to title** |
| OFFLINE | browser `offline` event | net pill `--bad` + toast "You're offline"; escalates to RECONNECTING when the socket closes | — |
| BAD_COMMAND | `error{NOT_YOUR_TURN|WRONG_PHASE|RATE_LIMITED}` | toast only: "That move wasn't allowed (not your turn)" / "Not right now" / "Slow down a little" | — |
Fallback: if the server ships without the grace period, `peerLeft` is treated as PARTNER_LEFT immediately and the PARTNER_AWAY row is unused. `GameClient.leave()` is idempotent and marks the close intentional, so Cancel/Leave never produce an overlay.

### 3.10 SETTINGS `<Settings>` — overlay from Title gear or Pause; card `min(92vw,520px)`; rows 52 px, whole row clickable; apply immediately, persist to `fg.v1.settings`
1. **Sound effects** toggle (default on; key M mirrors it)
2. **Music** toggle (default **on**, −18 dB generative bed from the audio track; forced silent while SFX are muted)
3. **Reduced motion** segmented System / On / Off (default System = `prefers-reduced-motion`). On: no shake, no particles/confetti, banners/callouts fade instead of slide/scale, camera cuts instead of tweens, clouds static. Ball flight is never altered.
4. **Control hints** segmented Off / Auto / Keyboard / Mouse / Touch / Gamepad (default Auto)
5. **Reset best medals** → confirm "Clear all best results on this device?" [Clear] [Cancel]
Footer **Done** (primary); Esc/B closes.

### 3.11 ROTATE prompt `<RotatePrompt>`
Condition: `matchMedia('(orientation: portrait)')` AND `min(innerWidth, innerHeight) < 600`. Full-viewport paper card: rotating-phone glyph (CSS animation; static under reduced motion), "Turn your phone sideways", "Flash Golf plays in landscape.", text button **"Play anyway"** (dismisses for the session; the stage scales to width and the HUD runs compact at `--hud-scale` 1.7). View-only; never pauses the sim.

### 3.12 Share link `?state=` `<SharedStateCard>` (locked 16)
Producer: Pause → "Copy share link" (local modes; only when both balls are settled, i.e. any `intro`/`aiming`/`levelResults` state) via `buildShareUrl(location.origin, state)` (≤ 600 chars). Consumer: boot `readStateParam()` → `decodeShareLink`; success → Title card 640×96 above the mode buttons: "SHARED GAME · Hole {order} · Team {strokes} strokes · {Colour} to play" with **Continue solo** (primary), **Continue 2 players**, ✕. Continue → GAME(local session with `initial` state; `config.playerCount` per the button; online payloads are downgraded to local). Failure → card "This link is broken or from an older version." with ✕ (no frozen loop). The address bar is never rewritten during play.

---

## 4. In-game HUD (stage space, React/DOM, never canvas text)

### 4.1 Six anchored clusters (`hud-layout.html` is the reference implementation)
Each cluster is `position:absolute; display:flex; gap:8px` and scales from its own anchor: `transform: scale(var(--hud-scale))` with `transform-origin` = the anchor corner (TC/toasts/banner use `translateX(-50%) scale(s)` with origin top/bottom centre). Logical sizes below are at s = 1; the cluster's footprint is size × s. **HUD bands**: `band = 12 + 48·s + 8` px at the top and bottom (68 normal, 102 at s = 1.7).

| cluster | anchor | contents, normal (stageScale ≥ 0.85) | contents, compact (stageScale < 0.85) |
|---|---|---|---|
| TL | left 16, top 12 | `<LevelChip>` ≤ 332×48: "HOLE 2/4 · PLATE & BRIDGE" 20 px + "PAR 9" pill 15 px. Tap/click toggles the hint pill; title tooltip "Hints (H)" | 150×48: "HOLE 2/4" + "PAR 9" pill (name hidden) |
| TC | centre x 640, top 12 | `<TeamScore>` 280×48: "TEAM" 15 px tracking .08em · "5" 28 px · "/ PAR 9" 16 px · delta badge 16 px (`−1` `--mint`, `E` grey, `+2` `--warn`), badge pulses 300 ms on change | 200×48: "TEAM" 15 px · "5" 28 px · "/ PAR 9" 16 px · delta badge 16 px, gap 6 px (verified at 1.7× in §13) |
| TR | right 16, top 12 | `<PlayerChip>`×2 160×48 each (dot 18 · name 18 px over sub 15 px · count 22 px right) → `<IconButton mute>` 48 → `<IconButton pause>` 48. Chip subs: online YOU / PARTNER, local P1 / P2, solo none. **Active** chip: player-colour fill, white text, raised 2 px, shadow 7 px, scale 1.06, caret "▶" before the dot; inactive 72 % opacity; a sunk ball shows a flag glyph instead of the count | chips content-sized (local "● YOU 3" ≈ 104, partner "● 2" ≈ 64, local-2P "● P1 3" ≈ 90) → pause 48. **Mute moves into the pause menu.** |
| BL | left 16, bottom 12 | `<PowerMeter>` 300×48: "POWER" 15 px · 18 px bar (`--grass`→`--sun`→`--p1`), ticks 25/50/75 · "62" 22 px · "45°" 15 px → `<HintPill>` ≤ 560×40 (ink 78 %, white 16 px, ellipsis) | meter 220×44 without the angle readout, **hidden when device = touch** (the canvas band + floating power number carry it) → hint pill ≤ 300×40 |
| BR | right 16, bottom 12 | `<NetPill>` 110×28 "● 48 ms" 15 px (online only; dot `--mint` < 120 ms, `--warn` < 300, `--bad` otherwise / no pong 3 s) → `<IconButton camera>` 48 | same |
| banner | centre x 640, top `band + 12` | `<TurnBanner>` 500×56: fill = active player colour, 28 px white with 2 px ink stroke, sub-line 15 px; slides down 200 ms (fade only under reduced motion), holds 1.2 s, slides up. Also used for stage announcements (`tone:'info'`, `--paper` fill): "HOLE COMPLETE!" (1.2 s), "HOLE RESTARTED", "OUT OF BOUNDS · +1 STROKE" | same |
| toasts | centre x 640, bottom `band + 8` | `<Toasts>` 400×40 ink pill 16 px white, 2.5 s, max 2 stacked | same |

Collision proof at s = 1.7 (compact): TL 16–271 · TC 470–810 · TR ≈ 863–1264 (two local-2P chips: 849–1264) · BL ≤ 16–920 (meter + hint) · BR 982–1264. At s = 1.06 (normal, the largest normal scale): TL ≤ 16–368 · TC 492–788 · TR 798–1264 · BL ≤ 16–940 · BR 1088–1264. Screenshots in §13.

### 4.2 Data flow
`GameCanvas.onFrame(FrameSummary)` at 10 Hz + `onEvents(SimEvent[])` → `useHudSnapshot()` derives:
```ts
type HudSnapshot = {
  holeNumber: number; holeCount: number; levelName: string; par: number;
  teamStrokes: number; strokes: [number, number]; sunk: [boolean, boolean];
  activePlayer: PlayerId; phase: SimPhase; turnReady: boolean;
  aim: Aim | null; aimOwner: PlayerId | null;   // mine = input.localAim() echo; partner's = state.players[active].aim (online)
  seat: PlayerId | null; mode: SimMode; cameraMode: CameraMode; device: InputDevice;
  net: { rttMs: number; peerConnected: boolean; offline: boolean } | null;
};
```
memoised by shallow equality so React re-renders at most 10 Hz while aiming and only on events otherwise. `<Hud>` receives only `HudSnapshot` + callbacks, never `SimState`. Requires `FrameSummary.sunk` (CD-7).

### 4.3 Per-phase behaviour
| phase | chips | hint pill | power meter | banner | canvas |
|---|---|---|---|---|---|
| intro | both 72 % | hidden | hidden | — | overview camera, scrim |
| aiming, my turn | mine active | device hint (§9 `hint.aim.*`) for the first 3 own turns on hole 1, then 2.5 s per turn; always on H / level chip | live, my colour | "YOUR TURN" / "RED'S TURN" once (§4.4) | my band/arc/landing ring, dashed grab ring (pointer/touch), "YOU" tag |
| aiming, partner's turn (online) | theirs active | "Blue is lining up a shot…" | their live aim, their colour, 60 % opacity | "BLUE'S TURN" + "your partner" | partner's dotted arc 55 % alpha + "BLUE AIMING" tag above their ball |
| aiming, other ball (solo/local) | that ball's chip active | device hint | live | "BLUE'S TURN" (solo) / "BLUE'S TURN · P2" (local) | band/arc for whoever holds the device |
| flying | unchanged | "Red's shot…" | frozen at shot value, 60 % | world callouts only | camera follows the moving ball; drag input ignored |
| turnDelay (27 ticks) | caret slides old → new chip over 0.35 s (matches the golfer walk) | "Shot queued…" if a shoot is buffered | hidden | next turn banner fires at `turnStart` | golfer walk/hop |
| levelResults | both 72 % | hidden | hidden | "HOLE COMPLETE!" 1.2 s then the card | overview |
| paused (local) | dimmed 40 % | — | — | — | last frame |
| menu (online) | visible at scrim edges | — | — | still plays | live |

### 4.4 Turn banner copy
Solo: "RED'S TURN" / "BLUE'S TURN". Local: "RED'S TURN · P1" / "BLUE'S TURN · P2". Online, me: "YOUR TURN"; partner: "BLUE'S TURN" with sub-line "your partner". Also pushed to the live region.

### 4.5 World-anchored canvas text (art, not HUD; `src/view/render/calloutCopy.ts`)
- **Callouts** at the ball/mechanic, 60 px above, 44 px display white with 8 px ink stroke, scale-pop 170 ms, hold 500 ms, rise + fade 250 ms (fade only under reduced motion); max 2 alive; the anchor is clamped inside the stage and outside the HUD bands:
  `gimme` "GIMME! +1" (`--mint`, 1.3×, 3 stars) · `sink` "IN THE HOLE!" (`--mint`) · `fellOffWorld` "OUT! +1" (`--p1`) + DOM banner · `hazardBlock` "LOCKED!" in the gate colour with sub "BLUE ONLY" (gate flashes solid) · `spring` "BOING!" (`--sun`) · `bumper` "BONK!" (bumper orange) · `enterSand` "SAND…" (28 px) · `fan` "LIFT!" · `switchOn` "SWITCH {n} HELD" (20 px above the plate) / `switchOff` "SWITCH {n} FREE" · `bridgeToggle` "BRIDGE OPEN" / "BRIDGE GONE", blocker "GATE OPEN" / "GATE SHUT" · `nearCup`/`lipOut` "SO CLOSE".
- **Tags** (18 px white on player colour, 26 px pill): "YOU" above the local golfer for the first 6 s of every level and whenever it is your turn (online only); "BLUE AIMING" above the partner's ball while their arc is shown.
- **Grab ring**: dashed `--ink` 35 % circle of `GRAB_RADIUS` around the active ball while it is my turn and device ∈ {pointer, touch}; radius is in stage px regardless of camera zoom.
- **Floating power number**: display-M "62" 40 px above the ball while dragging (so touch players never need the DOM meter).

### 4.6 Camera contract (`cameraFor`, view agent)
- Follow: zoom 1, y fixed 0 (levels are 720 tall). While `phase === 'aiming'` and the local seat is active, the target x places the active ball at **45 % width when aiming right (deg ≤ 90)** and **55 % when aiming left**, tweened 250 ms; otherwise the moving ball at 45 %. Clamp `cam.x ∈ [−overscan, width − 1280]` with `overscan = clamp(280 − ball.x, 0, 220)` so the active ball always sits ≥ 280 px from the left stage edge (overscan shows sky/hills past the level edge; it only triggers for non-compliant levels or shared states).
- HUD bands are reserved: top and bottom `12 + 48·s + 8` (max 102 px). **Level rule (CD-5):** tees `starts[i].x ≥ 280`; every restable surface y ∈ [220, 580] so a resting ball never sits inside a HUD band.
- **Downward pull room.** A pointer pull for power `p` at shot angle `θ` ends at `pullEndY = ballY + (24 + 216·(p − 10)/90)·sin θ`, which must stay ≤ 720 (the stage bottom; on side-letterboxed phones that is also the screen edge). Full power (pull 240 px) is therefore reachable up to θ ≤ 39° from a surface at y 580, ≤ 47° from a green at y 556, ≤ 66° from a fairway at y 512 and at any angle from y ≤ 480. The LEVELS solver must verify the intended co-op path with **touch-reachable shots only** (`pullEndY ≤ 720`); in practice that means steep full-power lobs are taken from surfaces at y ≤ 512 and greens only need flat putts. When a pull is clipped by the viewport the HUD/floating number shows the capped power, so the player sees what will be sent.
- Overview: `zoom = min(1280/width, 1)`, centred, ground at ~70 % height; stickers/tags keep screen scale.

---

## 5. Controls (`src/view/input/*`) — constants in `src/view/input/constants.ts`

```ts
export const GRAB_RADIUS_TOUCH = 80, GRAB_RADIUS_MOUSE = 48;   // stage px around the active ball's screen position
export const DRAG_DEAD_ZONE = 24;                               // also the cancel ring radius
export const PULL_MAX = 240;                                    // drag length (incl. dead zone) for power 100
export const TAP_MAX_PX = 8, TAP_MAX_MS = 250;                  // a tap never shoots
export const AIM_DEG_MIN = 3, AIM_DEG_MAX = 177;                // -> radians via -deg*PI/180 (inside sim range)
export const KEY_ANGLE_SLOW = 45, KEY_ANGLE_FAST = 110, KEY_ANGLE_FINE = 12;  // deg/s; fast after KEY_ACCEL_MS held
export const KEY_ACCEL_MS = 350, KEY_POWER_RATE = 45, KEY_POWER_FINE = 10;    // power units/s
export const KEY_TAP_MIN_STEP = 1;                              // a tap < KEY_ACCEL_MS moves ≥ 1 deg / 1 power
export const SHOOT_QUEUE_MAX_MS = 600;                          // shoot pressed during turnDelay fires when ready
export const PAD_STICK_ENGAGE = 0.5, PAD_STICK_RELEASE = 0.35, PAD_TRIGGER_DEAD = 0.10;
export const PAD_BUTTON_DEBOUNCE_MS = 40, PAD_REPEAT_DELAY_MS = 350, PAD_REPEAT_HZ = 10;
export const NET_AIM_HZ = 20;
```
`types.ts` currently carries `DRAG_*`/`KEY_*` with other values; CD-4 asks the lead to update them to these or delete them so one file owns the numbers.

### 5.1 Keyboard (`keyboard.ts`, `event.code`)
- `ArrowLeft`/`KeyA` angle + (aim more left), `ArrowRight`/`KeyD` angle −, `ArrowUp`/`KeyW` power +, `ArrowDown`/`KeyS` power −, `Space`/`Enter` shoot (keydown, no repeat), `Tab`/`KeyC` camera, `Escape` pause, `KeyM` mute, `KeyH`/`Slash` hints (replays the coach on H), `Shift` fine.
- Rates: angle 45°/s for the first 350 ms, then 110°/s; Shift 12°/s. Power 45/s, Shift 10/s. Clamp hits play a 60 ms "bump" SFX. A tap shorter than 350 ms moves at least 1° / 1 power.
- Space during `turnDelay` queues the shoot (hint "Shot queued…", fires within 600 ms). Space while a card is up activates the focused button (DOM), never shoots.
- `preventDefault` only when `document.activeElement` is `body`, the canvas or `.stage`; Tab is captured only when the canvas has focus. `blur`/`visibilitychange(hidden)` clear held keys; Ctrl/Meta/Alt combos ignored.

### 5.2 Pointer slingshot (`pointer.ts`, Pointer Events; mouse + touch + pen)
- Canvas: `touch-action:none; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; -webkit-tap-highlight-color:transparent`; `contextmenu` prevented.
- **Grab zone**: `pointerdown` starts a drag only within `GRAB_RADIUS_TOUCH` (80, `pointerType==='touch'`) or `GRAB_RADIUS_MOUSE` (48) of the active ball's screen position, in stage px. `setPointerCapture` keeps the drag alive over the letterbox and outside the canvas. Not "anywhere": stray taps never cost a stroke.
- **Miss feedback**: a press outside the zone during my turn does nothing to the sim; the ball emits 3 expanding rings (0.6 s) and the hint pill shows "Drag back from YOUR ball" with an arrow glyph; after 2 consecutive misses a world callout "DRAG FROM YOUR BALL" with an in-world arrow for 2 s. Pressing on the other ball: "That's the blue ball — red is up". Any press by the non-active player (online): their chip wobbles 220 ms and the hint pill says "Blue's turn — your ball is the red one".
- **Drag math** (stage px, camera-independent): `d = P_now − P_down`, `L = |d|`. `L < 24`: armed — grey band + dashed cancel ring r 24 around `P_down`, no `setAim`. Direction `shotDir = −d`; `deg = atan2(−shotDir.y, shotDir.x)` clamped to [3, 177]; while clamping the band turns `--warn` with caption "aim up". Power `round(10 + 90 × clamp((L − 24)/(240 − 24), 0, 1))`; beyond 240 the band stops stretching and reads 100. Each changed (deg, power) emits `setAim`.
- **Visuals**: rubber band ball→pointer (6→12 px with power, player colour, 3 px outline), ghost pull-ball at the pointer, honest arc (`predictShot`, real step on a scratch ball; 24 dots, one per 3 ticks, fading 1.0→0.25, stops at the landing ring r 10), HUD meter mirror, floating power number.
- **Release** with `L ≥ 24` → final `setAim` then `shoot`. **Cancel** (no command; "whiff" SFX; previous aim kept): release inside the ring (ring glows, caption "Release to cancel"), `pointercancel`, a second touch point, Esc, right button, `blur`, resize mid-drag. **Tap** (< 8 px and < 250 ms) on the ball: no shot, shows the hint pill. Tap elsewhere: nothing (no pan; overview is a button).
- Cursor: `grab` in the zone on my turn, `grabbing` while dragging.
- Test (jsdom): press at the ball, move 132 px to the lower-left ⇒ deg 45, power 55 (`10 + 90·(132−24)/216`); move 10 px ⇒ no command; release inside the ring ⇒ no shoot; release outside ⇒ one `shoot` after a final `setAim`.

### 5.3 Gamepad (`gamepad.ts`, standard mapping, polled per rAF)
- Left stick: **absolute** aim with hysteresis — while magnitude > 0.5 the angle = `atan2(−y, x)` clamped to [3°, 177°] at 1° resolution; below 0.35 the stick disengages and the last angle stays (sticky). No snapping grid.
- D-pad ←/→ ±1° per press, auto-repeat 10/s after 350 ms; D-pad ↑/↓ ±1 power, same repeat. LB/RB ±5 power.
- RT (`buttons[7].value`) > 0.10 sets `power = round(10 + 90 × (v − 0.1)/0.9)` directly; releasing **latches** the value. LT unused.
- A (0) shoot/confirm · B (1) cancel/back/close · Start (9) pause · Y (3) camera · X (2) hints · Select (8) mute. Rising edges, 40 ms debounce.
- Menus: D-pad/stick moves DOM focus (`.focus()` on the next focusable), A clicks, B = Esc. Local 2P: pad index 0 = P1, 1 = P2 (wrong-slot press shows "That's P2's controller" 1 s); one pad controls the active ball; online any pad = local seat. `gamepadconnected` toast "Controller connected".

### 5.4 Presentation rules (all devices)
Protractor guide (faint 180° arc r 56, 20 % alpha, tick at the current angle) only for keyboard/gamepad; power ↔ band ↔ meter always agree numerically; the HUD readout is the exact pair sent.

### 5.5 Onboarding coach `<Coach>` (view-only; never blocks input)
- Shown on the first `aiming` of hole 1 when `fg.v1.onboarded !== '1'`, and on H / level-chip tap any time. Online: the active player gets the real coach; the partner gets the passive line "Blue goes first — you'll get the same prompt on your turn" (so the guest never thinks hole 1 is frozen).
- In-world 3-step strip anchored to the ball: (1) animated hand pressing the ball and pulling back 160 px along the default aim with the band appearing, loop 1.6 s, text "Drag back from the ball…"; (2) "…let go to shoot"; (3) once per session on the first level whose `mechanicsIntroduced` includes `'switch'`, after that level's first shot: "A resting ball keeps a switch pressed — hold it for your partner." Keyboard variant shows keycaps `← →` `↑ ↓` `Space`; gamepad `LS` `RT` `Ⓐ`.
- Fades the moment a drag starts / a key is held; `fg.v1.onboarded = '1'` is written after the first `shoot` command.
- The one confusion worth designing against: pushing the finger **toward** the hole. The armed/short push shows the arc pointing the other way, the coach pulls back, and any push shorter than 24 px is a cancel, not a shot.

---

## 6. Responsive, mobile Safari, accessibility, performance

- `html, body { height:100%; overflow:hidden; position:fixed; width:100%; overscroll-behavior:none }`; `#root` uses `inset:0` (never `100vh`); viewport meta per §3.3; safe-area padding on `#root` so the notch lands in the letterbox.
- Buttons: `touch-action: manipulation`, no hover-only states, `:active` press feedback; lobby inputs ≥ 16 px CSS font. `user-scalable=no` is NOT set.
- Audio: context created lazily; `resume()` inside the first `pointerdown`/`keydown`/`click` and again on `visibilitychange → visible`; mute = master gain, never `close()`.
- `requestAnimationFrame` loop pauses on `document.hidden`; on return local modes resume with `acc = 0` (no catch-up burst), online re-syncs from the next snapshot.
- Accessibility: one `aria-live="polite" aria-atomic="true"` `<LiveRegion>` (messages de-duplicated within 500 ms): turn changes, callouts, "Ball settled, 3 strokes", results summaries, connection and lobby status. Every modal traps focus, focuses its primary, restores focus on close. Canvas `tabindex="0" aria-label="Golf course. Use arrow keys to aim, Space to shoot."`. HUD tab order: canvas → pause → camera (→ mute in normal mode). Keyboard-only and touch-only are both complete (§10). Reduced motion per §3.10. No gameplay timers; the only countdowns are the 60 s grace and the 10 s repeat-intro ring.
- Performance: React HUD ≤ 10 Hz; canvas 60 Hz; terrain cached per level per DPR (view agent).

---

## 7. Persistence (`src/app/storage.ts`, every call in try/catch; blocked storage degrades to defaults silently)
| key | store | shape |
|---|---|---|
| `fg.v1.settings` | localStorage | `Settings` (§8) — `{ muted:false, music:true, reducedMotion:'system', hintDevice:'auto', hints:true, lastMode:'solo' }` defaults |
| `fg.v1.best` | localStorage | `Record<levelId, LevelBest>`, `LevelBest = { teamStrokes: number; strokes: [number, number]; at: number }`; written only when `teamStrokes` improves or no record; medal recomputed with `medalFor` at read |
| `fg.v1.onboarded` | localStorage | `'1'` after the first `shoot` command ever |
| `fg.reconnect` | sessionStorage | `{ code, token, seat }` — owned by `GameClient` (ARCH); cleared on `leave()` and terminal states |
`audio.ts` must not persist on its own (`'fg.muted'`, `'flashgolf.audio.music'` in the audio/arch drafts); the App pushes `settings.muted/music` into it on boot and on change (CD-4).

---

## 8. React components (`src/ui/`) and types

```ts
import type { Aim, Level, LevelResult, Medal, PlayerId, SimConfig, SimMode, SimPhase, SimState } from '../sim/types';
import type { CameraMode, InputDevice } from '../view/view';
import type { ClientStatus, GameClient } from '../net/GameClient';
import type { FrameSummary, LocalSession, OnlineSessionView } from '../view/GameCanvas';

export type Settings = { muted: boolean; music: boolean; reducedMotion: 'system' | 'on' | 'off';
                         hintDevice: 'auto' | InputDevice; hints: boolean; lastMode: SimMode };
export type LevelBest = { teamStrokes: number; strokes: [number, number]; at: number };
export type BestTable = Record<string, LevelBest>;
export type LobbyError = { reason: 'room_not_found' | 'room_full' | 'unreachable' | 'server_full' | 'bad_version' | 'bad_token'; code?: string };
export type LobbyView =
  | { sub: 'menu' } | { sub: 'connecting'; slow: boolean }
  | { sub: 'hosting'; code: string; inviteUrl: string; startIndex: number }
  | { sub: 'ready'; code: string; inviteUrl: string; startIndex: number }
  | { sub: 'joined'; code: string }
  | { sub: 'error'; error: LobbyError };                   // derived from ClientStatus in useLobbyView()
export type NetOverlayKind = 'reconnecting' | 'lost' | 'partnerAway' | 'partnerLeft' | 'roomClosed';
export type Toast = { id: number; text: string; tone?: 'info' | 'good' | 'bad' };

<App />                                                    // owns AppRoute, Overlay stack, Settings, BestTable, toasts, GameClient|null
<Title best={BestTable} levels={readonly Level[]} settings={Settings} selectedLevelId={string} shared?: AppRoute['shared']
       onlineAvailable={boolean} onSelectLevel(id) onPlay(mode: SimMode, levelId: string) onContinueShared(playerCount: 1|2)
       onDismissShared() onOpenSettings() onToggleMute() />
<LevelSelect levels best selectedId onSelect(id) onActivate(id) compact?: boolean />
<MedalDisc medal={Medal} size={20|28|42|96} label?: boolean />
<Lobby client={GameClient} view={LobbyView} levels onCreate() onJoin(code) onStart(startIndex) onSetStart(i) onCancel() onLeave()
       onRetry() onBack() onPlaySolo() />
<RoomCodeInput value onChange(v) onSubmit() disabled? />
<GameScreen session={LocalSession|OnlineSessionView} settings best onBest(levelId, LevelBest) onQuit() />   // composes GameCanvas + Hud + cards + overlays
<Hud snap={HudSnapshot} compact={boolean} muted hintText={string|null} onPause() onToggleMute() onToggleCamera() onToggleHint() />
  <LevelChip holeNumber holeCount name par compact onClick() />
  <TeamScore strokes par compact />
  <PlayerChip player={PlayerId} strokes active sunk sub={'YOU'|'PARTNER'|'P1'|'P2'|null} compact wobbleNonce={number} />
  <PowerMeter power angleDeg color compact showAngle />
  <HintPill text={string|null} />
  <NetPill rttMs offline />
  <IconButton icon={'mute'|'unmute'|'pause'|'camera-overview'|'camera-follow'|'gear'|'back'|'close'} label shortcut? pressed? onClick() />
<TurnBanner text sub? color tone={'player'|'info'} nonce={number} />
<Toasts items={Toast[]} />
<Coach step={1|2|3} device={InputDevice} anchor={{x,y}} aimDeg passive?: boolean visible onDone() />
<LiveRegion message={string} />
<LevelIntro level holeNumber holeCount firstPlayer={PlayerId} mode seat={PlayerId|null} autoAdvanceMs={number|null} onContinue() />
<LevelResults level holeNumber holeCount result={LevelResult} best?: LevelBest isNewBest mode seat isHost isLast canRetry
              onNext() onRetry() onQuit() />
<CampaignResults rows={{ level: Level; result: LevelResult }[]} coursePar total mode isHost onPlayAgain() onLevelSelect() onTitle() />
<PauseMenu mode isHost roomCode? onResume() onRestart() onCopyShare?(): Promise<boolean> onCopyInvite?(): Promise<boolean> onSettings() onQuit() />
<ConfirmDialog title body confirmLabel cancelLabel danger? onConfirm() onCancel() />
<Settings settings onChange(patch: Partial<Settings>) onResetBest() onClose() />
<NetOverlay kind={NetOverlayKind} partner={PlayerId} roomCode secondsLeft? isHost onKeepWaiting() onLeave() onBack() onCreateRoom() />
<RotatePrompt onPlayAnyway() />
<SharedStateCard summary={{ holeNumber, teamStrokes, toPlay: PlayerId }|'invalid'} onContinue(playerCount: 1|2) onDismiss() />
```
Hooks: `useHudSnapshot(frame, level, status, seat, mode, localAim)` (memo), `useLobbyView(status)`, `useLiveRegion()`, `useOverlayStack()`.

---

## 9. Copy table (single source: `src/ui/copy.ts`; world callouts in `src/view/render/calloutCopy.ts`)

### 9.1 Keys
| key | text |
|---|---|
| title.tagline | Two balls, one team. Aim, shoot, flip switches for each other. |
| title.solo / .solo.sub | SOLO / You play both balls |
| title.local / .local.sub | 2 PLAYERS · ONE SCREEN / Take turns on this keyboard or touchscreen |
| title.online / .online.sub | ONLINE WITH A FRIEND / Send a link, play together |
| title.online.unavailable | Online isn't configured on this build. |
| title.world | WORLD 1 · TEACH · 4 HOLES |
| title.tile.new / .notPlayed / .startHere | NEW: {mechanic} / NOT PLAYED / START HERE |
| title.tile.under / .par / .over | TEAM {n} · {k} UNDER / TEAM {n} · ON PAR / TEAM {n} · +{k} OVER |
| title.medalLegend | Gold: under par · Silver: par · Bronze: par +2 or better |
| title.a11y | Flash Golf. Solo, 2 players, or online with a friend. |
| shared.title | SHARED GAME · Hole {n} · Team {strokes} strokes · {Colour} to play |
| shared.continueSolo / .continue2p / .broken | Continue solo / Continue 2 players / This link is broken or from an older version. |
| lobby.title / .sub | PLAY ONLINE / Two browsers, one team. Share a 5-letter code or a link. |
| lobby.create / .or / .code.placeholder / .join | Create a room / or join a friend's room / ROOM CODE / Join |
| lobby.note | No account needed. Rooms close when empty. |
| lobby.connecting / .waking / .cancel | Connecting… / Waking up the server — this can take a few seconds. / Cancel |
| lobby.yourRoom / .codeLabel | YOUR ROOM / ROOM CODE |
| lobby.copyCode / .copyLink / .share / .copied / .longPress | Copy code / Copy invite link / Share… / Copied! / Long-press to copy |
| lobby.shareText | Play a round of co-op golf with me — room {code} |
| lobby.waitingPartner | Waiting for your partner to open the link… |
| lobby.startAt / .hole | START AT / Hole {n} |
| lobby.start / .start.needs2 / .start.ready / .cancelRoom | Start game / Needs 2 players / Start game — Blue is here! / Cancel room |
| lobby.joinedTitle / .chip.host / .chip.you / .chip.partner | JOINED ROOM {code} / HOST / YOU / PARTNER |
| lobby.partnerJoined | Blue joined! Press Start when you're both ready. |
| lobby.partnerLeft | Blue left. Waiting for a partner… |
| lobby.waitingHost | Waiting for Red to start the game… |
| lobby.preteach | While you wait: you play the blue ball. Pull back from it to shoot. |
| lobby.leave / .back / .retry / .tryAgain / .createOwn / .playSolo / .reload | Leave room / Back / Retry / Try again / Create my own room / Play solo instead / Reload |
| lobby.leaveConfirm | Leave the room? |
| lobby.err.title.join / .connect | COULDN'T JOIN / COULDN'T CONNECT |
| lobby.err.notFound | Room {code} isn't open. It may have ended or the code is mistyped. |
| lobby.err.full | Room {code} already has two players. |
| lobby.err.unreachable | Can't reach the game server. Check your connection and try again. |
| lobby.err.serverFull | The server is busy right now. Try again in a minute. |
| lobby.err.version | Your game is out of date — reload the page to update. |
| lobby.err.badToken | Couldn't rejoin: the room moved on without you. |
| intro.hole / .par / .new | HOLE {n} OF {count} / PAR {par} / NEW: {mechanic} |
| intro.first.solo | You shoot both balls, alternating. {Colour} first. |
| intro.first.local | {Colour} goes first (Player {n}) |
| intro.first.you / .partner | You go first / {Colour} goes first — that's your partner |
| intro.teeOff / .orTap / .orSpace / .orA | Tee off / or tap anywhere / or press Space / or press Ⓐ |
| hud.hole / .hole.compact / .par | HOLE {n}/{count} · {NAME} / HOLE {n}/{count} / PAR {par} |
| hud.team / .teamPar / .delta.even / .under / .over | TEAM / / PAR {par} / E / −{n} / +{n} |
| hud.you / .partner / .p1 / .p2 | YOU / PARTNER / P1 / P2 |
| hud.power / .angle | POWER / {deg}° |
| hud.mute / .unmute / .pause / .menu / .overview / .follow / .hints | Mute (M) / Unmute (M) / Pause (Esc) / Menu (Esc) / Overview (Tab) / Follow ball (Tab) / Hints (H) |
| hud.net | {ms} ms |
| hint.aim.touch | Pull back from your ball, let go to shoot |
| hint.aim.pointer | Drag back from your ball, release to shoot · drag onto the ball to cancel |
| hint.aim.keyboard | ← → aim · ↑ ↓ power · Space shoot |
| hint.aim.gamepad | LS aim · RT power · Ⓐ shoot |
| hint.miss / .miss.big / .wrongBall / .notYourTurn | Drag back from YOUR ball / DRAG FROM YOUR BALL / That's the {other} ball — {colour} is up / {Colour}'s turn — your ball is the {mine} one |
| hint.partnerAiming / .flying / .queued / .cancel / .aimUp | {Colour} is lining up a shot… / {Colour}'s shot… / Shot queued… / Release to cancel / aim up |
| banner.yourTurn / .turn / .turn.local / .partnerSub | YOUR TURN / {COLOUR}'S TURN / {COLOUR}'S TURN · P{n} / your partner |
| banner.holeComplete / .restarted / .oob | HOLE COMPLETE! / HOLE RESTARTED / OUT OF BOUNDS · +1 STROKE |
| coach.1 / .2 / .3 | Drag back from the ball… / …let go to shoot / A resting ball keeps a switch pressed — hold it for your partner. |
| coach.1.keyboard / .2.keyboard | ← → to aim, ↑ ↓ for power… / …Space to shoot |
| coach.1.gamepad / .2.gamepad | Left stick to aim, RT for power… / …Ⓐ to shoot |
| coach.passive | {Colour} goes first — you'll get the same prompt on your turn |
| pause.title / .menuTitle / .onlineNote | PAUSED / MENU / The game keeps running for {Colour}. |
| pause.resume / .restart / .share / .share.sub / .settings / .quit / .leave / .room / .copyInvite | Resume / Restart hole / Copy share link / Anyone with the link resumes this exact game. / Settings / Quit to title / Leave game / Room {code} / Copy invite link |
| pause.restart.title / .body / .body.online / .confirm / .cancel | Restart hole {n}? / Both balls go back to the tee and this hole's strokes reset to 0. Earlier holes are kept. / {Colour} will see a notice. / Restart / Keep playing |
| pause.restart.hostOnly | Only {Colour} (host) can restart |
| pause.quit.title / .body / .confirm / .cancel | Quit this game? / Progress on this hole is lost. Best medals are saved. / Quit / Stay |
| pause.leave.title / .body / .confirm | Leave the game? / {Colour} will be left waiting. / Leave |
| toast.teedOff / .movedOn / .restarted / .controller / .soundOn / .reconnected / .back / .offline / .copied | {Colour} teed off / {Colour} moved on to the next hole / {Colour} restarted the hole / Controller connected / Sound is on — use the speaker button to mute / Reconnected / {Colour} is back! / You're offline / Copied! |
| toast.notYourTurn / .notNow / .slowDown / .wrongPad | That move wasn't allowed (not your turn) / Not right now / Slow down a little / That's P{n}'s controller |
| results.hole / .team / .par | HOLE {n} COMPLETE / TEAM {strokes} / PAR {par} |
| results.under / .even / .over | {k} UNDER PAR / PAR / {k} OVER PAR |
| results.flavour.eagle / .birdie / .par / .bogey / .double / .none | Eagle territory! / Birdie! / Par — solid. / Bogey, still bronze. / Double bogey, bronze. / No medal — try again for bronze. |
| results.medal.gold / .silver / .bronze / .none / .none.sub | GOLD / SILVER / BRONZE / NO MEDAL / par +2 or better for bronze |
| results.player / .you | ● {Colour} {strokes} / (you) |
| results.newBest / .best | NEW BEST! / Best on this hole: {n} · {MEDAL} |
| results.next / .seeResults / .retry / .retry.ask / .quit | Next hole / See results / Retry hole / Ask {Colour} to retry / Quit to title |
| campaign.title / .team / .under / .even / .over | WORLD 1 COMPLETE / TEAM {total} · COURSE PAR {par} / {k} UNDER COURSE PAR / EVEN WITH COURSE PAR / {k} OVER COURSE PAR |
| campaign.cols / .total / .perfect / .summary / .players | Hole · Par · Team · ± · Medal / TOTAL / PERFECT ROUND / {g} gold · {s} silver · {b} bronze / Red {r} · Blue {b} |
| campaign.playAgain / .waitingHost / .levelSelect / .title | Play again / Waiting for Red to start a new round… / Level select / Title |
| settings.title / .sfx / .music / .motion / .hints / .reset / .done | SETTINGS / Sound effects / Music / Reduced motion / Control hints / Reset best medals / Done |
| settings.motion.system / .on / .off | System / On / Off |
| settings.hints.off / .auto / .keyboard / .mouse / .touch / .gamepad | Off / Auto / Keyboard / Mouse / Touch / Gamepad |
| settings.reset.confirm / .clear / .cancel | Clear all best results on this device? / Clear / Cancel |
| net.lostTitle / .reconnecting / .rejoining | CONNECTION LOST / Reconnecting… {s} s left / Rejoining room {code}… |
| net.failedTitle / .failed | COULDN'T RECONNECT / The room has closed or the connection is down. Your best medals are saved. |
| net.partnerAway / .partnerAway.sub / .keepWaiting | {Colour} lost connection. Waiting {s} s for them… / They can rejoin with room code {code} / Keep waiting |
| net.partnerLeftTitle / .partnerTimeoutTitle / .partnerLeft.sub | {COLOUR} LEFT THE GAME / {COLOUR} DIDN'T COME BACK / Thanks for playing together. |
| net.roomClosedTitle / .roomClosed | THE ROOM CLOSED / The server closed this room. Your best medals are saved. |
| net.backToTitle / .leave / .createNew / .copyCode | Back to title / Leave game / Create a new room / Copy room code |
| rotate.title / .sub / .anyway | Turn your phone sideways / Flash Golf plays in landscape. / Play anyway |
| a11y.canvas | Golf course. Use arrow keys to aim, Space to shoot. |

### 9.2 World callouts (`calloutCopy.ts`)
`gimme` "GIMME! +1" · `sink` "IN THE HOLE!" · `fellOffWorld` "OUT! +1" · `hazardBlock` "LOCKED!" + "{COLOUR} ONLY" · `spring` "BOING!" · `bumper` "BONK!" · `enterSand` "SAND…" · `fan` "LIFT!" · `switchOn` "SWITCH {n} HELD" · `switchOff` "SWITCH {n} FREE" · `bridgeToggle` "BRIDGE OPEN" / "BRIDGE GONE" / "GATE OPEN" / "GATE SHUT" · `nearCup`/`lipOut` "SO CLOSE" · tags "YOU", "{COLOUR} AIMING" · miss "DRAG FROM YOUR BALL".

### 9.3 `MECHANIC_COPY: Record<MechanicKind, { name: string; blurb: string }>`
sand "SAND" / "Slows the ball and kills the bounce." · spring "SPRING" / "Lands you here, throws you up." · bumper "BUMPER" / "Bounces the ball away hard." · fan "FAN" / "Lifts anything that flies through it." · colourGate "COLOUR GATE" / "Only the matching ball passes; the other bounces off." · switch "PRESSURE SWITCH" / "A resting ball holds it down. Leave, and it releases." · bridge "BRIDGE" / "Exists only while its switch is held." · blocker "GATE" / "Vanishes while its switch is held."

### 9.4 Forbidden words test
`src/ui/__tests__/copy.test.ts` imports `copy.ts` and `calloutCopy.ts`, greps every string (and every `.tsx` under `src/ui/`) for `/\b(opponent|scoreboard|winner|wins|leaderboard|rank|1st|2nd)\b/i` and fails the build on a hit.

---

## 10. Bindings (`CONTROLS` constant; README and the hint pill derive from it)
| action | keyboard | pointer / touch | gamepad |
|---|---|---|---|
| aim angle | ← → / A D (Shift fine) | drag direction (slingshot) | LS absolute, D-pad ←→ ±1° |
| power | ↑ ↓ / W S (Shift fine) | drag length 24–240 px | RT absolute (latched), D-pad ↑↓ ±1, LB/RB ±5 |
| shoot | Space / Enter (canvas focused) | release the drag | Ⓐ |
| cancel aim | Esc during a drag | drag back into the ring / 2nd finger / right-click | Ⓑ |
| camera | Tab (canvas focused) / C | overview button | Ⓨ |
| pause / menu | Esc | pause button | Start |
| mute | M | speaker button (pause menu in compact) | Select |
| hints / coach | H / ? | tap the level chip | Ⓧ |
| menus & cards | Tab / Enter / Esc, 1-2-3 on the Title | tap | D-pad / Ⓐ / Ⓑ |

---

## 11. First 60 seconds (what the design guarantees)
| t | phone, invite link | laptop, no instructions |
|---|---|---|
| 0–2 s | `?room=` → lobby "Joining room K7PQ2…" (no Title) | Title, last mode focused, backdrop is the game |
| 2–6 s | "Waiting for Red to start the game…" + "you play the blue ball" | Solo → intro "HOLE 1 OF 4 · PAR 6 · Red first" → Tee off |
| 6–10 s | host starts → intro card "Red goes first — that's your partner" | banner "RED'S TURN"; coach hand pulls back; hint pill |
| 10–20 s | Red's arc appears with "RED AIMING" — learning by watching | first shot ~10 s after the coach; arc + landing ring make it predictable |
| 20–30 s | "YOUR TURN" + "YOU" tag + coach → drag back → shoot | "BLUE'S TURN": alternation taught by the banner, not text |
| 30–60 s | callouts name mechanics on contact | first ball in or near the cup → "GIMME! +1" / "IN THE HOLE!" |

---

## 12. Contract deltas requested from the lead (each with a fallback)
| id | file / owner | change | fallback if refused |
|---|---|---|---|
| CD-1 | `sim.ts` `allowedCommands`, `server/rooms.ts`, `turns.test.ts` | In `online` mode accept `continue` from **either** seat in `intro` and `levelResults` (first wins; a second `continue` in the new phase is rejected as `wrongPhase` with no toast). Solo/local unchanged (seat 0). | Guest's Tee off / Next buttons become captions "Red tees off when ready" / "Waiting for Red…"; the guest can always Leave. |
| CD-2 | `sim.ts` | Allow `restartLevel` (host) in `levelResults` → rebuilds the current level, phase `aiming`. | "Retry hole" hidden on the results card; replay via Title level select. |
| CD-3 (optional) | `protocol.ts` | `lobbyLevel{startIndex}` host→server→guest so the guest sees "Starting at Hole 2" live. | Guest learns the start hole from the intro card (shipping behaviour of this spec). |
| CD-4 | `types.ts` (DRAG_*/KEY_*), `view/audio.ts` | Move/overwrite the input tuning numbers with §5's constants in `src/view/input/constants.ts`; audio.ts stops persisting mute/music itself (App owns `fg.v1.settings`). | App writes through to the audio keys as well; constants duplicated with a contract test asserting equality. |
| CD-5 | `levels.test.ts` (LEVELS agent) | Add asserts: `starts[i].x ≥ 280`; every polyline vertex that can hold a resting ball has `y ∈ [220, 580]`. | The camera overscan in §4.6 covers tees < 280; low surfaces only lose steep full-power pulls on phones. |
| CD-6 | `GameClient.ts` | `tryReconnect()` loops every 2 s until `dropAt + reconnectGraceMs`; `ClientStatus.reconnecting` gains `deadlineMs`. | UI shows "Reconnecting…" without a countdown. |
| CD-7 | `GameCanvas.tsx` `FrameSummary` | Add `sunk: [boolean, boolean]` and `turnDelayTicks: number`. | Derive from the `sink`/`gimme` and `turnStart` events in the UI. |

---

## 13. Verification done for this spec
- `hud-1280x720.png` (stageScale 1.00, normal): all six clusters, turn banner slot, toast slot, partner arc + "BLUE AIMING" tag, "YOU" tag, world stickers; top/bottom bands = 68 px; nothing overlaps; 15 px text = 15 CSS px.
- `hud-844x390.png` (390×844 phone landscape; stageScale 0.542, hud-scale 1.66, **compact**): level chip "HOLE 2/4 · PAR 9", team score 200 wide, chips "● YOU 3" / "● 2", pause only (mute folded), hint pill alone bottom-left (meter hidden for touch), net pill + camera bottom-right; 48-px buttons render at **43.2 CSS px**, 15-px text at 13.5 CSS px (the floor), bands 100 px, no overlap.
- `hud-1024x768.png` (iPad landscape; stageScale 0.80, hud-scale 1.13, compact): no overlap, bands 74 px.
- `lobby-1280x720.png`: host-ready card (code tile, three copy/share buttons, status, chips, start-hole toggles, "Start game — Blue is here!" + Cancel room) fits a 640-px card with room to spare.
- `lobby-844x390.png`: the same card in a 390-px-tall viewport scrolls; `autofocus` on Start scrolled the Start row into view, which is the intended keyboard/short-viewport behaviour.
All five renders report "no page errors" from the shot helper.
