// OWNER: ui
/**
 * Campaign results (UX.md §3.8; VISUAL.md §15): course total vs course par, five-column scorecard
 * (Hole · Par · Team · ± · Medal) with a TOTAL row, per-player totals in grey, PERFECT ROUND ribbon when
 * every hole is gold, DOM confetti (none under reduced motion), Play again / Level select / Title.
 * Shown while phase === 'campaignResults'. Online: the host sends playAgain; the guest waits.
 */
import React from 'react';
import type { Level, LevelResult, Medal, PlayerId, SimMode } from '../sim/types';
import { COPY, golfDelta, otherPlayer } from './copy';
import { MedalDisc } from './LevelResults';
import { Modal } from './Pause';

export type CampaignRow = { level: Level; result: LevelResult };

export type CampaignResultsProps = {
  rows: readonly CampaignRow[];
  coursePar: number;
  total: number;
  medal: Medal;
  mode: SimMode;
  seat: PlayerId | null;
  isHost: boolean;
  /** online guest: the host has not pressed Play again yet */
  waitingForHost: boolean;
  onPlayAgain(): void;
  onLevelSelect(): void;
  onTitle(): void;
};

const CONFETTI_COUNT = 30;
const CONFETTI_COLOURS = ['var(--p1)', 'var(--p2)', 'var(--sun)'] as const;

function courseVerdict(total: number, par: number): string {
  const d = total - par;
  if (d < 0) return COPY.campaign.under(-d);
  if (d === 0) return COPY.campaign.even;
  return COPY.campaign.over(d);
}

function Confetti(): React.JSX.Element {
  const pieces = Array.from({ length: CONFETTI_COUNT }, (_, i) => i);
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((i) => (
        <i
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            background: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
            animationDelay: `${(i % 10) * 0.12}s`,
            transform: `rotate(${(i * 53) % 360}deg)`,
          }}
        />
      ))}
    </div>
  );
}

export default function CampaignResults(props: CampaignResultsProps): React.JSX.Element {
  const { rows, coursePar, total, medal, mode, seat, isHost, waitingForHost, onPlayAgain, onLevelSelect, onTitle } = props;
  const counts = rows.reduce(
    (acc, r) => {
      acc[r.result.medal] += 1;
      return acc;
    },
    { gold: 0, silver: 0, bronze: 0, none: 0 } as Record<Medal, number>,
  );
  const perfect = rows.length > 0 && counts.gold === rows.length;
  const red = rows.reduce((n, r) => n + r.result.strokes[0], 0);
  const blue = rows.reduce((n, r) => n + r.result.strokes[1], 0);
  const online = mode === 'online';
  const host: PlayerId = seat === null ? 0 : seat === 0 ? 0 : otherPlayer(seat);

  return (
    <>
      <Confetti />
      <Modal labelledBy="campaign-title" size="xwide" scrim="light" className="campaign-card">
        <div className="campaign-head">
          <div className="campaign-headline">
            <p className="eyebrow">{COPY.campaign.title}</p>
            {perfect && <span className="sticker sticker-perfect">{COPY.campaign.perfect}</span>}
            <h2 id="campaign-title" className="card-title display-l">
              {COPY.campaign.team(total, coursePar)}
            </h2>
            <p className={`verdict ${medal === 'gold' ? 'verdict-good' : medal === 'silver' ? 'verdict-even' : 'verdict-over'}`}>{courseVerdict(total, coursePar)}</p>
          </div>
          <div className="campaign-medal">
            <MedalDisc medal={medal} size={96} pop />
          </div>
        </div>
        <table className="scorecard">
          <thead>
            <tr>
              {COPY.campaign.cols.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ level, result }) => {
              const team = result.strokes[0] + result.strokes[1];
              return (
                <tr key={level.id}>
                  <th scope="row">
                    <span className="num-badge">{level.order}</span> {level.name}
                  </th>
                  <td>{result.par}</td>
                  <td className="strong">{team}</td>
                  <td className={team < result.par ? 'delta-good' : team === result.par ? 'delta-even' : 'delta-over'}>{golfDelta(team, result.par)}</td>
                  <td>
                    <MedalDisc medal={result.medal} size={28} />
                  </td>
                </tr>
              );
            })}
            <tr className="total-row">
              <th scope="row">{COPY.campaign.total}</th>
              <td>{coursePar}</td>
              <td className="strong">{total}</td>
              <td className={total < coursePar ? 'delta-good' : total === coursePar ? 'delta-even' : 'delta-over'}>{golfDelta(total, coursePar)}</td>
              <td>
                <MedalDisc medal={medal} size={28} />
              </td>
            </tr>
          </tbody>
        </table>
        <p className="caption">
          {COPY.campaign.summary(counts.gold, counts.silver, counts.bronze)} · {COPY.campaign.players(red, blue)}
        </p>
        <div className="button-row card-actions">
          {online && !isHost ? (
            waitingForHost ? (
              <span className="body muted-text">{COPY.toast.waitingNewRound(host)}</span>
            ) : null
          ) : (
            <button type="button" className="btn btn-primary btn-wide" onClick={onPlayAgain} data-autofocus>
              {COPY.campaign.playAgain}
            </button>
          )}
          <button type="button" className="btn btn-paper" onClick={onLevelSelect}>
            {COPY.campaign.levelSelect}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onTitle} data-sfx="back">
            {COPY.campaign.title2}
          </button>
        </div>
      </Modal>
    </>
  );
}
