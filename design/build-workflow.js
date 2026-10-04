export const meta = {
  name: 'flash-golf-build',
  description: 'Parallel contract-first implementation of the Flash Golf rebuild, integration, and an adversarial review/fix loop',
  phases: [
    { title: 'Scaffold', detail: 'contracts into the repo, stubs for every contracted module, tsconfigs, deps, green skeleton' },
    { title: 'Implement', detail: 'one agent per file-ownership group, disjoint files, contracts fixed' },
    { title: 'Integrate', detail: 'wire modules, typecheck, test, build, headless smoke' },
    { title: 'Review', detail: 'parallel reviewers (sim, physics/levels, net, visual, ux, audio, tooling) -> verify -> fix, until dry' },
  ],
}

// args: { owners: [{key, files:[...], prompt}], docs: {brief, arch, visual, levels, ux, audio, findings}, project, scratch, devPort, maxRounds }
const A = args || {}
const PROJECT = A.project
const SCRATCH = A.scratch
const DOCS = A.docs
const OWNERS = A.owners
const DEV_PORT = A.devPort || 5199
const MAX_ROUNDS = A.maxRounds || 3
if (!PROJECT || !SCRATCH || !DOCS || !OWNERS) throw new Error('build workflow needs args.project, args.scratch, args.docs, args.owners')

const IMPL_RESULT = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    typecheckClean: { type: 'boolean' },
    testsRun: { type: 'string' },
    knownGaps: { type: 'array', items: { type: 'string' } },
    contractDeviations: { type: 'array', items: { type: 'string' } },
  },
  required: ['key', 'files', 'summary', 'typecheckClean', 'knownGaps', 'contractDeviations'],
}
const INTEGRATION = {
  type: 'object',
  properties: {
    typecheckClean: { type: 'boolean' },
    testsPassing: { type: 'boolean' },
    buildClean: { type: 'boolean' },
    smokePassed: { type: 'boolean' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
  },
  required: ['typecheckClean', 'testsPassing', 'buildClean', 'smokePassed', 'changedFiles', 'summary', 'blockers'],
}
const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          description: { type: 'string' },
          evidence: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
        required: ['title', 'file', 'severity', 'description', 'evidence'],
      },
    },
  },
  required: ['findings'],
}
const VERDICT = {
  type: 'object',
  properties: { real: { type: 'boolean' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] }, note: { type: 'string' } },
  required: ['real', 'severity', 'note'],
}
const FIX_RESULT = {
  type: 'object',
  properties: {
    fixed: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'string' } },
    changedFiles: { type: 'array', items: { type: 'string' } },
    typecheckClean: { type: 'boolean' },
    testsPassing: { type: 'boolean' },
    summary: { type: 'string' },
  },
  required: ['fixed', 'skipped', 'changedFiles', 'typecheckClean', 'testsPassing', 'summary'],
}

const common = `CONTEXT. You are building the polished rebuild of Flash Golf in ${PROJECT} (TypeScript + Vite + Canvas 2D + React shell + Node ws server), on git branch redesign/polished-v1. Read these documents first, in this order: the lead brief ${DOCS.brief} (locked decisions), the architecture contract ${DOCS.arch} (module APIs, file ownership, loop, test plan) together with the contract files already in the repo (src/sim/types.ts and src/net/protocol.ts are FIXED — do not change their exported shapes; if you truly must extend one, add only optional/additive members and report it as a contractDeviation), the visual spec ${DOCS.visual}, the level design ${DOCS.levels}, the UX spec ${DOCS.ux}, the audio spec ${DOCS.audio}, and the verified audit of the old code ${DOCS.findings} (the rebuild must not reproduce those defects). The project's CLAUDE.md constraints apply (deterministic sim, no Math.random/Date in sim code, no scope beyond the brief).

Tools: run commands from ${PROJECT}. "npm run typecheck" (app + server tsconfigs), "npm test" (vitest), "npm run build". Headless browser helpers live in ${SCRATCH}\\pw: "node ${SCRATCH}\\pw\\play.mjs <url> <steps.json> <outDir>" drives the game from a JSON step list and writes screenshots + report.json (see the header of play.mjs for the step syntax); start the dev server yourself with "npx vite --port <port> --strictPort" in the background and stop it by PID (never taskkill node.exe). View PNGs with the Read tool. A level solver for the OLD physics is at ${SCRATCH}\\tools\\solver.ts; the new sim must ship its own level-validity test instead.

Quality bar: this is the shipped game, not a prototype. Chunky, readable, juicy, and deterministic. Write real code with no TODO stubs left in your files, no console.log noise, no dead code, no any-typed escape hatches unless unavoidable. Match the visual spec's palette and construction exactly. Keep functions small and files focused.`

