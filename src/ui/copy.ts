// OWNER: ui
/**
 * Every UI string (UX.md §9 copy sheet, VISUAL.md §16 button labels, BUILD_DECISIONS D2/D3 chip and
 * team-delta words, D10.10 waiting cues). Nothing competitive anywhere: `__tests__/copy.test.ts` greps
 * this file and every `.tsx` under src/ui for the banned words. World callouts (GIMME!, IN THE HOLE!,
 * SNAP!, BOOM! ...) are canvas text owned by VIEW and do not live here; world titles come from the
 * level registry (`worldTitle`), like level names.
 */
import type { ErrorCode } from '../net/protocol';
import type { WaitReason } from '../sim/devices';
import type { Level, MechanicKind, Medal, PlayerId, SimMode, SimPhase, WorldId } from '../sim/types';
import { PLAYER_NAMES } from '../sim/types';
import type { InputDevice } from '../view/view';

export const nameOf = (p: PlayerId): string => PLAYER_NAMES[p];
export const upperNameOf = (p: PlayerId): string => PLAYER_NAMES[p].toUpperCase();
export const otherPlayer = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
/** "plate A" for a one-letter label, the switchLabel fallback as is, otherwise "the DOOR plate". */
const platePhrase = (label: string): string => (label.length === 1 ? `plate ${label}` : label.startsWith('SWITCH ') ? label : `the ${label} plate`);
/** The skip line's word for why a ball waits (D10.10): "Red is caught" / "Red is loaded". */
const WAIT_WORDS: Readonly<Record<WaitReason, string>> = Object.freeze({ caught: 'caught', loaded: 'loaded' });

