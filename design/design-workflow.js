export const meta = {
  name: 'flash-golf-design',
  description: 'Competing design proposals (visual, levels, UX) with visual mockups + architecture/audio critiques, judged and synthesized',
  phases: [
    { title: 'Propose', detail: 'visual x3, levels x3, ux x2, architecture x1, audio x1' },
    { title: 'Judge', detail: '3 judges per competing group; 2 adversarial critics for architecture and audio' },
    { title: 'Synthesize', detail: 'one synthesizer per group merges winner + grafts' },
  ],
}

const PROJECT = 'C:\\Users\\KevnP\\Downloads\\flash_golf\\flash_gimme_golf'
const SCRATCH = 'C:\\Users\\KevnP\\AppData\\Local\\Temp\\claude\\C--Users-KevnP\\9008f5d3-9b42-45ce-82f6-49cf5037798e\\scratchpad'
const DESIGN = SCRATCH + '\\design'
const BRIEF = SCRATCH + '\\LEAD_BRIEF.md'
const SOLVER = SCRATCH + '\\tools\\solver.ts'
const SHOT = SCRATCH + '\\pw\\shot.mjs'
const FINDINGS = args && args.findingsPath ? args.findingsPath : DESIGN + '\\AUDIT_FINDINGS.json'
const BASELINE = args && args.baselineSolverJson ? args.baselineSolverJson : SCRATCH + '\\tools\\current-levels.json'
const BASE_PNGS = SCRATCH + '\\pw\\base-1-lobby.png, base-2-start.png, base-3-aiming.png, base-4-flight.png, base-5-after-shot.png (same folder)'

const PROPOSAL = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    summary: { type: 'string' },
    outputDir: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    pngs: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['key', 'summary', 'outputDir', 'files', 'pngs'],
}
const LEVEL_PROPOSAL = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    summary: { type: 'string' },
    outputDir: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    pngs: { type: 'array', items: { type: 'string' } },
    solverJson: { type: 'string' },
    table: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['key', 'summary', 'outputDir', 'files', 'pngs', 'solverJson', 'table'],
}
const JUDGMENT = {
  type: 'object',
  properties: {
    ranking: {
      type: 'array',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, score: { type: 'number' }, rationale: { type: 'string' } },
        required: ['key', 'score', 'rationale'],
      },
    },
    graftIdeas: {
      type: 'array',
      items: { type: 'object', properties: { fromKey: { type: 'string' }, idea: { type: 'string' } }, required: ['fromKey', 'idea'] },
    },
    concerns: { type: 'array', items: { type: 'string' } },
  },
  required: ['ranking', 'graftIdeas', 'concerns'],
}
const CRITIQUE = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['accept', 'revise'] },
    requiredChanges: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    praise: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'requiredChanges', 'risks'],
}
const SYNTH = {
  type: 'object',
  properties: { outputFiles: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } },
  required: ['outputFiles', 'summary'],
}

const common = `CONTEXT. Project: ${PROJECT} (TypeScript + Vite + Canvas 2D + React shell + Node ws server; read its CLAUDE.md, LEVEL_DESIGN.md and the whole src/ tree as needed). The owner asked for the game to be redesigned and rebuilt into a POLISHED version. Read the lead brief at ${BRIEF} FIRST — it contains locked decisions you must respect and the target file layout. Verified audit findings about the current build are in ${FINDINGS} (JSON). Baseline screenshots of the current build: ${BASE_PNGS} (use the Read tool to view PNGs). A co-op level solver exists at ${SOLVER} (usage in its header; run it with "npx tsx" from the project directory) and a screenshot helper at ${SHOT} ("node ${SHOT} <input.html|.svg|url> <out.png> [w] [h] [waitMs]" — run it from ${SCRATCH}\\pw where playwright-core is installed). Baseline solver results for the current levels: ${BASELINE}.

HARD RULES: never modify anything under ${PROJECT}. Write all outputs under your own output directory in ${DESIGN}. Be concrete and specific (numbers, coordinates, hex colours, exact copy, exact type names) — vague prose will be judged harshly. Your final text output is only the structured result.`

