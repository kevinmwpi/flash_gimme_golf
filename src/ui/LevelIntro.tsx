// OWNER: ui
/**
 * Level intro card (UX.md §3.4; VISUAL.md §15; BUILD_DECISIONS D10.1): the world title and "HOLE n OF 12"
 * (global hole numbers), name, par, the NEW mechanic row (only on a hole that introduces one), hint, who
 * goes first, Tee off. Shown while FrameSummary.phase === 'intro' over the overview camera. It never
 * auto-advances (BUILD_DECISIONS D6): either player continues and the first press counts. Tapping
 * the scrim also continues.
 */
import React from 'react';
import { worldTitle } from '../sim/levels/index';
import type { Level, PlayerId, SimMode } from '../sim/types';
import type { InputDevice } from '../view/view';
import { COPY, MECHANIC_COPY, nameOf } from './copy';
import OnboardingHint from './OnboardingHint';
import { Modal } from './Pause';

export type LevelIntroProps = {
  level: Level;
  holeNumber: number;
  holeCount: number;
  firstPlayer: PlayerId;
  mode: SimMode;
  seat: PlayerId | null;
  device: InputDevice;
  /** a player who was never onboarded, on hole 1 or the first hole of the session: the onboarding strip shows */
  onboarding: boolean;
  onContinue(): void;
};

function firstLine(mode: SimMode, seat: PlayerId | null, first: PlayerId): React.ReactNode {
  if (mode === 'solo') return COPY.intro.firstSolo(first);
  if (mode === 'local') return COPY.intro.firstLocal(first);
  return seat === first ? COPY.intro.firstYou : COPY.intro.firstPartner(first);
}

function orLine(device: InputDevice): string {
  if (device === 'gamepad') return COPY.intro.orA;
  if (device === 'keyboard') return COPY.intro.orSpace;
  return COPY.intro.orTap;
}

export default function LevelIntro(props: LevelIntroProps): React.JSX.Element {
  const { level, holeNumber, holeCount, firstPlayer, mode, seat, device, onboarding, onContinue } = props;
  const introduced = level.mechanicsIntroduced[0];
  const teach = introduced === undefined ? null : MECHANIC_COPY[introduced];
  const passive = mode === 'online' && seat !== firstPlayer;
  const where = `${worldTitle(level.world)} · ${COPY.intro.hole(holeNumber, holeCount)}`;

  return (
    <Modal labelledBy="intro-title" onScrimClick={onContinue} size="default" scrim="light" className="intro-card">
      <p className="eyebrow">{where}</p>
      <h2 id="intro-title" className="card-title display-l">
        {level.name}
      </h2>
      <span className="sun-pill">{COPY.intro.par(level.par)}</span>
      {teach !== null && (
        <div className="teach-row">
          <span className="teach-tag">{COPY.intro.teach(teach.name)}</span>
          <span className="teach-blurb">{teach.blurb}</span>
        </div>
      )}
      <p className="hint-text">{level.hint}</p>
      <p className={`first-line first-p${firstPlayer + 1}`}>
        <span className={`ball-dot ball-p${firstPlayer + 1}`} aria-hidden="true" />
        {firstLine(mode, seat, firstPlayer)}
      </p>
      {onboarding && <OnboardingHint device={device} variant="card" passive={passive} firstPlayer={firstPlayer} />}
      <div className="stack-tight card-actions">
        <button type="button" className="btn btn-primary btn-wide" onClick={onContinue} data-autofocus>
          {COPY.intro.teeOff}
        </button>
        <span className="caption">{orLine(device)}</span>
      </div>
      <p className="sr-only">{`${where}, ${level.name}. ${COPY.intro.par(level.par)}. ${nameOf(firstPlayer)} goes first.`}</p>
    </Modal>
  );
}