export const COPY = Object.freeze({
  app: Object.freeze({
    name: 'Flash Golf',
    version: (v: string) => `v${v}`,
    footer: 'keyboard, mouse, touch or gamepad',
  }),
  title: Object.freeze({
    flash: 'FLASH',
    golf: ['G', 'LF'] as const,
    tagline: 'CO-OP PUZZLE GOLF · TWO BALLS, ONE TEAM',
    solo: 'SOLO',
    soloSub: 'YOU PLAY BOTH BALLS',
    local: 'LOCAL 2P',
    localSub: 'TAKE TURNS ON THIS SCREEN',
    online: 'ONLINE',
    onlineSub: 'ROOM CODE OR INVITE LINK',
    onlineUnavailable: "Online isn't configured on this build.",
    /** The tray's world picker (D10.2): the shown world's button reads its registry title, the others this. */
    worldPick: 'World',
    worldTab: (world: WorldId) => `WORLD ${world}`,
    medalLegend: 'GOLD: UNDER PAR · SILVER: PAR · BRONZE: PAR +2 OR BETTER',
    medalTooltip: 'Gold: under par · Silver: par · Bronze: par +2 or better',
    par: (par: number) => `PAR ${par}`,
    team: (n: number) => `TEAM ${n}`,
    notPlayed: 'NOT PLAYED',
    startHere: 'START HERE',
    teach: (mechanic: string) => `NEW: ${mechanic}`,
    serverOk: 'ONLINE SERVER: OK',
    serverWaking: 'ONLINE SERVER: WAKING…',
    serverOffline: 'ONLINE SERVER: OFFLINE',
    settings: 'Settings',
    a11y: 'Flash Golf. Solo, 2 players, or online with a friend.',
    levelSelect: 'Start hole',
  }),
  shared: Object.freeze({
    title: (hole: number, strokes: number, toPlay: PlayerId) =>
      `SHARED GAME · Hole ${hole} · Team ${strokes} strokes · ${nameOf(toPlay)} to play`,
    continueSolo: 'Continue solo',
    continue2p: 'Continue 2 players',
    broken: 'This link is broken or from an older version.',
    dismiss: 'Dismiss',
  }),
  lobby: Object.freeze({
    backToTitle: 'Title',
    title: 'PLAY ONLINE',
    sub: 'Two browsers, one team. Share a 5-letter code or a link.',
    create: 'Create a room',
    or: "or join a friend's room",
    codePlaceholder: 'ROOM CODE',
    codeLabel: 'Room code',
    join: 'Join',
    note: 'No account needed. Rooms close when empty.',
    connecting: 'Connecting…',
    waking: 'Waking up the server — this can take a few seconds.',
    joining: (code: string) => `Joining room ${code}…`,
    cancel: 'Cancel',
    yourRoom: 'YOUR ROOM',
    roomCode: 'ROOM CODE',
    copyCode: 'Copy code',
    copyLink: 'Copy invite link',
    share: 'Share…',
    copied: 'Copied!',
    longPress: 'Long-press to copy',
    shareText: (code: string) => `Play a round of co-op golf with me — room ${code}`,
    waitingPartner: 'Waiting for your partner to open the link…',
    /** START AT is a world pick, then a hole of that world (D10.2): the chosen world reads its registry title, the others this. */
    world: 'World',
    worldTab: (world: WorldId) => `World ${world}`,
    startAt: 'START AT',
    hole: (n: number) => `Hole ${n}`,
    /** Guest card: the registry's world title and the global hole number, e.g. "World 2 — Lift & Lock · starting at Hole 5". */
    startingAt: (worldTitle: string, n: number) => `${worldTitle} · starting at Hole ${n}`,
    start: 'Start game',
    startNeeds2: 'Needs 2 players',
    startReady: (p: PlayerId) => `Start game — ${nameOf(p)} is here!`,
    cancelRoom: 'Cancel room',
    joinedTitle: (code: string) => `JOINED ROOM ${code}`,
    chipHost: 'HOST',
    chipYou: 'YOU',
    chipPartner: 'PARTNER',
    youChip: (p: PlayerId, host: boolean) => `${upperNameOf(p)} · YOU${host ? ' (HOST)' : ''}`,
    partnerJoined: (p: PlayerId) => `${nameOf(p)} joined! Press Start when you're both ready.`,
    partnerLeft: (p: PlayerId) => `${nameOf(p)} left. Waiting for a partner…`,
    waitingHost: (p: PlayerId) => `Waiting for ${nameOf(p)} to start the game…`,
    preteach: (p: PlayerId) => `While you wait: you play the ${nameOf(p).toLowerCase()} ball. On your turn, pull back anywhere to shoot it.`,
    leave: 'Leave room',
    back: 'Back',
    retry: 'Retry',
    tryAgain: 'Try again',
    editCode: 'Edit the code',
    createOwn: 'Create my own room',
    playSolo: 'Play solo instead',
    reload: 'Reload',
    backToTitleBtn: 'Back to title',
    leaveConfirm: 'Leave the room?',
    leaveConfirmBody: (p: PlayerId) => `${nameOf(p)} will be left waiting.`,
    stay: 'Stay',
    errJoin: "COULDN'T JOIN",
    errConnect: "COULDN'T CONNECT",
    errClosed: 'THE ROOM CLOSED',
    docTitle: (code: string) => `Flash Golf · room ${code}`,
  }),
  intro: Object.freeze({
    hole: (n: number, count: number) => `HOLE ${n} OF ${count}`,
    par: (par: number) => `PAR ${par}`,
    teach: (mechanic: string) => `NEW: ${mechanic}`,
    firstSolo: (p: PlayerId) => `You shoot both balls, alternating. ${nameOf(p)} first.`,
    firstLocal: (p: PlayerId) => `${nameOf(p)} goes first (Player ${p + 1})`,
    firstYou: 'You go first',
    firstPartner: (p: PlayerId) => `${nameOf(p)} goes first — that's your partner`,
    teeOff: 'Tee off',
    orTap: 'or tap anywhere',
    orSpace: 'or press Space',
    orA: 'or press Ⓐ',
  }),
  hud: Object.freeze({
    hole: (n: number, count: number) => `HOLE ${n}/${count}`,
    par: (par: number) => `PAR ${par}`,
    team: 'TEAM',
    teamPar: (par: number) => `/ PAR ${par}`,
    you: 'YOU',
    partner: 'PARTNER',
    p1: 'P1',
    p2: 'P2',
    power: 'POWER',
    angle: (deg: number) => `${deg}°`,
    mute: 'Mute (M)',
    unmute: 'Unmute (M)',
    tapForSound: 'Tap for sound',
    menu: 'Menu (Esc)',
    overview: 'Overview (C)',
    follow: 'Follow ball (C)',
    hints: 'Hints (H)',
    net: (ms: number) => `${ms} ms`,
    offline: 'offline',
    reconnecting: (s: number) => `RECONNECTING ${s} s`,
    away: 'AWAY',
    status: Object.freeze({
      aiming: 'AIMING',
      waiting: 'WAITING',
      inCup: 'IN THE CUP',
      holds: (label: string) => `HOLDS ${label}`,
      /** Sunk ball that keeps a cup-wired switch pressed (D2); short enough for the 160 px chip. */
      holdsFromCup: (label: string) => `CUP HOLDS ${label}`,
      /** D10.10: a ball resting in an armed trap, naming every release plate ('FREE or FAR'). */
      caught: (labels: string) => `CAUGHT · needs ${labels}`,
      /** D10.10: a ball resting on a cold cannon's breech, naming every FIRE plate ('A, B or DECK'). */
      loaded: (labels: string) => `LOADED · needs ${labels}`,
    }),
  }),
  hint: Object.freeze({
    /** D10.9: a press anywhere on the playfield starts the drag; letting go back where it started cancels. */
    aim: Object.freeze<Record<InputDevice, string>>({
      touch: 'Pull back anywhere, let go to shoot',
      pointer: 'Drag back anywhere, release to shoot · drag back to the start to cancel',
      keyboard: '← → aim · ↑ ↓ power · Space shoot',
      gamepad: 'LS aim · RT power · Ⓐ shoot',
    }),
    partnerAiming: (p: PlayerId) => `${nameOf(p)} is lining up a shot…`,
    flying: (p: PlayerId) => `${nameOf(p)}'s shot…`,
    handoff: (p: PlayerId) => `${nameOf(p)} walks up…`,
    /** UX.md §5.2 miss feedback, as D10.9 left it: only a press ON the partner's ball is refused. */
    wrongBall: (active: PlayerId) => `That's the ${nameOf(active === 0 ? 1 : 0).toLowerCase()} ball — ${nameOf(active).toLowerCase()} is up · drag from anywhere else`,
    notYourTurn: (active: PlayerId, mine: PlayerId) => `${nameOf(active)}'s turn — your ball is the ${nameOf(mine).toLowerCase()} one`,
  }),
  banner: Object.freeze({
    yourTurn: 'YOUR TURN',
    turn: (p: PlayerId) => `${upperNameOf(p)}'S TURN`,
    turnLocal: (p: PlayerId) => `${upperNameOf(p)}'S TURN · P${p + 1}`,
    partnerSub: 'your partner',
    /** D10.10 sub-line of a turn the WAITING rule handed over: "Red is caught — Blue shoots again". */
    skipped: (waiting: PlayerId, reason: WaitReason, shooter: PlayerId) => `${nameOf(waiting)} is ${WAIT_WORDS[reason]} — ${nameOf(shooter)} shoots again`,
    /** The same line for the waiting ball's own seat online. */
    skippedYou: (reason: WaitReason, shooter: PlayerId) => `Your ball is ${WAIT_WORDS[reason]} — ${nameOf(shooter)} shoots again`,
    holeComplete: 'HOLE COMPLETE!',
    restarted: 'HOLE RESTARTED',
    oob: 'OUT OF BOUNDS · +1 STROKE',
  }),
  coach: Object.freeze({
    step1: Object.freeze<Record<InputDevice, string>>({
      touch: 'Pull back from anywhere…',
      pointer: 'Drag back from anywhere…',
      keyboard: '← → to aim, ↑ ↓ for power…',
      gamepad: 'Left stick to aim, RT for power…',
    }),
    step2: Object.freeze<Record<InputDevice, string>>({
      touch: '…let go to shoot',
      pointer: '…let go to shoot',
      keyboard: '…Space to shoot',
      gamepad: '…Ⓐ to shoot',
    }),
    step3: 'A resting ball keeps a switch pressed — hold it for your partner.',
    passive: (p: PlayerId) => `${nameOf(p)} goes first — you'll get the same prompt on your turn`,
    gotIt: 'Got it',
  }),
  pause: Object.freeze({
    title: 'PAUSED',
    menuTitle: 'MENU',
    onlineNote: (p: PlayerId) => `The game keeps running for ${nameOf(p)}.`,
    resume: 'Resume',
    restart: 'Restart hole',
    restartHostOnly: (p: PlayerId) => `Only ${nameOf(p)} (host) can restart`,
    share: 'Copy share link',
    shareSub: 'Anyone with the link resumes this exact game.',
    settings: 'Settings',
    quit: 'Quit to title',
    leave: 'Leave game',
    room: (code: string) => `Room ${code}`,
    copyInvite: 'Copy invite link',
    stuck: 'Stuck?',
    /** The intro card's hint, kept reachable after the card is gone. */
    hint: 'Hint:',
    restartTitle: (n: number) => `Restart hole ${n}?`,
    restartBody: "Both balls go back to the tee and this hole's strokes reset to 0. Earlier holes are kept.",
    restartBodyOnline: (p: PlayerId) => `${nameOf(p)} will see a notice.`,
    restartConfirm: 'Restart',
    restartCancel: 'Keep playing',
    quitTitle: 'Quit this game?',
    quitBody: 'Progress on this hole is lost. Best medals are saved.',
    quitConfirm: 'Quit',
    quitCancel: 'Stay',
    leaveTitle: 'Leave the game?',
    leaveBody: (p: PlayerId) => `${nameOf(p)} will be left waiting.`,
    leaveConfirm: 'Leave',
  }),
  toast: Object.freeze({
    teedOff: (p: PlayerId) => `${nameOf(p)} teed off`,
    movedOn: (p: PlayerId) => `${nameOf(p)} moved on to the next hole`,
    restarted: (p: PlayerId) => `${nameOf(p)} restarted the hole`,
    isHere: (p: PlayerId) => `${nameOf(p)} is here!`,
    left: (p: PlayerId) => `${nameOf(p)} left`,
    isBack: (p: PlayerId) => `${nameOf(p)} is back!`,
    lostConnection: (p: PlayerId) => `${nameOf(p)} lost connection…`,
    controller: 'Controller connected',
    soundOn: 'Sound is on — use the speaker button to mute',
    reconnected: 'Reconnected',
    offline: "You're offline",
    copied: 'Copied!',
    copyFailed: "Couldn't copy — select the link and copy it yourself",
    notYourTurn: "That move wasn't allowed (not your turn)",
    notNow: 'Not right now',
    slowDown: 'Slow down a little',
    holderTip: (label: string, partner: PlayerId) =>
      `Stay on ${platePhrase(label)} for ${nameOf(partner)} — tap straight up at low power`,
    waitingNewRound: (p: PlayerId) => `Waiting for ${nameOf(p)} to start a new round…`,
  }),
  results: Object.freeze({
    hole: (n: number) => `HOLE ${n} COMPLETE`,
    team: 'TEAM',
    par: (par: number) => `PAR ${par}`,
    under: (k: number) => `${k} UNDER PAR`,
    even: 'PAR',
    over: (k: number) => `${k} OVER PAR`,
    flavour: Object.freeze({
      eagle: 'Eagle territory!',
      birdie: 'Birdie!',
      par: 'Par — solid.',
      bogey: 'Bogey, still bronze.',
      double: 'Double bogey, bronze.',
      none: 'No medal — try again for bronze.',
    }),
    medal: Object.freeze<Record<Medal, string>>({ gold: 'GOLD', silver: 'SILVER', bronze: 'BRONZE', none: 'NO MEDAL' }),
    medalNoneSub: 'par +2 or better for bronze',
    you: '(you)',
    newBest: 'NEW BEST!',
    best: (n: number, medal: Medal) => `Best on this hole: ${n} · ${COPY.results.medal[medal]}`,
    next: 'Next hole',
    seeResults: 'See results',
    retry: 'Retry hole',
    retryAsk: (p: PlayerId) => `Ask ${nameOf(p)} to retry`,
    quit: 'Quit to title',
    leave: 'Leave game',
    autoNext: (s: number) => `Next hole in ${s}`,
  }),
  campaign: Object.freeze({
    title: (world: WorldId) => `WORLD ${world} COMPLETE`,
    team: (total: number, par: number) => `TEAM ${total} · COURSE PAR ${par}`,
    under: (k: number) => `${k} UNDER COURSE PAR`,
    even: 'EVEN WITH COURSE PAR',
    over: (k: number) => `${k} OVER COURSE PAR`,
    cols: ['Hole', 'Par', 'Team', '±', 'Medal'] as const,
    total: 'TOTAL',
    perfect: 'PERFECT ROUND',
    summary: (g: number, s: number, b: number) => `${g} gold · ${s} silver · ${b} bronze`,
    players: (r: number, b: number) => `${nameOf(0)} ${r} · ${nameOf(1)} ${b}`,
    /** D10.2: a finished world offers the next one (online: the host presses it). */
    nextWorld: (world: WorldId) => `Continue to World ${world}`,
    playAgain: 'Play again',
    levelSelect: 'Level select',
    title2: 'Title',
  }),
  settings: Object.freeze({
    title: 'SETTINGS',
    sfx: 'Sound effects',
    music: 'Music',
    volume: 'Volume',
    motion: 'Reduced motion',
    hints: 'Control hints',
    reset: 'Reset best medals',
    done: 'Done',
    on: 'On',
    off: 'Off',
    motionOptions: Object.freeze({ system: 'System', on: 'On', off: 'Off' }),
    hintOptions: Object.freeze({ off: 'Off', auto: 'Auto', keyboard: 'Keyboard', pointer: 'Mouse', touch: 'Touch', gamepad: 'Gamepad' }),
    resetConfirm: 'Clear all best results on this device?',
    resetClear: 'Clear',
    resetCancel: 'Cancel',
    ringer: 'No sound? Check the ringer switch.',
  }),
  net: Object.freeze({
    lostTitle: 'CONNECTION LOST',
    reconnecting: (s: number) => `Reconnecting… ${s} s left`,
    rejoining: (code: string) => `Rejoining room ${code}…`,
    failedTitle: "COULDN'T RECONNECT",
    failed: 'The room has closed or the connection is down. Your best medals are saved.',
    partnerAway: (p: PlayerId, s: number) => `${nameOf(p)} lost connection. Waiting ${s} s for them…`,
    partnerAwaySub: (code: string) => `They can rejoin with room code ${code}`,
    keepWaiting: 'Keep waiting',
    partnerLeftTitle: (p: PlayerId) => `${upperNameOf(p)} LEFT THE GAME`,
    partnerTimeoutTitle: (p: PlayerId) => `${upperNameOf(p)} DIDN'T COME BACK`,
    partnerLeftSub: 'Thanks for playing together.',
    roomClosedTitle: 'THE ROOM CLOSED',
    roomClosed: 'The server closed this room. Your best medals are saved.',
    backToTitle: 'Back to title',
    leave: 'Leave game',
    createNew: 'Create a new room',
    copyCode: 'Copy room code',
  }),
  rotate: Object.freeze({
    title: 'Turn your phone sideways',
    sub: 'Flash Golf plays in landscape.',
    anyway: 'Play anyway',
  }),
  a11y: Object.freeze({
    canvas: 'Golf course. Use arrow keys to aim, Space to shoot.',
    close: 'Close',
    back: 'Back',
  }),
});