// ---------------------------------------------------------------- VISUAL
const VISUAL_LENSES = [
  {
    key: 'chunky',
    lens: 'Nitrome / jmtb02-era CHUNKY CARTOON: thick 4px dark outlines, flat fills with exactly one darker shade per material, rounded bouncy silhouettes, bright primaries (sky, grass, dirt), big friendly rounded display type, sticker-style labels on mechanics.',
  },
  {
    key: 'glossy',
    lens: 'Miniclip / Candystand 2007 GLOSSY VECTOR: saturated sky gradient, soft highlights and bevels, glossy balls, clean geometric terrain with crisp outlines, premium-but-playful HUD with pill badges; must still read instantly on a phone.',
  },
  {
    key: 'doodle',
    lens: 'Newgrounds SCRAPPY HAND-DRAWN: wobbly-but-deliberate outlines, notebook/doodle energy, expressive golfers with big heads and faces, hand-lettered signage on mechanics, humour in the signs ("BOING", "MUD"), while keeping every mechanic unmistakable.',
  },
]
const visualPrompt = (v) => `${common}

ROLE: Art director proposing the visual language for Flash Golf. Your lens: ${v.lens}

DELIVERABLES in ${DESIGN}\\visual-${v.key}\\ :
1. mockup.html — a SELF-CONTAINED page (inline CSS/JS, Canvas 2D at exactly 1280x720 logical pixels, may load one Google Font via <link> with a system fallback) that draws ONE static gameplay frame in your style: sky/background layers, hilly terrain with grass + dirt, a pressure switch with a bridge over a gap, a spring, a sand patch, a bumper, a fan column, a RED colour gate (only the red player passes — show how a player knows that), a cup with flag, two balls (red P1 #ff5d73, blue P2 #50b7ff) and two golfer characters (P2 mid-aim with the aim arc + power indicator; P1 idle). Overlay the HUD as DOM elements (the real HUD will be React): level name + par, team strokes vs par, player chips with the active turn highlighted, mute + pause buttons, and a controls hint line. Keep the playfield unobstructed. Then produce a second frame mockup-title.html for the TITLE screen (logo treatment, Solo / Local 2P / Online buttons, level select strip with medals).
2. Screenshot both with the shot helper to mockup.png and mockup-title.png (1280x720) and LOOK at them with Read; iterate at least twice until they genuinely look like a finished Flash-era game and every mechanic is identifiable at a glance.
3. SPEC.md — the full visual spec: palette tokens (hex), outline/shading rules, per-mechanic shape language and label/icon, golfer character construction (parts, proportions, cap/shirt in player colour, swing animation keyframes), ball look, cup/flag, background layers and parallax, HUD layout in 1280x720 coordinates, typography (font, sizes, weights), feedback/juice list mapped to SimEvents (particles, squash, shake amounts, callout text styles like "GIMME!"), results/medal visuals, and a short "what makes this read as Flash" paragraph. Include guidance for porting your mockup drawing code into src/view/render.

Return key='${v.key}', the output dir, file list, png paths, and a 3-sentence summary.`