const ownerPrompt = (o) => `${common}

YOUR OWNERSHIP GROUP: ${o.key}. You may create/modify ONLY these files (other groups are being written in parallel right now; touching their files causes conflicts): ${o.files.join(', ')}. If you need something from another group that the contracts do not provide, code against the contract and list it under contractDeviations/knownGaps rather than editing their files.

TASK: ${o.prompt}${SCAFFOLD_NOTES}

Before finishing: run "npm run typecheck" and make sure every error is outside your files or fixed (report typecheckClean=true only if the whole project typechecks, otherwise list which files still error). Run the tests relevant to you. Return the structured result.`

// -------------------------------------------------------------- Scaffold
phase('Scaffold')
const SCAFFOLD = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    typecheckClean: { type: 'boolean' },
    testsPassing: { type: 'boolean' },
    buildClean: { type: 'boolean' },
    summary: { type: 'string' },
    notesForImplementers: { type: 'array', items: { type: 'string' } },
  },
  required: ['files', 'typecheckClean', 'testsPassing', 'buildClean', 'summary', 'notesForImplementers'],
}
const scaffold = await agent(`${common}

ROLE: Scaffolder. Nobody else is editing the repo right now. Turn the repository into the contract-first skeleton that ${OWNERS.length} parallel implementers will fill in. Steps:
1. Lay down the target file layout from the brief/ARCH.md. Delete the old src/game, src/net, src/App.tsx, src/Lobby.tsx, src/styles.css implementations (git keeps history) except where ARCH.md says to keep code verbatim (e.g. parts of physics/terrain) — move those into their new locations.
2. Copy the final contract files into the repo: src/sim/types.ts and src/net/protocol.ts from the architecture folder (${DOCS.arch} lives next to them). Make them compile.
3. Create a STUB for every other contracted module with the exact exported signatures from ARCH.md (bodies throw new Error('not implemented: <name>') or return minimal placeholders), so the whole project typechecks. Each stub file starts with a comment "// OWNER: <group key>" from this ownership map: ${JSON.stringify(OWNERS.map((o) => ({ key: o.key, files: o.files })))}. React components may render a placeholder div.
4. Tooling: package.json scripts (dev with localhost default plus dev:lan, server, dev:all, build, typecheck = tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit, test, preview), tsconfig.json (app) + tsconfig.server.json (server + src/sim + src/net with Node types), vitest config, pinned dependency bumps (ws 8.22.0, vite 7.3.6, vitest 4.1.11, concurrently 9.2.4; keep typescript 5.9.x; add @types/node if needed) and run npm install so package-lock is updated; .nvmrc / engines (Node 22); .github/workflows/ci.yml running typecheck + test + build + npm audit --omit=dev --audit-level=high; fly-deploy gated on CI success with a pinned action and a paths filter; .github/dependabot.yml; Dockerfile on node:22-alpine running as a non-root user; keep fly.toml/vercel.json compatible.
5. index.html: title, meta description, theme-color, Open Graph tags (og:image can point to /og.png with a placeholder file), favicon (an SVG is fine), Google Font link if the visual spec uses one.
6. A placeholder determinism test that imports the sim contracts so "npm test" has at least one passing test; keep/port the old RNG test.
7. Verify: "npm run typecheck", "npm test", "npm run build" all pass on the skeleton. Commit nothing (the lead commits).
Return the structured result including notes implementers must know (e.g. any signature you had to adjust while making contracts compile — list them precisely).`, { label: 'scaffold', phase: 'Scaffold', schema: SCAFFOLD, effort: 'high' })
log(`Scaffold: typecheck=${scaffold && scaffold.typecheckClean} tests=${scaffold && scaffold.testsPassing} build=${scaffold && scaffold.buildClean}`)
const SCAFFOLD_NOTES = scaffold && scaffold.notesForImplementers && scaffold.notesForImplementers.length
  ? `

SCAFFOLD NOTES (signatures as they exist in the repo now): ${scaffold.notesForImplementers.join(' | ')}` : ''