/** Intro-card and title-tray one-liners per mechanic (UX.md §9.3). */
export const MECHANIC_COPY: Readonly<Record<MechanicKind, { name: string; blurb: string }>> = Object.freeze({
  sand: { name: 'SAND', blurb: 'Slows the ball and kills the bounce.' },
  spring: { name: 'SPRING', blurb: 'Lands you here, throws you up.' },
  bumper: { name: 'BUMPER', blurb: 'Bounces the ball away hard.' },
  fan: { name: 'FAN', blurb: 'Lifts anything that flies through it.' },
  colourGate: { name: 'COLOUR GATE', blurb: 'Only the matching ball passes; the other bounces off.' },
  switch: { name: 'PRESSURE SWITCH', blurb: 'A resting ball holds it down. Leave, and it releases.' },
  bridge: { name: 'BRIDGE', blurb: 'Exists only while its switch is held.' },
  blocker: { name: 'GATE', blurb: 'Vanishes while its switch is held.' },
  trap: { name: 'TRAP', blurb: 'Stop in its jaws and you wait for your partner.' },
  cannon: { name: 'CANNON', blurb: 'Rest inside it; a ball on FIRE shoots you across.' },
});

/** Turn banner (UX.md §4.4): online me => YOUR TURN; local => RED'S TURN · P1; solo/partner => RED'S TURN. */
export function turnBanner(playerId: PlayerId, isYou: boolean, mode: SimMode = 'solo'): string {
  if (mode === 'online' && isYou) return COPY.banner.yourTurn;
  if (mode === 'local') return COPY.banner.turnLocal(playerId);
  return COPY.banner.turn(playerId);
}