// ---------------------------------------------------------------- LEVELS
const LEVEL_LENSES = [
  { key: 'puzzle', lens: 'PUZZLE-FIRST: every level after the first has a clear co-op "aha" (two switches so both can cross, colour gates that force route negotiation, a bridge that must be held while the partner rolls). Difficulty comes from insight, not precision.' },
  { key: 'flow', lens: 'FLOW-FIRST: satisfying arcs and readable landing zones; generous fairways; mechanics placed where a natural shot lands; low recovery cost; the co-op puzzles are present but forgiving. Optimise for the shot feeling good and a 10-minute session.' },
  { key: 'teach', lens: 'TEACH-FIRST: a strict curriculum. L1 = aim/power/cup (+gimme), L2 = springs/bumpers (one idea: pink things launch you), L3 = pressure switch + bridge (the co-op idea), L4 = colour gates (route by colour) with sand as a soft obstacle. Minimal clutter; exactly one new idea per level; wind 0 everywhere in World 1.' },
]
const levelPrompt = (l) => `${common}

ROLE: Level designer authoring World 1 ("Teach") = exactly 4 levels for Flash Golf. Your lens: ${l.lens}

Study the current levels (src/game/levels.ts), the terrain helpers (src/game/terrain.ts), the physics constants (src/game/physics.ts: shot speed = power*8.8 with power 10..100, gravity 620, max range at 45 degrees is about 1249 px, ball radius 12, cup radius 16, hazards block any ball whose safeColor differs from the hazard colour, bridges/gates toggle with switch state, a switch is pressed only by a RESTING ball), the baseline solver results (${BASELINE}) and the audit findings about level design. The locked rules in the brief apply: held switches, two balls that do not collide, levels solvable in co-op, co-op levels NOT solo-bypassable, no soft-locks, par per level, 1280x720 viewport (levels may be 1280-2200 wide, height <= 720 preferred so follow-camera does not need vertical scroll).

DELIVERABLES in ${DESIGN}\\levels-${l.key}\\ :
1. levels.ts — exports "levels: Level[]" (4 levels) built with the CURRENT project helpers imported via file:// URLs WITH the .ts extension (the scratchpad is an ESM package and Node rejects bare absolute Windows paths), exactly like: import { terrainPiece, holeAt, applyPropsOnSurface, applySwitchesOnSurface, bridgeSurfaceY } from 'file:///C:/Users/KevnP/Downloads/flash_golf/flash_gimme_golf/src/game/terrain.ts'; import type { Level } from 'file:///C:/Users/KevnP/Downloads/flash_golf/flash_gimme_golf/src/game/types.ts'; (working example: ${SCRATCH}\tools\current-levels.ts; ALSO write a package.json containing {"type":"module"} into your output dir so your levels.ts is loaded as ESM regardless of other files in the scratchpad). You may add extra metadata fields in a separate exported "meta" array (id, par, hint, aha, failureMode, mechanicsIntroduced, axis ratings per LEVEL_DESIGN.md) since the current Level type has no par.
2. Decide the shot speed you design for (see the brief: the default 8.8 makes every level a 2-stroke lob; recommended 6.5-7.0) and run the solver with it: npx tsx "${SOLVER}" "<your levels.ts>" --svg "<your dir>\svg" --json "<your dir>\solver.json" --depth 8 --beam 6 --shotSpeed <value> (from the project dir). Use the SAME --shotSpeed for every level and record it in LEVELS.md. Convert each svg to png with the shot helper. VIEW the pngs. Iterate your geometry until: every level is co-op solvable; levels whose point is co-op are NOT solvable solo by at least one player (solver "solo" result) and ideally by neither; both balls can finish (no soft-lock where the switch-holder can never cross); minimum strokes found is between 2 and 6 per ball; no mechanic is decorative. Record the final solver table.
3. LEVELS.md — per level: name, size, par, hint (one sentence shown on the intro card), the intended aha, the failure mode to watch in playtests, mechanicsIntroduced, LEVEL_DESIGN.md axis ratings, and a short walkthrough of the intended co-op solution (who goes first, who holds what). Also a paragraph on how the 4 levels form a curve.

Return key='${l.key}', output dir, files, png paths, solverJson path, the final solver table as text, and a 3-sentence summary.`

// ---------------------------------------------------------------- UX
const UX_LENSES = [
  { key: 'onboard', lens: 'FIRST-60-SECONDS & TOUCH-FIRST: a playtester opens the link on a phone or laptop with zero instructions. Onboarding, control discoverability (drag-to-aim, keys, gamepad), responsive layout at 1280x720 letterboxed, mobile Safari quirks (audio unlock, 100vh, touch-action), accessibility (aria-live turn announcements, focus, reduced motion).' },
  { key: 'coop', lens: 'CO-OP CLARITY & ONLINE: the game must TELL you it is co-op (team score vs par, no winner), turn pacing and banners, seeing your partner aim live, lobby/invite/join flow, host vs guest affordances, disconnect/reconnect/error states, results and celebration, level select and persistence, pause semantics online vs local.' },
]
const uxPrompt = (u) => `${common}

ROLE: UX designer specifying every screen and flow of Flash Golf. Your lens: ${u.lens}

DELIVERABLES in ${DESIGN}\\ux-${u.key}\\ :
1. UX.md — screen-by-screen spec: Title (with level select + best medals from localStorage), mode select, online lobby (create/join/invite URL, waiting, start), level intro card, in-game HUD (contents, positions in 1280x720, what changes per phase/turn, online-only elements), aim feedback (keyboard, pointer drag, gamepad — exact rules: dead zones, cancel gesture, power mapping, angle clamps), pause menu, level results (strokes vs par, medal rules, per-player, continue), campaign results, settings (mute, music, reduced motion), error/disconnect states, share link. For each: exact copy text, the state machine transitions, keyboard/pointer/gamepad bindings, and the ONE thing a confused playtester would most likely hit and how the design prevents it. Include an app-level state machine diagram in text and the React component list with props.
2. wireframes.html — a self-contained page showing static wireframes (DOM/CSS, 1280x720 boxes) of Title, HUD-over-playfield, Level results, Online lobby. Screenshot to wireframes.png with the shot helper (use a taller viewport if needed, e.g. 1280 x 2900) and view it.

Return key='${u.key}', output dir, files, png paths, and a 3-sentence summary.`

