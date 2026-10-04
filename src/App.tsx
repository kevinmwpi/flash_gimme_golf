// OWNER: ui
/**
 * Screen state machine `title | lobby | rejoin | game` (ARCH.md §1.13, UX.md §2). Builds sessions
 * (LocalSession with crypto.getRandomValues seeds; OnlineSessionView from the client's config once
 * the status reaches `playing`), mounts GameCanvas + the stage-space HUD layer + the viewport-space
 * cards. Overlays are driven by FrameSummary.phase and ClientStatus, never by an event alone; events
 * only feed the banner/toasts (including the holder tip) and the best table; the chips' holds come
 * from FrameSummary.holds (SimState-derived). Boot precedence
 * (main.tsx reads and strips the URL first): fg.reconnect -> rejoin; ?room= -> lobby auto-join once;
 * ?state= -> title with the shared card (broken link -> "older version" card); else title.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GameClient, type ClientStatus } from './net/GameClient';
import { getWsUrl } from './net/wsUrl';
import { LEVELS, campaignFrom, levelById } from './sim/levels/index';
import { buildShareUrl, decodeShareLink } from './sim/serialize';
import { createSim } from './sim/sim';
import type { Level, LevelResult, Medal, MetaScreen, PlayerCommand, PlayerId, SimConfig, SimEvent, SimMode, SimState } from './sim/types';
import { medalFor } from './sim/types';
import CampaignResults, { type CampaignRow } from './ui/CampaignResults';
import Callouts, { INFO_BANNER_MS, type Toast } from './ui/Callouts';
import Hud from './ui/Hud';
import LevelIntro from './ui/LevelIntro';
import LevelResults from './ui/LevelResults';
import Lobby, { NetOverlay, type NetOverlayKind } from './ui/Lobby';
import OnboardingHint from './ui/OnboardingHint';
import Pause, { ConfirmDialog } from './ui/Pause';
import Settings from './ui/Settings';
import Title, { type SharedCard } from './ui/Title';
import { COPY, commandErrorToast, otherPlayer, switchLabel } from './ui/copy';
import { createEventBus, type EventBus } from './ui/eventBus';
import { tapSpeaker } from './ui/speaker';
import { clearBests, loadBests, loadOnboarded, loadSettings, saveBest, saveOnboarded, saveSettings, type BestTable, type UiSettings } from './ui/storage';
import { inviteUrlFor, isRoomCode } from './ui/url';
import type { AudioSystem } from './view/audio';
import GameCanvas, { type FrameSummary, type LocalSession, type OnlineSessionView } from './view/GameCanvas';
import type { UiAction } from './view/input/index';
import type { InputDevice } from './view/view';

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/** What main.tsx read from the URL / sessionStorage before the first render (params already stripped). */
export type BootRoute = { room: string | null; state: string | null; rejoin: boolean };

export type AppProps = { audio: AudioSystem; boot: BootRoute; version: string };

type Session = LocalSession | OnlineSessionView;

type Screen =
  /** `focusTray`: arrived via "Level select", so the tray (not the last mode button) takes focus (UX.md §3.8) */
  | { kind: 'title'; shared: SharedCard | null; focusTray: boolean }
  /** `autoCreate`: arrived via an in-game "Create a new room", so the lobby creates at once */
  | { kind: 'lobby'; initialCode: string | null; autoJoin: boolean; autoCreate: boolean }
  | { kind: 'rejoin' }
  | { kind: 'game'; session: Session };

type SharedGame = { config: SimConfig; state: SimState };

type AudioState = { muted: boolean; music: boolean; volume: number; locked: boolean };

type StageMetrics = { scale: number; hudScale: number; compact: boolean };

const STAGE_W = 1280;
const STAGE_H = 720;
const COMPACT_BELOW = 0.85;
const HUD_SCALE_MIN = 1;
const HUD_SCALE_MAX = 1.7;
const HUD_SCALE_TARGET = 0.9;
const HINT_SHOTS_ON_LATER_HOLES = 3;
const NOW_TICK_MS = 250;
/** The results card waits for the HOLE COMPLETE! banner (UX.md §3.7; VISUAL.md §13). */
const RESULTS_CARD_HOLD_MS = INFO_BANNER_MS;
/** The "Sound is on" toast waits past the unlocking gesture's click so a tap on the speaker that mutes is seen first. */
const SOUND_TOAST_DELAY_MS = 600;

// ---------------------------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------------------------

function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] ?? 0;
}

function seatsFor(mode: SimMode, seat: PlayerId | null): readonly PlayerId[] {
  if (mode === 'solo') return [0];
  if (mode === 'local') return [0, 1];
  return seat === null ? [] : [seat];
}

function localSession(mode: 'solo' | 'local', levelId: string): LocalSession {
  const config: SimConfig = { playerCount: mode === 'solo' ? 1 : 2, levelIds: campaignFrom(levelId), seed: randomSeed(), mode };
  return { kind: 'local', config, initial: createSim(config), seats: seatsFor(mode, null) };
}

/** Resume a `?state=` payload locally (online payloads are downgraded to the chosen local mode). */
function sharedSession(shared: SharedGame, playerCount: 1 | 2): LocalSession {
  const mode: SimMode = playerCount === 1 ? 'solo' : 'local';
  const config: SimConfig = { ...shared.config, playerCount, mode };
  const state: SimState = { ...shared.state, config };
  const level = levelById(state.levelId);
  const events: SimEvent[] = [{ type: 'levelStart', levelId: state.levelId, levelIndex: state.levelIndex, firstPlayer: level.firstPlayer, restarted: false, tick: state.tick }];
  return { kind: 'local', config, initial: { state, events }, seats: seatsFor(mode, null) };
}

