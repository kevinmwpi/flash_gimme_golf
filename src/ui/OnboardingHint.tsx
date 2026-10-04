// OWNER: ui
/**
 * One-time onboarding coach (UX.md §5.5; ARCH.md §1.13; persisted via storage.saveOnboarded after the
 * first shot). Two placements: a compact strip inside the hole-1 intro card and a stage-space strip
 * anchored above the active ball during the first aiming turn (styles.css positions it from the
 * --ball-x / --ball-y vars GameCanvas writes; it fades while a drag is live or, via `faded`, while an
 * aim key is held). Never blocks input. Online, the partner who is not first gets the
 * passive line so hole 1 never looks frozen. The pointer/touch pictogram is a chunky outlined hand
 * that presses the red ball and pulls back along the aim while the dashed band grows from the ball
 * (the in-world band style), then releases and loops; keyboard/gamepad show keycaps instead.
 */
import React from 'react';
import type { PlayerId } from '../sim/types';
import type { InputDevice } from '../view/view';
import { COPY } from './copy';

export type OnboardingHintProps = {
  device: InputDevice;
  variant: 'card' | 'stage';
  /** online partner who is not shooting first */
  passive: boolean;
  /** who shoots first (named in the passive line) */
  firstPlayer: PlayerId;
  /** stage variant only */
  onDismiss?: (() => void) | undefined;
  /** stage variant only: hidden while the player is already aiming with keys */
  faded?: boolean | undefined;
};

const KEYCAPS: Readonly<Record<InputDevice, readonly string[]>> = Object.freeze({
  keyboard: ['←', '→', '↑', '↓', 'Space'],
  gamepad: ['LS', 'RT', 'Ⓐ'],
  pointer: [],
  touch: [],
});

/** Pictogram geometry (viewBox units): the ball, and where the fingertip ends after the pull. */
const BALL = { x: 112, y: 26 };
const PULLED = { x: 46, y: 40 };
/** Angle that turns the glyph's "finger up" into "finger toward the ball" from the pulled position. */
const HAND_ROTATION_DEG = Math.round((Math.atan2(BALL.y - PULLED.y, BALL.x - PULLED.x) * 180) / Math.PI + 90);

/**
 * Pointer hand on a 24-unit grid, fingertip at (12, 2): index finger up, three folded fingers, thumb
 * tucked on the left; white fill, 3 px ink outline (VISUAL.md hand style).
 */
function HandGlyph(): React.JSX.Element {
  return (
    <g transform={`rotate(${HAND_ROTATION_DEG}) scale(1.55) translate(-12 -2)`} fill="#fff" stroke="var(--ink)" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
      <path d="M9.6 12.5V4.2a2.4 2.4 0 0 1 4.8 0V11l2.1-.6a2 2 0 0 1 2.4 1.5l.5.1a2 2 0 0 1 2.3 1.6a2 2 0 0 1 2.1 2.2L22.6 19a6 6 0 0 1-6 5.5h-3.3a6.5 6.5 0 0 1-5.4-2.9L4.3 16a2.3 2.3 0 0 1 3.7-2.6z" />
      <path d="M14.4 11v4.5M18.9 12.2v3.6M21.6 14.4v2.3" />
    </g>
  );
}

function Pictogram({ device }: { device: InputDevice }): React.JSX.Element {
  if (device === 'keyboard' || device === 'gamepad') {
    return (
      <span className="keycaps" aria-hidden="true">
        {KEYCAPS[device].map((k) => (
          <kbd key={k}>{k}</kbd>
        ))}
      </span>
    );
  }
  const handStyle = { '--coach-dx': `${BALL.x - PULLED.x}px`, '--coach-dy': `${BALL.y - PULLED.y}px` } as React.CSSProperties;
  return (
    <svg className="coach-hand" viewBox="0 0 140 64" width="140" height="64" aria-hidden="true" focusable="false">
      <line className="coach-band" x1={BALL.x} y1={BALL.y} x2={PULLED.x} y2={PULLED.y} stroke="var(--ink)" strokeWidth="4" strokeDasharray="6 6" strokeLinecap="round" style={{ transformOrigin: `${BALL.x}px ${BALL.y}px` }} />
      <circle cx={BALL.x} cy={BALL.y} r="12" fill="var(--p1)" stroke="var(--ink)" strokeWidth="3.5" />
      <ellipse cx={BALL.x - 4} cy={BALL.y - 5} rx="3" ry="1.8" fill="#fff" fillOpacity="0.9" transform={`rotate(-30 ${BALL.x - 4} ${BALL.y - 5})`} />
      <g className="coach-finger" style={handStyle}>
        <g transform={`translate(${PULLED.x} ${PULLED.y})`}>
          <HandGlyph />
        </g>
      </g>
    </svg>
  );
}

export default function OnboardingHint({ device, variant, passive, firstPlayer, onDismiss, faded = false }: OnboardingHintProps): React.JSX.Element {
  const text = passive ? COPY.coach.passive(firstPlayer) : `${COPY.coach.step1[device]} ${COPY.coach.step2[device]}`;
  return (
    <aside className={`coach coach-${variant}${faded ? ' coach-faded' : ''}`} role="note" aria-hidden={faded}>
      {!passive && <Pictogram device={device} />}
      <p className="coach-text">{text}</p>
      {variant === 'stage' && onDismiss !== undefined && (
        <button type="button" className="btn btn-paper btn-small" onClick={onDismiss}>
          {COPY.coach.gotIt}
        </button>
      )}
    </aside>
  );
}