/** A ball the WAITING rule passed over at a hand-off (the `turnSkipped` just before its `turnStart`). */
export type TurnSkip = { readonly playerId: PlayerId; readonly reason: WaitReason };

/** What one turn banner shows and says: the 28 px main line, the 15 px line under it, the live-region text. */
export type TurnBannerLines = { readonly text: string; readonly sub: string | null; readonly say: string };

/**
 * The banner of a `turnStart` (UX.md §4.4, BUILD_DECISIONS D10.10). A skipped turn keeps the short main line,
 * which fits the 500 px ribbon, and puts "Red is caught — Blue shoots again" under it in place of "your
 * partner"; online, the waiting ball's own seat reads "Your ball is caught — …". The live region reads the
 * main line and then the whole sentence.
 */
export function turnBannerLines(shooter: PlayerId, skip: TurnSkip | null, seats: readonly PlayerId[], mode: SimMode): TurnBannerLines {
  const mine = seats.includes(shooter);
  const text = turnBanner(shooter, mine, mode);
  if (skip === null) return { text, sub: mode === 'online' && !mine ? COPY.banner.partnerSub : null, say: text };
  const line = mode === 'online' && seats.includes(skip.playerId) ? COPY.banner.skippedYou(skip.reason, shooter) : COPY.banner.skipped(skip.playerId, skip.reason, shooter);
  return { text, sub: line, say: `${text}. ${line}` };
}