/** A finished round (`campaignResults`) has nothing to resume: the share card calls such a link broken rather than opening a dead game. */
function decodeShared(param: string): { card: SharedCard; game: SharedGame | null } {
  try {
    const game = decodeShareLink(param);
    if (game.state.phase === 'campaignResults') return { card: { kind: 'invalid' }, game: null };
    const level = levelById(game.state.levelId);
    const teamStrokes = game.state.players[0].strokes + game.state.players[1].strokes;
    return { card: { kind: 'ok', holeNumber: level.order, teamStrokes, toPlay: game.state.activePlayer }, game };
  } catch {
    return { card: { kind: 'invalid' }, game: null };
  }
}

/** Local sessions know their first state before the loop's first frame, so the intro card never waits for it. */
function initialSummary(session: Session): FrameSummary | null {
  if (session.kind !== 'local') return null;
  const s = session.initial.state;
  return {
    phase: s.phase,
    tick: s.tick,
    activePlayer: s.activePlayer,
    turnReady: false,
    strokes: [s.players[0].strokes, s.players[1].strokes],
    aim: s.players[s.activePlayer].aim,
    device: 'pointer',
    cameraMode: 'overview',
    levelId: s.levelId,
    seatIsActive: session.seats.includes(s.config.mode === 'solo' ? 0 : s.activePlayer),
    paused: false,
    sunk: [s.balls[0].sunk, s.balls[1].sunk],
    turnDelayTicks: s.turnDelayTicks,
    holds: {},
    miss: null,
  };
}

/** `/healthz` beside the socket path: on the deployed build the game server (CORS-enabled), in dev the Vite proxy to it. */
function healthUrlOf(wsUrl: string | null): string | null {
  if (wsUrl === null) return null;
  return wsUrl.replace(/^ws/, 'http').replace(/\/ws\/?$/, '/healthz');
}

/** main.tsx asks this before the first render; the token itself is owned by GameClient (ARCH.md §1.14). */
export function hasReconnectToken(): boolean {
  try {
    return sessionStorage.getItem('fg.reconnect') !== null;
  } catch {
    return false;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------------------------

function useStageMetrics(ref: React.RefObject<HTMLDivElement | null>): StageMetrics {
  const [metrics, setMetrics] = useState<StageMetrics>({ scale: 1, hudScale: 1, compact: false });
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      const scale = Math.max(0.01, Math.min(rect.width / STAGE_W, rect.height / STAGE_H));
      const hudScale = Math.min(HUD_SCALE_MAX, Math.max(HUD_SCALE_MIN, HUD_SCALE_TARGET / scale));
      setMetrics({ scale, hudScale, compact: scale < COMPACT_BELOW });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return metrics;
}

function useAudioState(audio: AudioSystem): [AudioState, { toggleMute(): void; toggleMusic(): void; setVolume(v: number): void }] {
  const [state, setState] = useState<AudioState>({ ...audio.settings, locked: !audio.ready });
  useEffect(() => audio.onReady(() => setState((s) => ({ ...s, locked: false }))), [audio]);
  const sync = useCallback(() => setState({ ...audio.settings, locked: !audio.ready }), [audio]);
  // Acts on the RENDERED locked state (AUDIO.md §5): the gesture listener has already flipped audio.ready.
  const lockedShown = state.locked;
  const toggleMute = useCallback(() => {
    tapSpeaker(audio, lockedShown);
    sync();
  }, [audio, lockedShown, sync]);
  const toggleMusic = useCallback(() => {
    audio.setMusic(!audio.settings.music);
    sync();
  }, [audio, sync]);
  const setVolume = useCallback(
    (v: number) => {
      audio.setVolume(v);
      sync();
    },
    [audio, sync],
  );
  return [state, { toggleMute, toggleMusic, setVolume }];
}

const IDLE_STATUS: ClientStatus = Object.freeze({ kind: 'idle' }) as ClientStatus;
const noopSubscribe = (): (() => void) => () => undefined;

function useClientStatus(client: GameClient | null): ClientStatus {
  const subscribe = useCallback((cb: () => void) => (client === null ? noopSubscribe() : client.subscribe(cb)), [client]);
  const read = useCallback(() => client?.getStatus() ?? IDLE_STATUS, [client]);
  return useSyncExternalStore(subscribe, read, read);
}

/** Coarse clock for countdowns; only ticks while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(performance.now()), NOW_TICK_MS);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

const AIM_KEY_CODES: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);

/** True while an aim key is held (UX.md §5.5: the coach fades the moment a key is held); only tracked while `active`. */
function useAimKeysHeld(active: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active) return;
    const down = new Set<string>();
    const onDown = (e: KeyboardEvent): void => {
      if (!AIM_KEY_CODES.has(e.code)) return;
      down.add(e.code);
      setHeld(true);
    };
    const onUp = (e: KeyboardEvent): void => {
      down.delete(e.code);
      if (down.size === 0) setHeld(false);
    };
    const onBlur = (): void => {
      down.clear();
      setHeld(false);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      setHeld(false);
    };
  }, [active]);
  return held;
}

function useToasts(): [Toast[], (text: string, tone?: Toast['tone']) => void, (id: number) => void] {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((text: string, tone?: Toast['tone']) => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((list) => [...list.slice(-1), tone === undefined ? { id, text } : { id, text, tone }]);
  }, []);
  const pop = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  return [toasts, push, pop];
}

type UiSoundHandlers = {
  onClickCapture(e: React.MouseEvent): void;
  onPointerOverCapture(e: React.PointerEvent): void;
  onFocusCapture(e: React.FocusEvent): void;
};