// ---------------------------------------------------------------- ARCHITECTURE
const archPrompt = `${common}

ROLE: Systems engineer defining the architecture contracts that parallel build agents will code against. Follow the target file layout and the locked decisions in the brief exactly. Study the current code in depth (physics.ts, engine.ts, input.ts, state.ts, render.ts, GameCanvas.tsx, net/*, server/*), the audit findings, and PR #14's letterboxing approach (gh pr diff 14 from the project dir).

DELIVERABLES in ${DESIGN}\\architecture\\ :
1. types.ts — the COMPLETE, compilable contents of src/sim/types.ts: Vec, Level types (terrain pieces with surfaces + baseY, gaps, rects for sand/spring/bumper/fan/colourGate/bridge/blocker with switchId + activeWhen, pressure switches, hole, starts, plus metadata: id, name, world, par, hint, mechanicsIntroduced, width/height, wind), SimConfig (playerCount 1|2, levelIds, seed, mode 'solo'|'local'|'online'), SimPhase, SimState (only rule-relevant data; exact fields), PlayerCommand union (setAim, shoot, restartLevel, continue, start… with playerId), SimEvent union (every event the view/audio needs with payloads), constants (TICK_RATE 60, BALL_RADIUS, MIN/MAX_POWER, SHOT_SPEED_PER_POWER 8.8, GRAVITY 620, TURN_DELAY, GIMME_RADIUS, VIEWPORT 1280x720), and the compact serialized form (SimSnapshot) used for ?state= links and the network. Add JSDoc on every type.
2. protocol.ts — complete src/net/protocol.ts: ClientMessage / ServerMessage unions (createRoom, joinRoom{code}, command{cmd}, aimPreview?, ping; roomCreated, joined, peerJoined/left, start, snapshot{tick, snap}, event batch?, error{code,message}), snapshot rate, validation rules, reconnect token idea if cheap.
3. ARCH.md — module-by-module API (exact exported function signatures) for sim.ts, physics.ts, terrain.ts, serialize.ts, levels/index.ts, view/view.ts, view/render/*, view/audio.ts, view/input/*, GameCanvas.tsx, ui/*, net/GameClient.ts, server/rooms.ts; the game loop (fixed-step accumulator, interpolation alpha for rendering, how events flow to view/audio, how online mode substitutes snapshots), determinism rules and the test plan (vitest files and what each asserts, including a replay test: same seed + same command log => identical final serialized state, and a level validity test), serialization format with a size estimate, server room lifecycle (create, join, start, tick at 60 Hz sim / 20-30 Hz broadcast, idle timeout, disconnect handling, cleanup), input device handling (keyboard integration rates, pointer drag math, gamepad polling), the tsconfig layout (app + server), and a FILE OWNERSHIP MAP: which build agent owns which files so they never collide, and the stub strategy (each contracted module starts as a stub so the project type-checks before parallel work begins).
4. physics-notes.md — which parts of the current physics to keep verbatim, which bugs from the audit to fix and how (tunneling, energy gain, aim preview mismatch: the preview must run the real stepBall on a scratch ball), and the gimme rule implementation.

Return key='architecture', output dir, files, [] for pngs, and a 3-sentence summary.`

// ---------------------------------------------------------------- AUDIO
const audioPrompt = `${common}

ROLE: Audio designer for Flash Golf using ONLY the Web Audio API (no asset files). Deliver in ${DESIGN}\\audio\\ :
1. AUDIO.md — the SFX catalogue mapped to SimEvents from the brief (ballHit by power, bounce by strength and surface, enterSand, spring, bumper, fan loop, hazardBlock, switchOn/Off, bridgeToggle, fellOffWorld, nearCup, gimme, sink, turnStart, levelComplete with medal tiers, campaignComplete, UI click/hover, invalid action) with a synthesis recipe for each (oscillator types, frequencies, envelopes ADSR in ms, filters, noise bursts, pitch randomisation ranges using a non-sim RNG, polyphony limits), a mixing plan (master/sfx/music gains, dB levels), the autoplay/unlock strategy (resume AudioContext on first pointer/key, iOS Safari), mute/music toggles persisted in localStorage, and a music recommendation: either a specific short gentle generative loop (key, tempo, chord progression, instrument recipes, how to keep it non-fatiguing) or a reasoned recommendation to ship SFX-only.
2. audio-demo.html — a self-contained page with buttons that play each SFX recipe (and the music loop if proposed) so a human can audition them; keep code structured so it ports directly into src/view/audio.ts (export an object of play functions).

Return key='audio', output dir, files, [] for pngs, and a 3-sentence summary.`

