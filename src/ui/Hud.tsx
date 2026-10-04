// OWNER: ui
/**
 * In-game HUD (UX.md §4; VISUAL.md §11): React/DOM, never canvas text, paper skin. Six clusters
 * anchored to the corners/edges of the 1280x720 stage; each scales from its own anchor by
 * `--hud-scale` (set by App on the stage layer) and the `.compact` variant engages below stage scale
 * 0.85. The power bar reads the `--power` custom property GameCanvas writes on the stage layer every
 * frame, so the meter runs at frame rate while React renders at 10 Hz. Compact touch layouts drop the
 * meter for a power number floating above the ball while a drag is live (`--ball-x/y`, `--dragging`;
 * UX.md §4.5). Also exports the inline-SVG `Icon` and the 48 px `IconButton` the other screens reuse.
 */
import React from 'react';
import type { Level, PlayerId, SimMode } from '../sim/types';
import type { FrameSummary } from '../view/GameCanvas';
import type { InputDevice } from '../view/view';
import { COPY, chipStatus, switchLabel, teamDelta, upperNameOf } from './copy';

// ---------------------------------------------------------------------------------------------
// Icons (inline SVG, 24-unit grid, ink strokes; no emoji anywhere in the shipped UI)
// ---------------------------------------------------------------------------------------------

export type IconName = 'mute' | 'unmute' | 'soundLocked' | 'pause' | 'overview' | 'follow' | 'gear' | 'link' | 'back' | 'close' | 'check' | 'flag' | 'star';

const ICON_PATHS: Readonly<Record<IconName, React.ReactNode>> = Object.freeze({
  unmute: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
      <path d="M16 9a4 4 0 0 1 0 6" />
      <path d="M18.5 6a8 8 0 0 1 0 12" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
      <path d="M16 9l5 6M21 9l-5 6" />
    </>
  ),
  soundLocked: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
      <path d="M17 7l1.5 3M20 10.5l-3 .5M18.5 14l-2-1.5" />
    </>
  ),
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1.5" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" rx="1.5" fill="currentColor" />
    </>
  ),
  overview: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 15l5-4 4 3 4-5 5 4" />
    </>
  ),
  follow: (
    <>
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  flag: (
    <>
      <path d="M6 21V4" />
      <path d="M6 4h11l-2 3.5 2 3.5H6z" fill="currentColor" />
    </>
  ),
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" fill="currentColor" />,
});

export function Icon({ name, size = 22 }: { name: IconName; size?: number }): React.JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICON_PATHS[name]}
    </svg>
  );
}

export type IconButtonProps = {
  icon: IconName;
  label: string;
  onClick(): void;
  pressed?: boolean | undefined;
  className?: string | undefined;
  /** 48 (HUD, logical px) or 44 (viewport-space corners) */
  size?: 48 | 44;
  /** `back` = descending uiBack instead of uiClick; `own` = the handler plays its own sound (AUDIO.md §8 item 5) */
  sfx?: ButtonSfx | undefined;
};

export type ButtonSfx = 'back' | 'own';

/**
 * A pointer click leaves the button focused, which would route the next Space/Enter back into the
 * button instead of the stage (pause reopening, mute flipping). Keyboard activation (`detail === 0`)
 * keeps focus so Tab navigation is unaffected.
 */
export function blurAfterPointerClick(e: React.MouseEvent<HTMLElement>): void {
  if (e.detail > 0) e.currentTarget.blur();
}

export function IconButton({ icon, label, onClick, pressed, className, size = 48, sfx }: IconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={`icon-btn icon-btn-${size}${className === undefined ? '' : ` ${className}`}`}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      data-sfx={sfx}
      onClick={(e) => {
        blurAfterPointerClick(e);
        onClick();
      }}
    >
      <Icon name={icon} />
    </button>
  );
}

/** Speaker button state (AUDIO.md §5): a persisted mute takes precedence over the locked glyph, so the label matches what a tap does. */
export function speakerState(audioLocked: boolean, muted: boolean): { icon: IconName; label: string; pressed: boolean | undefined } {
  if (muted) return { icon: 'mute', label: COPY.hud.unmute, pressed: true };
  if (audioLocked) return { icon: 'soundLocked', label: COPY.hud.tapForSound, pressed: undefined };
  return { icon: 'unmute', label: COPY.hud.mute, pressed: false };
}

// ---------------------------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------------------------

export type HudOnline = {
  roomCode: string;
  peerConnected: boolean;
  rttMs: number;
  offline: boolean;
  /** No pong for 3 s (UX.md §4.1 row BR): the link is half-open even though the socket reads OPEN. */
  stale: boolean;
  /** performance.now() deadline of the partner's reconnect grace, when they are away */
  partnerAwayDeadlineMs: number | null;
  /** performance.now() sampled by App at the same cadence as the summary */
  nowMs: number;
};