// -------------------------------------------------------------- Implement
phase('Implement')
log(`Implementing ${OWNERS.length} ownership groups in parallel`)
const impl = (await parallel(OWNERS.map((o) => () =>
  agent(ownerPrompt(o), { label: `impl:${o.key}`, phase: 'Implement', schema: IMPL_RESULT, effort: 'high' })))).filter(Boolean)
log(`Implementation done: ${impl.map((r) => `${r.key}:${r.typecheckClean ? 'ok' : 'tsc-errors'}`).join(' ')}`)

// -------------------------------------------------------------- Integrate
phase('Integrate')
const integration = await agent(`${common}

ROLE: Integrator. All ownership groups have finished (their reports are below, including known gaps and contract deviations). You may edit ANY file. Make the whole thing work end to end:
1. "npm run typecheck", "npm test", "npm run build" must all pass. Fix cross-module mismatches at the seams (prefer fixing the caller over changing contracts).
2. Resolve every knownGap/contractDeviation listed below or document why it is fine.
3. Headless smoke with the real app: start vite on port ${DEV_PORT}, then use play.mjs to: load the title, start Solo, take a screenshot of the level intro and the playfield, take a shot via keyboard (hold ArrowUp/W to set power, press Space), wait for it to settle, screenshot, open pause with Escape and screenshot, resume, then also test a pointer drag-to-aim shot (drag from the ball backwards) and screenshot. Then start a Local 2P game and verify the turn alternates. Check report.json for pageErrors/consoleErrors and fix the causes. View every screenshot with Read and fix anything that looks broken (missing art, overlapping HUD, invisible labels, wrong colours).
4. Online: start the server ("npm run server" in the background on its port) and the client, open two pages with play.mjs (two separate runs are fine: one creates a room and screenshots the code; read the code from the screenshot or via an eval of the DOM; the second joins with it) and verify both reach the playfield; fix protocol mismatches. Stop all processes you started by PID.
5. Run the sim-level test suite and the level validity test; every level must be solvable per the test.
Return the structured result with the exact list of files you changed.

IMPLEMENTATION REPORTS:
${JSON.stringify(impl, null, 2)}`, { label: 'integrate', phase: 'Integrate', schema: INTEGRATION, effort: 'high' })
log(`Integration: typecheck=${integration && integration.typecheckClean} tests=${integration && integration.testsPassing} build=${integration && integration.buildClean} smoke=${integration && integration.smokePassed}`)

