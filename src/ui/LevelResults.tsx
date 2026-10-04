// OWNER: ui
/**
 * Level results card (UX.md §3.7; VISUAL.md §15): team strokes vs par, verdict in the medal colour,
 * medal disc, per-player strokes as two identical inactive chips (fixed order Red then Blue, never
 * sorted by score), best line, Next / Retry / Quit. Shown while phase === 'levelResults' after Callouts' 1.2 s
 * HOLE COMPLETE! banner. Also exports `MedalDisc` (VISUAL.md §15: split red/blue ribbon = "team").
 */
import React, { useEffect, useState } from 'react';
import type { Level, LevelResult, Medal, PlayerId, SimMode } from '../sim/types';
import { COPY, flavour, nameOf, otherPlayer, verdict } from './copy';
import { Modal } from './Pause';
import { Icon } from './Hud';
import type { LevelBest } from './storage';

export type MedalSize = 20 | 28 | 42 | 96;

export function MedalDisc({ medal, size, pop = false }: { medal: Medal; size: MedalSize; pop?: boolean }): React.JSX.Element {
  return (
    <span className={`medal medal-${medal} medal-${size}${pop ? ' medal-pop' : ''}`} role="img" aria-label={COPY.results.medal[medal]}>
      {medal === 'none' ? <span className="medal-q">?</span> : <Icon name="star" size={size >= 96 ? 44 : size >= 42 ? 20 : size >= 28 ? 14 : 10} />}
    </span>
  );
}

export type LevelResultsProps = {
  level: Level;
  holeNumber: number;
  result: LevelResult;
  /** best BEFORE this result (null when the hole had never been finished) */
  previousBest: LevelBest | null;
  mode: SimMode;
  seat: PlayerId | null;
  isHost: boolean;
  isLast: boolean;
  onNext(): void;
  onRetry(): void;
  onQuit(): void;
};

const MEDAL_POP_DELAY_MS = 300;
const PLAYERS: readonly PlayerId[] = [0, 1];

export default function LevelResults(props: LevelResultsProps): React.JSX.Element {
  const { level, holeNumber, result, previousBest, mode, seat, isHost, isLast, onNext, onRetry, onQuit } = props;
  const team = result.strokes[0] + result.strokes[1];
  const isNewBest = previousBest === null || team < previousBest.teamStrokes;
  const [medalShown, setMedalShown] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setMedalShown(true), MEDAL_POP_DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);
  const online = mode === 'online';
  const toneClass = result.medal === 'gold' ? 'verdict-good' : result.medal === 'silver' ? 'verdict-even' : 'verdict-over';

  return (
    <Modal labelledBy="results-title" size="wide" scrim="light" className="results-card">
      <p className="eyebrow">{COPY.results.hole(holeNumber)}</p>
      <div className="results-main">
        <div className="results-medal">{medalShown && <MedalDisc medal={result.medal} size={96} pop />}</div>
        <div className="results-text">
          <h2 id="results-title" className="results-headline">
            <span className="results-team-label">{COPY.results.team}</span> <span className="results-team-number">{team}</span>
            <span className="results-par">{COPY.results.par(result.par)}</span>
          </h2>
          <p className={`verdict ${toneClass}`}>{verdict(team, result.par)}</p>
          <p className="flavour">{flavour(team, result.par)}</p>
          <p className="medal-word">
            {COPY.results.medal[result.medal]}
            {result.medal === 'none' && <span className="caption"> · {COPY.results.medalNoneSub}</span>}
          </p>
        </div>
      </div>
      <ul className="player-row" aria-label="Strokes per player">
        {PLAYERS.map((p) => (
          <li key={p} className={`chip-static chip-p${p + 1}`}>
            <span className={`ball-dot ball-p${p + 1}`} aria-hidden="true" />
            <span>
              {nameOf(p)} {result.strokes[p]}
              {online && seat === p && <span className="caption"> {COPY.results.you}</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="best-line">
        {isNewBest ? <span className="sticker sticker-new">{COPY.results.newBest}</span> : COPY.results.best(previousBest.teamStrokes, previousBest.medal)}
      </p>
      <div className="button-row card-actions">
        <button type="button" className="btn btn-primary btn-wide" onClick={onNext} data-autofocus>
          {isLast ? COPY.results.seeResults : COPY.results.next}
        </button>
        <div className="stack-tight">
          <button type="button" className="btn btn-paper" onClick={onRetry} disabled={!isHost}>
            {COPY.results.retry}
          </button>
          {!isHost && <span className="caption">{COPY.results.retryAsk(seat === null ? 0 : otherPlayer(seat))}</span>}
        </div>
        <button type="button" className="btn btn-ghost" onClick={onQuit} data-sfx="back">
          {online ? COPY.results.leave : COPY.results.quit}
        </button>
      </div>
      <p className="sr-only">{`${COPY.results.hole(holeNumber)}. ${level.name}. Team ${team}, par ${result.par}, ${verdict(team, result.par).toLowerCase()}, ${COPY.results.medal[result.medal].toLowerCase()}.`}</p>
    </Modal>
  );
}