export type HudProps = {
  summary: FrameSummary;
  level: Level;
  holeNumber: number;
  holeCount: number;
  seat: PlayerId | null;
  mode: SimMode;
  /** switchId -> slot whose resting ball holds it (FrameSummary.holds, derived from SimState by GameCanvas) */
  holds: Readonly<Record<string, PlayerId>>;
  online?: HudOnline | undefined;
  muted: boolean;
  /** audio context not yet unlocked: the speaker button reads "Tap for sound" (AUDIO.md §5) */
  audioLocked: boolean;
  compact: boolean;
  /** false hides the hint pill (settings off, or hidden after the 3rd shot on holes > 1) */
  showHint: boolean;
  device: InputDevice;
  onPause(): void;
  onToggleMute(): void;
  onToggleCamera(): void;
  onToggleHint(): void;
};

const PLAYERS: readonly PlayerId[] = [0, 1];
const RTT_GOOD_MS = 120;
const RTT_OK_MS = 300;

function chipSub(mode: SimMode, seat: PlayerId | null, p: PlayerId): string | null {
  if (mode === 'online') return seat === p ? COPY.hud.you : COPY.hud.partner;
  if (mode === 'local') return p === 0 ? COPY.hud.p1 : COPY.hud.p2;
  return null;
}

function holdsLabelFor(level: Level, holds: Readonly<Record<string, PlayerId>>, p: PlayerId): string | null {
  for (const sw of level.switches) {
    if (holds[sw.id] === p && sw.id !== level.cupHoldsSwitch) return switchLabel(level, sw.id);
  }
  return null;
}

/** Hint-pill copy per phase (UX.md §4.3). */
export function hintTextFor(summary: FrameSummary, mode: SimMode, seat: PlayerId | null, device: InputDevice): string | null {
  const { phase, activePlayer } = summary;
  if (phase === 'flying') return COPY.hint.flying(activePlayer);
  if (phase !== 'aiming') return null;
  const mine = mode === 'online' ? seat === activePlayer : true;
  return mine ? COPY.hint.aim[device] : COPY.hint.partnerAiming(activePlayer);
}

/** Miss feedback copy (UX.md §5.2): shown while `summary.miss` is fresh, even with hints off. */
export function missTextFor(summary: FrameSummary, seat: PlayerId | null): string | null {
  const { miss, activePlayer } = summary;
  if (miss === null || summary.phase !== 'aiming') return null;
  if (miss === 'wrongBall') return COPY.hint.wrongBall(activePlayer);
  if (miss === 'notYourTurn') return COPY.hint.notYourTurn(activePlayer, seat ?? (activePlayer === 0 ? 1 : 0));
  return COPY.hint.miss;
}

function netTone(online: HudOnline): 'good' | 'ok' | 'bad' {
  if (online.offline || online.stale) return 'bad';
  if (online.rttMs < RTT_GOOD_MS) return 'good';
  if (online.rttMs < RTT_OK_MS) return 'ok';
  return 'bad';
}