// ---------------------------------------------------------------- JUDGES / CRITICS / SYNTH
const JUDGE_LENSES = [
  { key: 'reviewer', lens: 'a Newgrounds reviewer in 2009 who has played 500 Flash golf games and has zero patience for unreadable mechanics or dull art' },
  { key: 'owner', lens: "the project's owner as defined by CLAUDE.md: identity fidelity (co-op, 10-minute sessions, scrappy late-Flash charm), scope discipline, and what one part-time developer can actually maintain" },
  { key: 'engineer', lens: 'a senior game developer judging implementability in Canvas 2D + React by parallel coding agents, internal consistency, performance on a phone, and risk of looking worse in motion than in a still' },
]
const judgePrompt = (group, lens, proposals) => `${common}

ROLE: Judge for the ${group.toUpperCase()} proposals. You are ${lens.lens}. Below are the proposals (read every listed file; VIEW every png with Read; for level proposals also read the solver json and check the solo-bypass and solvability results yourself). Score each 0-10 with a rationale, rank them, list concrete ideas from the runners-up that should be grafted onto the winner, and list concerns the synthesizer must address. Judge against the lead brief's locked decisions and CLAUDE.md.

PROPOSALS:
${JSON.stringify(proposals, null, 2)}`

const criticPrompt = (what, lens, proposal) => `${common}

ROLE: Adversarial critic of the ${what} proposal. Your lens: ${lens}. Read every file in the proposal. Try hard to break it: find contradictions with the brief's locked decisions, missing cases, things that will not type-check or will not be deterministic, things that will be painful for parallel build agents, and anything that would make the shipped game worse. Return verdict 'accept' only if you found nothing that must change; otherwise list REQUIRED changes (specific, actionable) and risks.

PROPOSAL:
${JSON.stringify(proposal, null, 2)}`

const synthPrompt = (group, proposals, judgments, outDir, extra) => `${common}

ROLE: Synthesizer for the ${group.toUpperCase()} track. Below are the proposals and the judges' verdicts. Produce the FINAL design for this track in ${outDir}: start from the top-ranked proposal, graft the ideas the judges flagged, resolve every concern, and keep it consistent with the brief. ${extra}

PROPOSALS:
${JSON.stringify(proposals, null, 2)}

JUDGMENTS:
${JSON.stringify(judgments, null, 2)}`

const reviseArchPrompt = (proposal, critiques, outDir) => `${common}

ROLE: Architecture author revising after adversarial critique. Apply every REQUIRED change from the critiques below to the proposal's files and write the final versions to ${outDir} (types.ts, protocol.ts, ARCH.md, physics-notes.md). Make sure types.ts and protocol.ts are complete, self-consistent, and would compile under strict TypeScript (you may test by copying them to a scratch dir and running npx tsc --noEmit --strict on them from the project dir). Also append a 'Decisions log' section to ARCH.md listing each critique item and how it was resolved.

PROPOSAL:
${JSON.stringify(proposal, null, 2)}

CRITIQUES:
${JSON.stringify(critiques, null, 2)}`

// ---------------------------------------------------------------- RUN
log('Launching proposal tracks in parallel')

async function competingTrack(group, lenses, promptFn, schema, synthExtra) {
  const proposals = (await parallel(
    lenses.map((l) => () => agent(promptFn(l), { label: `propose:${group}:${l.key}`, phase: 'Propose', schema, effort: 'high' })),
  )).filter(Boolean)
  log(`${group}: ${proposals.length}/${lenses.length} proposals ready`)
  if (!proposals.length) return { group, proposals: [], judgments: [], final: null }
  const judgments = (await parallel(
    JUDGE_LENSES.map((j) => () =>
      agent(judgePrompt(group, j, proposals), { label: `judge:${group}:${j.key}`, phase: 'Judge', schema: JUDGMENT, effort: 'high' })),
  )).filter(Boolean)
  log(`${group}: ${judgments.length} judgments in`)
  const final = await agent(synthPrompt(group, proposals, judgments, `${DESIGN}\\FINAL\\${group}`, synthExtra), {
    label: `synth:${group}`, phase: 'Synthesize', schema: SYNTH, effort: 'high',
  })
  return { group, proposals, judgments, final }
}