/**
 * Delegated UI sounds (AUDIO.md §8 item 5): button click = uiClick (+ unlock), except `data-sfx="back"`
 * (Back / cancel / quit / leave) = descending uiBack and `data-sfx="own"` (pause, resume) = silent here
 * because the handler plays its own cue. Mouse hover and keyboard `:focus-visible` focus = uiHover.
 */
function useUiSounds(audio: AudioSystem): UiSoundHandlers {
  const hovered = useRef<Element | null>(null);
  return useMemo(
    () => ({
      onClickCapture(e: React.MouseEvent) {
        if (!(e.target instanceof Element)) return;
        const button = e.target.closest('button');
        if (button === null) return;
        audio.unlock();
        const sfx = button.dataset['sfx'];
        if (sfx === 'own') return;
        audio.play(sfx === 'back' ? 'uiBack' : 'uiClick');
      },
      onPointerOverCapture(e: React.PointerEvent) {
        if (e.pointerType !== 'mouse' || !(e.target instanceof Element)) return;
        const button = e.target.closest('button');
        if (button === null || button === hovered.current) return;
        hovered.current = button;
        if (!button.hasAttribute('disabled')) audio.play('uiHover');
      },
      onFocusCapture(e: React.FocusEvent) {
        const el = e.target;
        if (!(el instanceof HTMLButtonElement) || !el.matches(':focus-visible')) return;
        if (!el.hasAttribute('disabled')) audio.play('uiHover');
      },
    }),
    [audio],
  );
}

// ---------------------------------------------------------------------------------------------
// Rotate prompt (UX.md §3.11): portrait phones; view-only, dismissable for the session
// ---------------------------------------------------------------------------------------------

const ROTATE_MAX_SHORT_SIDE = 600;

function usePortraitPhone(): boolean {
  const subscribe = useCallback((cb: () => void) => {
    const mq = window.matchMedia('(orientation: portrait)');
    mq.addEventListener('change', cb);
    window.addEventListener('resize', cb);
    return () => {
      mq.removeEventListener('change', cb);
      window.removeEventListener('resize', cb);
    };
  }, []);
  const read = useCallback(() => window.matchMedia('(orientation: portrait)').matches && Math.min(window.innerWidth, window.innerHeight) < ROTATE_MAX_SHORT_SIDE, []);
  return useSyncExternalStore(subscribe, read, () => false);
}