/** Mid-hole team delta (BUILD_DECISIONS D3 VISUAL 1-5): `N TO SPARE` / `AT PAR` / `N OVER`. */
export function teamDelta(teamStrokes: number, par: number): string {
  const d = teamStrokes - par;
  if (d < 0) return `${-d} TO SPARE`;
  if (d === 0) return 'AT PAR';
  return `${d} OVER`;
}

/** Golf delta chip for results and the tray: −1 / E / +2. */
export function golfDelta(teamStrokes: number, par: number): string {
  const d = teamStrokes - par;
  if (d < 0) return `−${-d}`;
  if (d === 0) return 'E';
  return `+${d}`;
}

/** Results verdict line in words: "1 UNDER PAR" / "PAR" / "2 OVER PAR". */
export function verdict(teamStrokes: number, par: number): string {
  const d = teamStrokes - par;
  if (d < 0) return COPY.results.under(-d);
  if (d === 0) return COPY.results.even;
  return COPY.results.over(d);
}

/** Title tray best line: "1 UNDER PAR" / "PAR" / "2 OVER PAR" (same words as the results verdict). */
export const trayVerdict = verdict;

export function flavour(teamStrokes: number, par: number): string {
  const d = teamStrokes - par;
  if (d <= -2) return COPY.results.flavour.eagle;
  if (d === -1) return COPY.results.flavour.birdie;
  if (d === 0) return COPY.results.flavour.par;
  if (d === 1) return COPY.results.flavour.bogey;
  if (d === 2) return COPY.results.flavour.double;
  return COPY.results.flavour.none;
}