export default function Hud(props: HudProps): React.JSX.Element {
  const { summary, level, holeNumber, holeCount, seat, mode, holds, online, muted, audioLocked, compact, showHint, device, onPause, onToggleMute, onToggleCamera, onToggleHint } = props;
  const team = summary.strokes[0] + summary.strokes[1];
  const aiming = summary.phase === 'aiming';
  const compactTouch = compact && device === 'touch';
  const showMeter = (aiming || summary.phase === 'flying') && !compactTouch;
  const showFloatPower = aiming && compactTouch && summary.seatIsActive;
  const angleDeg = Math.round((-summary.aim.angle * 180) / Math.PI);
  const power = Math.round(summary.aim.power);
  const hint = missTextFor(summary, seat) ?? (showHint ? hintTextFor(summary, mode, seat, device) : null);
  const wobbleChip = summary.miss === 'notYourTurn' && mode === 'online' ? summary.activePlayer : null;
  const cupLabel = level.cupHoldsSwitch === undefined ? null : switchLabel(level, level.cupHoldsSwitch);
  const speaker = speakerState(audioLocked, muted);
  const activeVars = { '--active': `var(--p${summary.activePlayer + 1})` } as React.CSSProperties;

  const partnerStatus = (p: PlayerId): string | null => {
    if (online === undefined || seat === p || online.peerConnected) return null;
    if (online.partnerAwayDeadlineMs === null) return COPY.hud.away;
    return COPY.hud.reconnecting(Math.max(0, Math.ceil((online.partnerAwayDeadlineMs - online.nowMs) / 1000)));
  };

  return (
    <div className={`hud${compact ? ' compact' : ''}${device === 'touch' ? ' touch' : ''}`} style={activeVars}>
      <div className="hud-top">
        <div className="cl tl">
          <button
            type="button"
            className="hud-card level-chip"
            onClick={(e) => {
              blurAfterPointerClick(e);
              onToggleHint();
            }}
            title={COPY.hud.hints}
            aria-label={`${COPY.hud.hole(holeNumber, holeCount)} ${level.name}. ${COPY.hud.hints}`}
          >
          <span className="lvl">
            {COPY.hud.hole(holeNumber, holeCount)}
            <span className="lvl-name"> · {level.name}</span>
          </span>
            <span className="par-pill">{COPY.hud.par(level.par)}</span>
          </button>
        </div>

        <div className="cl tc">
          <div className="hud-card team" aria-label={`${COPY.hud.team} ${team}, ${COPY.hud.par(level.par)}`}>
            <span className="lab">{COPY.hud.team}</span>
            <span className="big">{team}</span>
            <span className="par">{COPY.hud.teamPar(level.par)}</span>
            <span key={team} className={`delta ${team < level.par ? 'delta-good' : team === level.par ? 'delta-even' : 'delta-over'}`}>
              {teamDelta(team, level.par)}
            </span>
          </div>
        </div>

        <div className="cl tr">
          {PLAYERS.map((p) => {
          const active = summary.activePlayer === p && (aiming || summary.phase === 'flying');
          const sunk = summary.sunk[p];
          const sub = chipSub(mode, seat, p);
          const status =
            partnerStatus(p) ??
            chipStatus({ active, phase: summary.phase, sunk, holdsLabel: holdsLabelFor(level, holds, p), cupHoldsLabel: cupLabel });
          const isPartner = mode === 'online' && seat !== p;
          return (
            <div
              key={p}
              className={`hud-card chip ${p === 0 ? 'red' : 'blue'}${active ? ' active' : ''}${isPartner ? ' partner' : ''}${wobbleChip === p ? ' wobble' : ''}`}
              aria-label={`${upperNameOf(p)} ${status} ${summary.strokes[p]}`}
            >
              <span className="caret" aria-hidden="true">
                {sunk ? <Icon name="flag" size={16} /> : '▶'}
              </span>
              <span className="dot" />
              <span className="col">
                <span className="name">{upperNameOf(p)}</span>
                {sub !== null && <span className="sub-tag">{sub}</span>}
                <span className="status">{status}</span>
              </span>
              <span className="cnt">{summary.strokes[p]}</span>
            </div>
          );
        })}
          <IconButton icon={speaker.icon} label={speaker.label} onClick={onToggleMute} pressed={speaker.pressed} className="hud-card mute" />
          <IconButton icon="pause" label={COPY.hud.menu} onClick={onPause} className="hud-card" sfx="own" />
        </div>
      </div>

      <div className="cl bl">
        {showMeter && (
          <div className={`hud-card meter meter-p${summary.activePlayer + 1}${summary.phase === 'flying' ? ' frozen' : ''}`} aria-label={`${COPY.hud.power} ${power}, ${COPY.hud.angle(angleDeg)}`}>
            <span className="lab">{COPY.hud.power}</span>
            <div className="bar" aria-hidden="true">
              <div className="fill" />
              <i className="tick t25" />
              <i className="tick t50" />
              <i className="tick t75" />
            </div>
            <span className="num">{power}</span>
            <span className="deg">{COPY.hud.angle(angleDeg)}</span>
          </div>
        )}
        {hint !== null && <div className="hint-pill">{hint}</div>}
      </div>
      {showFloatPower && (
        <div className="hud-card float-power" aria-label={`${COPY.hud.power} ${power}`}>
          {power}
        </div>
      )}

      <div className="cl br">
        {online !== undefined && (
          <div className={`net net-${netTone(online)}`} aria-label={online.offline ? COPY.toast.offline : COPY.hud.net(Math.round(online.rttMs))}>
            <i />
            {online.offline ? COPY.hud.offline : COPY.hud.net(Math.round(online.rttMs))}
          </div>
        )}
        <IconButton
          icon={summary.cameraMode === 'overview' ? 'follow' : 'overview'}
          label={summary.cameraMode === 'overview' ? COPY.hud.follow : COPY.hud.overview}
          onClick={onToggleCamera}
          className="hud-card"
        />
      </div>
    </div>
  );
}