function RotatePrompt({ onPlayAnyway }: { onPlayAnyway(): void }): React.JSX.Element {
  return (
    <div className="overlay overlay-dark">
      <div className="card card-narrow" role="dialog" aria-modal="true" aria-labelledby="rotate-title">
        <span className="rotate-glyph" aria-hidden="true" />
        <h2 id="rotate-title" className="card-title">
          {COPY.rotate.title}
        </h2>
        <p className="body">{COPY.rotate.sub}</p>
        <button type="button" className="btn btn-ghost" onClick={onPlayAnyway} data-autofocus>
          {COPY.rotate.anyway}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Game screen (one session; HUD + cards + overlays)
// ---------------------------------------------------------------------------------------------

type GameScreenProps = {
  session: Session;
  audio: AudioSystem;
  audioState: AudioState;
  settings: UiSettings;
  bests: BestTable;
  onBest(levelId: string, teamStrokes: number, medal: Medal): void;
  clientStatus: ClientStatus;
  toasts: Toast[];
  pushToast(text: string, tone?: Toast['tone']): void;
  popToast(id: number): void;
  onToggleMute(): void;
  onOpenSettings(): void;
  settingsOpen: boolean;
  onQuit(): void;
  onLevelSelect(): void;
  onPlayAgainLocal(): void;
  onCreateRoom(): void;
  /**
   * the onboarding coach is on screen or about to be (hole 1's first-run intro card and first aiming turn);
   * App holds the "Sound is on" toast until it is gone so it never lands on top of the coach
   */
  onCoachVisible(visible: boolean): void;
};

type GameFlags = {
  /** local shots on the current hole (hint pill visibility) */
  shots: number;
  /** best BEFORE the current result, for the results card */
  resultBest: BestTable[string] | null;
  lastResult: LevelResult | null;
  campaign: { rows: CampaignRow[]; coursePar: number; total: number; medal: Medal } | null;
};

const EMPTY_FLAGS: GameFlags = { shots: 0, resultBest: null, lastResult: null, campaign: null };

function netOverlayFor(status: ClientStatus): NetOverlayKind | null {
  switch (status.kind) {
    case 'reconnecting':
      return 'reconnecting';
    case 'closed':
      if (status.reason === 'left') return null;
      if (status.reason === 'hostLeft' || status.reason === 'guestLeft') return 'partnerLeft';
      if (status.reason === 'peerTimeout') return 'partnerTimeout';
      if (status.reason === 'serverUnreachable' || status.reason === 'timeout') return 'lost';
      return 'roomClosed';
    case 'error':
      return status.recoverable ? null : 'lost';
    default:
      return null;
  }
}

function GameScreen(props: GameScreenProps): React.JSX.Element {
  const { session, audio, audioState, settings, bests, onBest, clientStatus, toasts, pushToast, popToast, onToggleMute, onOpenSettings, settingsOpen, onQuit, onLevelSelect, onPlayAgainLocal, onCreateRoom, onCoachVisible } = props;
  const online = session.kind === 'online';
  const seat: PlayerId | null = online ? session.seat : null;
  const seats = useMemo(() => (online ? seatsFor('online', session.seat) : session.seats), [online, session]);
  const isHost = !online || session.seat === 0;
  const mode = session.config.mode;

  const gameRef = useRef<HTMLDivElement>(null);
  /** GameCanvas writes the per-frame aim/ball custom properties here; every stage-space child inherits them. */
  const stageLayerRef = useRef<HTMLDivElement>(null);
  const externalCommands = useRef<PlayerCommand[]>([]);
  const externalUiActions = useRef<UiAction[]>([]);
  const stateRef = useRef<SimState | null>(null);
  const bus: EventBus = useMemo(() => createEventBus(), []);
  const metrics = useStageMetrics(gameRef);

  const [summary, setSummary] = useState<FrameSummary | null>(() => initialSummary(session));
  const [flags, setFlags] = useState<GameFlags>(EMPTY_FLAGS);
  const [paused, setPaused] = useState(false);
  /** true from `levelComplete` until the HOLE COMPLETE! banner has played; the results card waits for it */
  const [resultsHold, setResultsHold] = useState(false);
  /** online: a pending leave from a results card awaiting the "Leave the game?" confirm */
  const [confirmLeave, setConfirmLeave] = useState<(() => void) | null>(null);
  const [hintForced, setHintForced] = useState(false);
  const [playAnyway, setPlayAnyway] = useState(false);
  const portraitPhone = usePortraitPhone();
  const [coachDismissed, setCoachDismissed] = useState(() => loadOnboarded());
  const [firstRun] = useState(() => !loadOnboarded());
  const localContinue = useRef(false);
  const holderTipShown = useRef<string | null>(null);
  /** switchId -> slot, from switchOn/switchOff, for the holder-tip toast only (the chips read FrameSummary.holds). */
  const holdsRef = useRef<Record<string, PlayerId>>({});
  const bestsRef = useRef(bests);
  useEffect(() => {
    bestsRef.current = bests;
  }, [bests]);

  const level: Level = levelById(summary?.levelId ?? session.config.levelIds[0] ?? LEVELS[0]?.id ?? '');
  const holeCount = LEVELS.length;
  const levelIndex = session.config.levelIds.indexOf(level.id);
  const isLast = levelIndex === session.config.levelIds.length - 1;
  const device: InputDevice = settings.hintDevice === 'auto' ? (summary?.device ?? 'pointer') : settings.hintDevice;
  const countdownActive = online && (clientStatus.kind === 'reconnecting' || (clientStatus.kind === 'playing' && !clientStatus.peerConnected));
  const now = useNow(countdownActive);

  /** Stamped with the screen it was pressed on (MetaScreen): a second Next or a late Retry is dropped by the sim. */
  const sendMeta = useCallback(
    (type: 'continue' | 'restartLevel', phase?: 'intro' | 'levelResults') => {
      if (type === 'continue') localContinue.current = true;
      const screen: MetaScreen = { ...(levelIndex >= 0 ? { levelIndex } : {}), ...(phase === undefined ? {} : { phase }) };
      if (session.kind === 'online') session.client.sendCommand({ type, playerId: session.seat, ...screen });
      else externalCommands.current.push({ type, playerId: 0, ...screen });
    },
    [session, levelIndex],
  );

  // Event-derived UI state: holds, shot counts, bests, results, toasts the sim implies.
  useEffect(
    () =>
      bus.subscribe((e: SimEvent) => {
        switch (e.type) {
          case 'levelStart': {
            holdsRef.current = {};
            setFlags((f) => ({ ...EMPTY_FLAGS, campaign: f.campaign }));
            setResultsHold(false);
            setHintForced(false);
            holderTipShown.current = null;
            if (online && seat !== null && e.levelIndex > 0 && !e.restarted && !localContinue.current) pushToast(COPY.toast.movedOn(otherPlayer(seat)));
            localContinue.current = false;
            break;
          }
          case 'playStart':
            if (online && seat !== null && !localContinue.current) pushToast(COPY.toast.teedOff(otherPlayer(seat)));
            localContinue.current = false;
            break;
          case 'switchOn':
            holdsRef.current = { ...holdsRef.current, [e.switchId]: e.byPlayer };
            break;
          case 'switchOff': {
            const holds = { ...holdsRef.current };
            delete holds[e.switchId];
            holdsRef.current = holds;
            break;
          }
          case 'ballHit':
            if (seats.includes(e.playerId)) {
              setFlags((f) => ({ ...f, shots: f.shots + 1 }));
              saveOnboarded();
              setCoachDismissed(true);
            }
            break;
          case 'turnStart': {
            if (!seats.includes(e.playerId) || holderTipShown.current === level.id) break;
            const held = level.switches.find((sw) => holdsRef.current[sw.id] === e.playerId && sw.id !== level.cupHoldsSwitch);
            if (held !== undefined) {
              holderTipShown.current = level.id;
              pushToast(COPY.toast.holderTip(switchLabel(level, held.id), otherPlayer(e.playerId)));
            }
            break;
          }
          case 'levelComplete': {
            const previous = bestsRef.current[e.result.levelId] ?? null;
            setFlags((f) => ({ ...f, lastResult: e.result, resultBest: previous }));
            setResultsHold(true);
            onBest(e.result.levelId, e.teamStrokes, e.result.medal);
            break;
          }
          case 'campaignComplete':
            setFlags((f) => ({
              ...f,
              campaign: {
                rows: e.results.map((result) => ({ level: levelById(result.levelId), result })),
                coursePar: e.coursePar,
                total: e.totalStrokes,
                medal: e.medal,
              },
            }));
            break;
          default:
            break;
        }
      }),
    [bus, online, seat, seats, level, pushToast, onBest],
  );

  // Online status transitions -> toasts / partner-away clock / SFX (handled in the subscription callback).
  useEffect(() => {
    if (session.kind !== 'online') return;
    const { client, seat: mySeat } = session;
    const partner = otherPlayer(mySeat);
    let prev = client.getStatus();
    return client.subscribe((status) => {
      const before = prev;
      prev = status;
      if (status.kind === 'playing') {
        const was = before.kind === 'playing' ? before.peerConnected : true;
        if (!status.peerConnected && was) {
          pushToast(COPY.toast.lostConnection(partner), 'bad');
          audio.play('partnerLeft');
        } else if (status.peerConnected && !was) {
          pushToast(COPY.toast.isBack(partner), 'good');
          audio.play('partnerJoined');
        }
        if (before.kind === 'reconnecting') pushToast(COPY.toast.reconnected, 'good');
      }
    });
  }, [session, pushToast, audio]);

  // Non-fatal in-room server errors (NOT_YOUR_TURN, WRONG_PHASE, ...) -> toast + uiInvalid.
  useEffect(() => {
    if (session.kind !== 'online') return;
    return session.client.onServerError((code) => {
      const text = commandErrorToast(code);
      if (text === null) return;
      pushToast(text);
      audio.play('uiInvalid');
    });
  }, [session, pushToast, audio]);

  // Offline flag for the net pill.
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  useEffect(() => {
    const on = (): void => setOffline(false);
    const off = (): void => {
      setOffline(true);
      pushToast(COPY.toast.offline, 'bad');
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [pushToast]);

  // HOLE COMPLETE! banner first, then the card (a resumed share link at levelResults has no banner: no hold).
  useEffect(() => {
    if (!resultsHold) return;
    const t = window.setTimeout(() => setResultsHold(false), RESULTS_CARD_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [resultsHold]);

  // Leaving the page mid-hole asks first (UX.md §2).
  const midHole = summary?.phase === 'aiming' || summary?.phase === 'flying';
  useEffect(() => {
    if (!midHole) return;
    const guard = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [midHole]);

  // H replays the hint pill (UX.md §10); only when the page itself has focus (never inside a card).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = document.activeElement;
      const pageHasFocus = target === null || target === document.body || target instanceof HTMLCanvasElement;
      if (e.code === 'KeyH' && pageHasFocus && !e.ctrlKey && !e.metaKey && !e.altKey) setHintForced((f) => !f);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Browser Back opens the menu instead of leaving the game.
  useEffect(() => {
    history.pushState({ fg: 'game' }, '');
    const onPop = (): void => {
      setPaused(true);
      history.pushState({ fg: 'game' }, '');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const onUiAction = useCallback(
    (action: UiAction) => {
      if (action === 'pause') {
        setPaused((p) => !p);
        audio.play(paused ? 'uiResume' : 'uiPause');
      } else if (action === 'toggleMute') onToggleMute();
      else if (action === 'back') setPaused(false);
    },
    [audio, onToggleMute, paused],
  );

  const openPause = useCallback(() => {
    setPaused(true);
    audio.play('uiPause');
  }, [audio]);
  const closePause = useCallback(() => {
    setPaused(false);
    audio.play('uiResume');
  }, [audio]);

  const quit = useCallback(() => {
    if (session.kind === 'online') session.client.leave();
    onQuit();
  }, [session, onQuit]);
  const leaveToLevelSelect = useCallback(() => {
    if (session.kind === 'online') session.client.leave();
    onLevelSelect();
  }, [session, onLevelSelect]);
  /** Online, leaving strands the partner, so every results-card exit confirms like the pause menu (UX.md §3.7/§3.8). */
  const guarded = useCallback((leave: () => void) => (online ? () => setConfirmLeave(() => leave) : leave), [online]);

  const copyInvite = useMemo(() => (online && clientStatus.kind === 'playing' ? () => copyToClipboard(inviteUrlFor(clientStatus.code)) : undefined), [online, clientStatus]);
  /** Local modes only: the share link encodes the state rendered on the last frame (UX.md §3.6). */
  const copyShare = useMemo(
    () =>
      online
        ? undefined
        : () => {
            const state = stateRef.current;
            return state === null ? Promise.resolve(false) : copyToClipboard(buildShareUrl(`${window.location.origin}${window.location.pathname}`, state));
          },
    [online],
  );

  const holeNumber = level.order;
  /** The hole's result is a pure function of the summary, so a resumed share link at levelResults still shows the card. */
  const levelResult: LevelResult | null =
    summary?.phase === 'levelResults'
      ? (flags.lastResult ?? { levelId: level.id, par: level.par, strokes: summary.strokes, medal: medalFor(summary.strokes[0] + summary.strokes[1], level.par) })
      : null;
  const showHint = settings.hints && (hintForced || holeNumber === 1 || flags.shots < HINT_SHOTS_ON_LATER_HOLES);
  const roundOver = summary?.phase === 'campaignResults';
  const netKind = online ? netOverlayFor(clientStatus) : null;
  const roomCode = clientStatus.kind === 'playing' || clientStatus.kind === 'reconnecting' || clientStatus.kind === 'waiting' || clientStatus.kind === 'joined' ? clientStatus.code : null;
  const partnerAway = online && clientStatus.kind === 'playing' && !clientStatus.peerConnected;
  const partnerDeadline = partnerAway ? (clientStatus.peerDeadlineMs ?? null) : null;
  const reconnectSeconds = clientStatus.kind === 'reconnecting' ? Math.max(0, Math.ceil((clientStatus.deadlineMs - now) / 1000)) : partnerDeadline === null ? null : Math.max(0, Math.ceil((partnerDeadline - now) / 1000));
  const showCoach = !coachDismissed && holeNumber === 1 && summary?.phase === 'aiming' && !paused;
  const aimKeyHeld = useAimKeysHeld(showCoach);
  /** Includes the hole-1 intro: a toast pushed under the intro card would still be up when the coach appears. */
  const coachPending = !coachDismissed && holeNumber === 1 && (summary?.phase === 'intro' || summary?.phase === 'aiming');
  useEffect(() => {
    onCoachVisible(coachPending);
    return () => onCoachVisible(false);
  }, [coachPending, onCoachVisible]);
  const stageStyle = { '--stage-scale': metrics.scale, '--hud-scale': metrics.hudScale } as React.CSSProperties;

  return (
    <div ref={gameRef} className="game">
      <GameCanvas
        session={session}
        paused={paused && !online}
        onUiAction={onUiAction}
        onFrame={setSummary}
        onEvents={bus.push}
        audio={audio}
        externalCommands={externalCommands}
        externalUiActions={externalUiActions}
        stateRef={stateRef}
        hudRef={stageLayerRef}
      />

      <div ref={stageLayerRef} className={`stage-layer${metrics.compact ? ' compact' : ''}`} style={stageStyle}>
        {summary !== null && (
          <Hud
            summary={summary}
            level={level}
            holeNumber={holeNumber}
            holeCount={holeCount}
            seat={seat}
            mode={mode}
            holds={summary.holds}
            online={
              online
                ? {
                    roomCode: roomCode ?? '',
                    peerConnected: !partnerAway,
                    rttMs: session.client.rttMs(),
                    offline,
                    stale: session.client.linkStale(),
                    partnerAwayDeadlineMs: partnerDeadline,
                    nowMs: now,
                  }
                : undefined
            }
            muted={audioState.muted}
            audioLocked={audioState.locked}
            compact={metrics.compact}
            showHint={showHint}
            device={device}
            onPause={openPause}
            onToggleMute={onToggleMute}
            onToggleCamera={() => externalUiActions.current.push('toggleCamera')}
            onToggleHint={() => setHintForced((f) => !f)}
          />
        )}
        <Callouts bus={bus} seats={seats} mode={mode} toasts={toasts} onToastDone={popToast} />
        {showCoach && summary !== null && (
          <OnboardingHint
            device={device}
            variant="stage"
            passive={online && seat !== summary.activePlayer}
            firstPlayer={summary.activePlayer}
            faded={aimKeyHeld}
            onDismiss={() => {
              saveOnboarded();
              setCoachDismissed(true);
            }}
          />
        )}
        {netKind === null && partnerAway && seat !== null && (
          <NetOverlay kind="partnerAway" seat={seat} roomCode={roomCode} secondsLeft={reconnectSeconds} isHost={isHost} onLeave={quit} onBack={quit} onCreateRoom={onCreateRoom} />
        )}
      </div>

      {summary?.phase === 'intro' && !paused && (
        <LevelIntro
          level={level}
          holeNumber={holeNumber}
          holeCount={holeCount}
          firstPlayer={summary.activePlayer}
          mode={mode}
          seat={seat}
          device={device}
          firstRun={firstRun}
          onContinue={() => sendMeta('continue', 'intro')}
        />
      )}
      {levelResult !== null && !paused && !resultsHold && (
        <LevelResults
          level={level}
          holeNumber={holeNumber}
          result={levelResult}
          previousBest={flags.lastResult === null ? (bests[level.id] ?? null) : flags.resultBest}
          mode={mode}
          seat={seat}
          isHost={isHost}
          isLast={isLast}
          onNext={() => sendMeta('continue', 'levelResults')}
          onRetry={() => sendMeta('restartLevel', 'levelResults')}
          onQuit={guarded(quit)}
        />
      )}
      {summary?.phase === 'campaignResults' && flags.campaign !== null && (
        <CampaignResults
          rows={flags.campaign.rows}
          coursePar={flags.campaign.coursePar}
          total={flags.campaign.total}
          medal={flags.campaign.medal}
          mode={mode}
          seat={seat}
          isHost={isHost}
          waitingForHost={online}
          onPlayAgain={() => (session.kind === 'online' ? session.client.playAgain() : onPlayAgainLocal())}
          onLevelSelect={guarded(leaveToLevelSelect)}
          onTitle={guarded(quit)}
        />
      )}
      {confirmLeave !== null && seat !== null && (
        <ConfirmDialog
          title={COPY.pause.leaveTitle}
          body={COPY.pause.leaveBody(otherPlayer(seat))}
          confirmLabel={COPY.pause.leaveConfirm}
          cancelLabel={COPY.pause.quitCancel}
          danger
          onConfirm={() => {
            setConfirmLeave(null);
            confirmLeave();
          }}
          onCancel={() => setConfirmLeave(null)}
        />
      )}
      {paused && !settingsOpen && (
        <Pause
          mode={mode}
          isHost={isHost}
          roundOver={roundOver}
          seat={seat}
          roomCode={roomCode ?? undefined}
          holeNumber={holeNumber}
          device={device}
          hint={level.hint}
          watchOut={level.watchOut}
          muted={audioState.muted}
          onToggleMute={onToggleMute}
          onResume={closePause}
          onRestart={() => {
            sendMeta('restartLevel');
            setPaused(false);
          }}
          onQuit={quit}
          onOpenSettings={onOpenSettings}
          onCopyShare={copyShare}
          onCopyInvite={copyInvite}
        />
      )}
      {netKind !== null && seat !== null && (
        <NetOverlay kind={netKind} seat={seat} roomCode={roomCode} secondsLeft={reconnectSeconds} isHost={isHost} onLeave={quit} onBack={quit} onCreateRoom={onCreateRoom} />
      )}
      {portraitPhone && !playAnyway && <RotatePrompt onPlayAnyway={() => setPlayAnyway(true)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------------------------

/** A complete `?room=` code auto-joins; a mangled one still opens the lobby with the text prefilled (UX.md §2). */
function initialScreen(boot: BootRoute, shared: { card: SharedCard; game: SharedGame | null } | null): Screen {
  if (boot.rejoin) return { kind: 'rejoin' };
  if (boot.room !== null) return { kind: 'lobby', initialCode: boot.room, autoJoin: isRoomCode(boot.room), autoCreate: false };
  return { kind: 'title', shared: shared?.card ?? null, focusTray: false };
}

export default function App({ audio, boot, version }: AppProps): React.JSX.Element {
  const shared = useMemo(() => (boot.state === null ? null : decodeShared(boot.state)), [boot.state]);
  const [screen, setScreen] = useState<Screen>(() => initialScreen(boot, shared));
  const [settings, setSettings] = useState<UiSettings>(() => loadSettings());
  const [bests, setBests] = useState<BestTable>(() => loadBests());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detectedDevice, setDetectedDevice] = useState<InputDevice>(() =>
    typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && !window.matchMedia('(pointer: fine)').matches ? 'touch' : 'pointer',
  );
  const [audioState, audioActions] = useAudioState(audio);
  const [toasts, pushToast, popToast] = useToasts();
  const wsUrl = useMemo(() => getWsUrl(), []);
  const client = useMemo(() => (wsUrl === null ? null : new GameClient({ url: wsUrl })), [wsUrl]);
  const clientStatus = useClientStatus(client);
  const uiSounds = useUiSounds(audio);
  /** Toasts outside the game (title / lobby) still render through Callouts; no sim events flow here. */
  const idleBus = useMemo(() => createEventBus(), []);
  const rejoinStarted = useRef(false);
  /** tryReconnect resolved false without a closed/error status (no or unreadable stored session) */
  const [rejoinFailed, setRejoinFailed] = useState(false);
  const soundToastShown = useRef(false);
  const [coachShowing, setCoachShowing] = useState(false);

  // Reduced motion: one knob (`--motion`) read by every animation in styles.css.
  useEffect(() => {
    document.documentElement.dataset.motion = settings.reducedMotion;
  }, [settings.reducedMotion]);

  // One-time "Sound is on" toast when the context unlocks (AUDIO.md §5), decided after the unlocking
  // gesture's click has run: a first tap on the speaker that mutes must not be answered with "Sound is on".
  // It waits while the onboarding coach is up so the first screen never stacks three messages (UX.md §5.5).
  useEffect(() => {
    if (audioState.locked || soundToastShown.current || coachShowing) return;
    const t = window.setTimeout(() => {
      if (soundToastShown.current || audio.isMuted()) return;
      soundToastShown.current = true;
      pushToast(COPY.toast.soundOn, 'good');
    }, SOUND_TOAST_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [audioState.locked, coachShowing, audio, pushToast]);

  // Music bed (AUDIO.md §7): wanted from the first frame (unlock starts it), title mode outside a game;
  // handleEvents switches to play on playStart / turnStart / ballHit (a restart, resume or join sees no playStart)
  // and back to title on level/campaign complete.
  useEffect(() => {
    audio.music.start('title');
  }, [audio]);
  useEffect(() => {
    if (screen.kind !== 'game') audio.music.setMode('title');
  }, [screen.kind, audio]);

  // Lobby: the partner arriving / leaving the host's room is audible (AUDIO.md §2 partnerJoined / partnerLeft).
  useEffect(() => {
    if (client === null) return;
    let prev = client.getStatus();
    return client.subscribe((status) => {
      const before = prev;
      prev = status;
      if (status.kind !== 'waiting') return;
      const was = before.kind === 'waiting' ? before.peerConnected : false;
      if (status.peerConnected && !was) audio.play('partnerJoined');
      else if (!status.peerConnected && was) audio.play('partnerLeft');
    });
  }, [client, audio]);

  // Boot-time rejoin: exactly once. A false result without a closed/error status (nothing stored, or a
  // session this build cannot read) is a failure too, so the spinner never runs forever.
  useEffect(() => {
    if (screen.kind !== 'rejoin' || client === null || rejoinStarted.current) return;
    rejoinStarted.current = true;
    void client.tryReconnect().then((ok) => {
      if (!ok) setRejoinFailed(true);
    });
  }, [screen.kind, client]);

  // Online: the moment the client reports `playing`, build (or replace, after playAgain) the online session.
  // A rejoin that lands back in the lobby (the room had not started: `waiting` / `joined`) opens the Lobby,
  // which renders the hosting / joined card from the client status (UX.md §3.2).
  useEffect(() => {
    if (client === null) return;
    return client.subscribe((status) => {
      if (status.kind === 'waiting' || status.kind === 'joined') {
        setScreen((s) => (s.kind === 'rejoin' ? { kind: 'lobby', initialCode: null, autoJoin: false, autoCreate: false } : s));
        return;
      }
      if (status.kind !== 'playing') return;
      const config = client.getConfig();
      if (config === null) return;
      setScreen((s) => {
        if (s.kind === 'game' && s.session.kind === 'online' && s.session.config === config) return s;
        if (s.kind === 'title') return s;
        return { kind: 'game', session: { kind: 'online', client, config, seat: status.seat } };
      });
    });
  }, [client]);

  const updateSettings = useCallback((patch: Partial<UiSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const startLocal = useCallback(
    (mode: 'solo' | 'local', levelId: string) => {
      audio.unlock();
      updateSettings({ lastMode: mode });
      setScreen({ kind: 'game', session: localSession(mode, levelId) });
    },
    [audio, updateSettings],
  );

  const openLobby = useCallback(() => {
    audio.unlock();
    updateSettings({ lastMode: 'online' });
    setScreen({ kind: 'lobby', initialCode: null, autoJoin: false, autoCreate: false });
  }, [audio, updateSettings]);
  /** "Create a new room" after the partner left: straight into a fresh room, not the lobby menu. */
  const createRoom = useCallback(() => {
    updateSettings({ lastMode: 'online' });
    setScreen({ kind: 'lobby', initialCode: null, autoJoin: false, autoCreate: true });
  }, [updateSettings]);

  const toTitle = useCallback(() => setScreen({ kind: 'title', shared: null, focusTray: false }), []);
  /** Leaving the rejoin screen releases the room, the socket and the stored token, so the next load is clean. */
  const leaveRejoin = useCallback(() => {
    client?.leave();
    toTitle();
  }, [client, toTitle]);
  const toLevelSelect = useCallback(() => setScreen({ kind: 'title', shared: null, focusTray: true }), []);

  const onBest = useCallback((levelId: string, teamStrokes: number, medal: Medal) => setBests(saveBest(levelId, teamStrokes, medal)), []);

  const resetBests = useCallback(() => {
    clearBests();
    setBests({});
  }, []);

  const playAgainLocal = useCallback(() => {
    setScreen((s) => {
      if (s.kind !== 'game' || s.session.kind !== 'local') return s;
      const first = s.session.config.levelIds[0];
      if (first === undefined) return s;
      return { kind: 'game', session: localSession(s.session.config.mode === 'solo' ? 'solo' : 'local', first) };
    });
  }, []);

  useEffect(() => {
    if (screen.kind !== 'game') return;
    const onPointer = (e: PointerEvent): void => setDetectedDevice(e.pointerType === 'touch' ? 'touch' : 'pointer');
    const onKey = (): void => setDetectedDevice('keyboard');
    window.addEventListener('pointerdown', onPointer, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [screen.kind]);

  const settingsOverlay = settingsOpen && (
    <Settings
      muted={audioState.muted}
      onToggleMute={audioActions.toggleMute}
      music={audioState.music}
      onToggleMusic={audioActions.toggleMusic}
      volume={audioState.volume}
      onVolume={audioActions.setVolume}
      settings={settings}
      onChange={updateSettings}
      detectedDevice={detectedDevice}
      onResetBests={resetBests}
      onClose={() => setSettingsOpen(false)}
    />
  );

  let content: React.JSX.Element;
  switch (screen.kind) {
    case 'title':
      content = (
        <Title
          bests={bests}
          settings={settings}
          shared={screen.shared}
          onlineAvailable={client !== null}
          healthUrl={healthUrlOf(wsUrl)}
          version={version}
          muted={audioState.muted}
          audioLocked={audioState.locked}
          focusTray={screen.focusTray}
          onToggleMute={audioActions.toggleMute}
          onSolo={(id) => startLocal('solo', id)}
          onLocal={(id) => startLocal('local', id)}
          onOnline={openLobby}
          onOpenSettings={() => setSettingsOpen(true)}
          onContinueShared={(playerCount) => {
            if (shared === null || shared.game === null) return;
            audio.unlock();
            setScreen({ kind: 'game', session: sharedSession(shared.game, playerCount) });
          }}
          onDismissShared={toTitle}
        />
      );
      break;
    case 'lobby':
      content =
        client === null ? (
          <Title
            bests={bests}
            settings={settings}
            shared={null}
            onlineAvailable={false}
            healthUrl={null}
            version={version}
            muted={audioState.muted}
            audioLocked={audioState.locked}
            focusTray={false}
            onToggleMute={audioActions.toggleMute}
            onSolo={(id) => startLocal('solo', id)}
            onLocal={(id) => startLocal('local', id)}
            onOnline={openLobby}
            onOpenSettings={() => setSettingsOpen(true)}
            onContinueShared={() => undefined}
            onDismissShared={toTitle}
          />
        ) : (
          <Lobby
            client={client}
            status={clientStatus}
            initialCode={screen.initialCode}
            autoJoin={screen.autoJoin}
            autoCreate={screen.autoCreate}
            onBack={toTitle}
            onPlaySolo={() => startLocal('solo', LEVELS[0]?.id ?? '')}
          />
        );
      break;
    case 'rejoin': {
      const failed = client === null || rejoinFailed || clientStatus.kind === 'closed' || clientStatus.kind === 'error';
      const code = clientStatus.kind === 'reconnecting' ? clientStatus.code : null;
      content = (
        <main className="screen rejoin">
          <NetOverlay kind={failed ? 'lost' : 'rejoining'} seat={0} roomCode={code} secondsLeft={null} isHost={false} onLeave={leaveRejoin} onBack={leaveRejoin} onCreateRoom={createRoom} />
        </main>
      );
      break;
    }
    case 'game':
      content = (
        <GameScreen
          key={screen.session.kind === 'local' ? screen.session.config.seed : `online-${screen.session.config.seed}`}
          session={screen.session}
          audio={audio}
          audioState={audioState}
          settings={settings}
          bests={bests}
          onBest={onBest}
          clientStatus={clientStatus}
          toasts={toasts}
          pushToast={pushToast}
          popToast={popToast}
          onToggleMute={audioActions.toggleMute}
          onOpenSettings={() => setSettingsOpen(true)}
          settingsOpen={settingsOpen}
          onQuit={toTitle}
          onLevelSelect={toLevelSelect}
          onPlayAgainLocal={playAgainLocal}
          onCreateRoom={createRoom}
          onCoachVisible={setCoachShowing}
        />
      );
      break;
  }

  return (
    <div className="app" onClickCapture={uiSounds.onClickCapture} onPointerOverCapture={uiSounds.onPointerOverCapture} onFocusCapture={uiSounds.onFocusCapture}>
      {content}
      {settingsOverlay}
      {screen.kind !== 'game' && (
        <div className="viewport-toasts">
          <Callouts bus={idleBus} seats={[]} mode="solo" toasts={toasts} onToastDone={popToast} />
        </div>
      )}
    </div>
  );
}