/** Sticker/chip word for a switch: its authored label, else `SWITCH <letter>` by index (D2). */
export function switchLabel(level: Level, switchId: string): string {
  const index = level.switches.findIndex((s) => s.id === switchId);
  const sw = level.switches[index];
  if (sw?.label !== undefined && sw.label.length > 0) return sw.label.toUpperCase();
  return `SWITCH ${String.fromCharCode(65 + Math.max(0, index))}`;
}

export type ChipStatusInput = {
  active: boolean;
  phase: SimPhase;
  sunk: boolean;
  /** Label of the switch this ball holds, if any. */
  holdsLabel: string | null;
  /** The level wires the cup to a switch, so a sunk ball holds it. */
  cupHoldsLabel: string | null;
  /** The device this resting ball waits in and the labels of its release plates (FrameSummary.waiting, D10.10). */
  waiting: { readonly reason: WaitReason; readonly release: string } | null;
};

/**
 * Player chip status line (D2, D10.10): CUP HOLDS <label> / IN THE CUP / CAUGHT · needs <labels> /
 * LOADED · needs <labels> / AIMING / HOLDS <label> / WAITING. A caught ball on a seat plate (BAIT, DOOR)
 * still holds that plate but reads CAUGHT: the chip names what the partner has to do. The release text comes
 * from devices.releaseLabel already in the plates' (upper-case) labels joined with a lower-case 'or'.
 */