// -------------------------------------------------------------- Review loop
const REVIEW_DIMS = [
  { key: 'sim', prompt: 'SIM CORRECTNESS & DETERMINISM: read src/sim/** fully. Check: no Math.random/Date/DOM in sim; every ball simulated every tick; switch evaluation every tick; turn advancement only when all balls rest; command validation (turn ownership, aim ranges); gimme rule; fall-off-world penalty + respawn at last rest; sink detection; par/medal computation; serialization round-trip and size; replay determinism (write a scratch test: same seed + same command log twice => identical serialized state, run it with vitest). Find real defects.' },
  { key: 'physics', prompt: 'PHYSICS FEEL & LEVEL VALIDITY: read src/sim/physics.ts, terrain.ts, levels/**. Write scratch scripts (npx tsx, from the project dir, importing the NEW sim) that: shoot a grid of angle/power from each tee on each level and report landing distributions, tunneling (ball ever inside terrain), energy growth (max speed over time after spring/bumper), rest-on-slope behaviour, bridge flush with lips, rolling across a pressed bridge at low power, colour gate behaviour, gimme radius; and a 2-ball beam search like the old solver to confirm each level is co-op solvable, co-op levels are not solo-bypassable, and min strokes are within 1 of the documented par. Report deviations as findings with numbers.' },
  { key: 'net', prompt: 'NETCODE & SERVER: read server/** and src/net/** fully. Check message validation (every field, sizes), one room per socket, idle TTL/heartbeat, accumulator tick, snapshot rate and size (measure by running the server and logging bytes), reconnect/disconnect handling, host/guest permissions, protocol version check, origin allow-list configuration, error surfacing on the client, no crash paths (fuzz the server with malformed JSON/oversized messages in a scratch script using ws). Report defects.' },
  { key: 'visual', prompt: 'VISUAL FIDELITY: start vite and use play.mjs to screenshot the title, level intro, playfield on every level (use the level select), mid-flight, a pressed switch with its bridge, a colour gate, pause, level results and campaign results at 1280x720 and at a phone-ish 844x390 viewport. View every PNG with Read and compare to the visual spec and its mockup PNG. Report every mismatch, unreadable element, overlap, missing juice state, or anything that does not look like a finished Flash-era game (with the screenshot path as evidence).' },
  { key: 'ux', prompt: 'UX FLOW: use play.mjs to walk every flow in the UX spec: title -> solo -> intro -> play -> results -> next -> campaign results -> play again; local 2P turn alternation; pause -> restart with confirm -> quit; level select; mute persistence (reload); drag-to-aim with cancel gesture; keyboard-only play; touch emulation ({"touch":true}); onboarding hint on level 1; online create/join/invite URL handling including the error states (bad code, server down). Report any step where a confused playtester would get stuck, any copy mismatch with the UX spec, any focus/keyboard trap, and any console/page error.' },
  { key: 'audio', prompt: 'AUDIO: read src/view/audio.ts and the audio spec. Check every SimEvent in the spec has a sound, recipes match (oscillator/envelope/filters), polyphony limits, master/sfx/music gains, AudioContext unlock on first gesture (and on iOS visibilitychange), mute/music persistence, no audio started before a user gesture, no exceptions when AudioContext is unavailable (run the audio module in vitest with a stubbed AudioContext). Report defects.' },
  { key: 'tooling', prompt: 'TOOLING & DOCS: check package.json scripts (typecheck covers server, test, build, lint if present), tsconfig layout, CI workflow runs typecheck+test+build and gates the Fly deploy with pinned action + paths filter, dependabot config, Dockerfile (Node 22, no dev transpiler issues, non-root), fly.toml compatibility (port 8080, /ws), vercel.json, index.html meta/favicon/OG, README accuracy (controls, modes, live URLs, deploy steps), CLAUDE.md status note updated (plan untouched), ARCHITECTURE.md matches the code. Run npm audit --omit=dev. Report concrete defects.' },
]