async function critiquedTrack(group, promptFn, critics, outDir, finalize) {
  const proposal = await agent(promptFn(), { label: `propose:${group}`, phase: 'Propose', schema: PROPOSAL, effort: 'high' })
  if (!proposal) return { group, proposal: null, critiques: [], final: null }
  const critiques = (await parallel(
    critics.map((c, i) => () => agent(criticPrompt(group, c, proposal), { label: `critic:${group}:${i}`, phase: 'Judge', schema: CRITIQUE, effort: 'high' })),
  )).filter(Boolean)
  log(`${group}: ${critiques.length} critiques, verdicts: ${critiques.map((c) => c.verdict).join(',')}`)
  const final = await finalize(proposal, critiques, outDir)
  return { group, proposal, critiques, final }
}

const [visual, levels, ux, architecture, audio] = await parallel([
  () => competingTrack('visual', VISUAL_LENSES, visualPrompt, PROPOSAL,
    `Write VISUAL.md (the complete final visual spec) and copy the chosen/merged mockup to mockup.html + mockup-title.html in the output dir; re-screenshot them to mockup.png and mockup-title.png with the shot helper and VIEW them; if you merged ideas into the mockup, make the mockup actually show them. Name explicitly which proposal won and what was grafted.`),
  () => competingTrack('levels', LEVEL_LENSES, levelPrompt, LEVEL_PROPOSAL,
    `Write the final levels.ts (4 levels, same import conventions) + LEVELS.md, RE-RUN the solver on the final set with the chosen shot speed (npx tsx "${SOLVER}" <levels.ts> --svg <dir>\svg --json <dir>\solver.json --depth 8 --beam 6 --shotSpeed <value>) and state that value in LEVELS.md and convert the svgs to png; the final set must pass: all co-op solvable, co-op levels not solo-bypassable, no soft-locks, par per level documented with the solver's min strokes. Name which proposal won and which individual levels were swapped in from others.`),
  () => competingTrack('ux', UX_LENSES, uxPrompt, PROPOSAL,
    `Write UX.md as the single complete flow + screen spec (merge both lenses: onboarding/touch AND co-op/online), with the app state machine, React component list with props, exact copy, and bindings for keyboard/pointer/gamepad.`),
  () => critiquedTrack('architecture', () => archPrompt, [
      'determinism and replay correctness (fixed step, seeded RNG, no view data in SimState, command ordering, floating point across engines, serialization round-trip)',
      'parallel-build friendliness and completeness (every module another agent must implement has an exact signature; stubs compile; file ownership has no overlaps; nothing in the brief is left unspecified)',
    ], `${DESIGN}\\FINAL\\architecture`, (p, c, out) => agent(reviseArchPrompt(p, c, out), { label: 'synth:architecture', phase: 'Synthesize', schema: SYNTH, effort: 'high' })),
  () => critiquedTrack('audio', () => audioPrompt, [
      'a sound designer who hates fatiguing synth loops and inconsistent mixes; check every recipe is implementable with plain Web Audio nodes and that autoplay policies are handled',
    ], `${DESIGN}\\FINAL\\audio`, (p, c, out) => agent(`${common}\n\nROLE: Audio author revising after critique. Apply all REQUIRED changes and write the final AUDIO.md and audio-demo.html to ${out}.\n\nPROPOSAL:\n${JSON.stringify(p, null, 2)}\n\nCRITIQUES:\n${JSON.stringify(c, null, 2)}`, { label: 'synth:audio', phase: 'Synthesize', schema: SYNTH, effort: 'high' })),
])

return {
  visual: visual && { winnerSummary: visual.final && visual.final.summary, files: visual.final && visual.final.outputFiles, judgments: visual.judgments },
  levels: levels && { winnerSummary: levels.final && levels.final.summary, files: levels.final && levels.final.outputFiles, judgments: levels.judgments },
  ux: ux && { winnerSummary: ux.final && ux.final.summary, files: ux.final && ux.final.outputFiles, judgments: ux.judgments },
  architecture: architecture && { summary: architecture.final && architecture.final.summary, files: architecture.final && architecture.final.outputFiles, critiques: architecture.critiques },
  audio: audio && { summary: audio.final && audio.final.summary, files: audio.final && audio.final.outputFiles, critiques: audio.critiques },
}