export function chipStatus(input: ChipStatusInput): string {
  const s = COPY.hud.status;
  if (input.sunk) return input.cupHoldsLabel === null ? s.inCup : s.holdsFromCup(input.cupHoldsLabel);
  if (input.waiting !== null) {
    const labels = input.waiting.release;
    return input.waiting.reason === 'caught' ? s.caught(labels) : s.loaded(labels);
  }
  if (input.active && (input.phase === 'aiming' || input.phase === 'flying')) return s.aiming;
  if (input.holdsLabel !== null) return s.holds(input.holdsLabel);
  return s.waiting;
}

export type LobbyErrorKind = ErrorCode | 'BAD_SNAPSHOT' | 'unreachable' | 'roomClosed';
export type LobbyErrorCopy = {
  title: string;
  body: string;
  primary: 'tryAgain' | 'retry' | 'reload' | 'back' | 'backToTitle';
  secondary: 'createOwn' | 'playSolo' | 'back' | null;
};

/** Error table (UX.md §3.2) keyed by ErrorCode / close reason. Raw server text is never shown. */
export function lobbyError(kind: LobbyErrorKind, code: string | null): LobbyErrorCopy {
  const c = COPY.lobby;
  const room = code === null ? 'That room' : `Room ${code}`;
  switch (kind) {
    case 'ROOM_NOT_FOUND':
      return { title: c.errJoin, body: `${room} isn't open. It may have ended or the code is mistyped.`, primary: 'tryAgain', secondary: 'createOwn' };
    case 'ROOM_FULL':
      return { title: c.errJoin, body: `${room} already has two players.`, primary: 'back', secondary: null };
    case 'unreachable':
      return { title: c.errConnect, body: "Can't reach the game server. Check your connection and try again.", primary: 'retry', secondary: 'playSolo' };
    case 'SERVER_FULL':
      return { title: c.errConnect, body: 'The server is busy right now. Try again in a minute.', primary: 'retry', secondary: 'back' };
    case 'VERSION_MISMATCH':
      return { title: c.errConnect, body: 'Your game is out of date — reload the page to update.', primary: 'reload', secondary: null };
    case 'BAD_TOKEN':
      return { title: c.errJoin, body: "Couldn't rejoin: the room moved on without you.", primary: 'backToTitle', secondary: null };
    case 'roomClosed':
      return { title: c.errClosed, body: 'The room closed before the game started.', primary: 'back', secondary: 'createOwn' };
    case 'BAD_SNAPSHOT':
    case 'BAD_MESSAGE':
      return { title: c.errConnect, body: 'The server and this game disagree — reload the page to update.', primary: 'reload', secondary: null };
    case 'ALREADY_IN_ROOM':
    case 'NOT_IN_ROOM':
    case 'NOT_HOST':
    case 'NOT_YOUR_TURN':
    case 'WRONG_PHASE':
    case 'RATE_LIMITED':
    case 'PEER_MISSING':
      return { title: c.errConnect, body: 'Something got out of step with the server. Try again.', primary: 'tryAgain', secondary: 'back' };
    case 'INTERNAL':
      return { title: c.errClosed, body: 'Something went wrong on the server and the room was closed.', primary: 'back', secondary: 'createOwn' };
  }
}

/** Toast copy for recoverable in-game command errors (UX.md §3.9 BAD_COMMAND row); null = no toast. */
export function commandErrorToast(code: ErrorCode | 'BAD_SNAPSHOT'): string | null {
  switch (code) {
    case 'NOT_YOUR_TURN':
      return COPY.toast.notYourTurn;
    case 'WRONG_PHASE':
    case 'PEER_MISSING':
      return COPY.toast.notNow;
    case 'RATE_LIMITED':
      return COPY.toast.slowDown;
    default:
      return null;
  }
}

/** Device word for the Settings hint picker when `hintDevice` is 'auto'. */
export function deviceLabel(device: InputDevice): string {
  return COPY.settings.hintOptions[device];
}