let round = 0
let lastConfirmed = []
while (round < MAX_ROUNDS) {
  round += 1
  phase('Review')
  log(`Review round ${round}`)
  const found = (await parallel(REVIEW_DIMS.map((d) => () =>
    agent(`${common}\n\nROLE: Reviewer, round ${round}. ${d.prompt}\n\nDo not modify files under src/ or server/ (scratch scripts under ${SCRATCH} and scratch tests you delete afterwards are fine). Be exhaustive and concrete; cite file:line and include evidence (numbers, screenshot paths). Report only real problems for the shipped game, ranked by severity.`,
      { label: `review:${d.key}:r${round}`, phase: 'Review', schema: FINDINGS, effort: 'high' })))).filter(Boolean)
    .flatMap((r, i) => r.findings.map((f) => ({ ...f, dim: REVIEW_DIMS[i].key })))
  log(`Round ${round}: ${found.length} raw findings`)
  if (!found.length) break
  const verified = (await parallel(found.map((f, i) => () =>
    agent(`${common}\n\nROLE: Skeptic. A reviewer claims the following about the CURRENT code. Open the cited code (and run the app or a scratch script if needed) and try to refute it. real=true only if the defect exists now and matters for the shipped game. Re-rate severity.\n\nCLAIM:\n${JSON.stringify(f, null, 2)}`,
      { label: `verify:${f.dim}:r${round}:${i}`, phase: 'Review', schema: VERDICT, effort: 'high' }).then((v) => ({ ...f, verdict: v }))))).filter(Boolean)
  const confirmed = verified.filter((f) => f.verdict && f.verdict.real).map((f) => ({ ...f, severity: f.verdict.severity }))
  lastConfirmed = confirmed
  const actionable = confirmed.filter((f) => f.severity !== 'low' || round === 1)
  log(`Round ${round}: ${confirmed.length} confirmed (${actionable.length} actionable)`)
  if (!actionable.length) break
  // group by top-level area so fixers do not collide
  const area = (f) => {
    const p = (f.file || '').replace(/\\/g, '/')
    if (p.startsWith('server/') || p.startsWith('src/net/')) return 'net'
    if (p.startsWith('src/sim/levels')) return 'levels'
    if (p.startsWith('src/sim/')) return 'sim'
    if (p.startsWith('src/view/render') || p.startsWith('src/view/view')) return 'render'
    if (p.startsWith('src/view/audio')) return 'audio'
    if (p.startsWith('src/view/input') || p.startsWith('src/view/GameCanvas')) return 'input'
    if (p.startsWith('src/ui') || p.startsWith('src/App') || p.startsWith('src/styles') || p.startsWith('src/main') || p.startsWith('index.html')) return 'ui'
    return 'tooling'
  }
  const groups = {}
  for (const f of actionable) (groups[area(f)] = groups[area(f)] || []).push(f)
  const fixes = (await parallel(Object.entries(groups).map(([k, fs]) => () =>
    agent(`${common}\n\nROLE: Fixer for area "${k}" (round ${round}). Fix every confirmed finding below in the files of your area (you may touch other files only if a fix is impossible otherwise, and then minimally). Keep contracts stable. After fixing run "npm run typecheck" and "npm test"; if the finding is visual/UX, re-run the relevant play.mjs steps and view the screenshot to confirm. Return exactly which findings you fixed and which you skipped and why.\n\nFINDINGS:\n${JSON.stringify(fs, null, 2)}`,
      { label: `fix:${k}:r${round}`, phase: 'Review', schema: FIX_RESULT, effort: 'high' })))).filter(Boolean)
  log(`Round ${round}: fixed ${fixes.reduce((n, r) => n + r.fixed.length, 0)}, skipped ${fixes.reduce((n, r) => n + r.skipped.length, 0)}`)
  // re-integrate quickly after fixes
  const reint = await agent(`${common}\n\nROLE: Post-fix integrator (round ${round}). Fixers just changed files in parallel (reports below). Run "npm run typecheck", "npm test", "npm run build"; fix any breakage at the seams; run a short play.mjs smoke (title -> solo -> one keyboard shot -> screenshot) and view the screenshot. Return the structured result.\n\nFIX REPORTS:\n${JSON.stringify(fixes, null, 2)}`,
    { label: `reintegrate:r${round}`, phase: 'Review', schema: INTEGRATION, effort: 'high' })
  log(`Round ${round} re-integration: typecheck=${reint && reint.typecheckClean} tests=${reint && reint.testsPassing} build=${reint && reint.buildClean} smoke=${reint && reint.smokePassed}`)
}

return {
  scaffold: scaffold && { typecheckClean: scaffold.typecheckClean, summary: scaffold.summary },
  implementation: impl.map((r) => ({ key: r.key, typecheckClean: r.typecheckClean, knownGaps: r.knownGaps, contractDeviations: r.contractDeviations })),
  integration,
  rounds: round,
  remainingFindings: lastConfirmed.map((f) => ({ title: f.title, file: f.file, severity: f.severity })),
}
