// OWNER: ui
/**
 * Title screen (UX.md §3.1; VISUAL.md §16; mockup-title.html): the ONLY start screen. Logo with the
 * two-tone team ball as the O, tagline sticker, three coloured mode buttons (accelerators 1/2/3), the
 * World 1 level tray with best medals recomputed from storage via `medalFor`, the online-server pill
 * (non-blocking health fetch, never gates the menu), version pill, mute and settings corners, and the
 * shared-game card when the page was opened from a `?state=` link. Viewport-space DOM over an SVG
 * backdrop in the game's palette (clouds drift unless motion is reduced).
 */
import React, { useEffect, useRef, useState } from 'react';
import { LEVELS } from '../sim/levels/index';
import type { Level, PlayerId } from '../sim/types';
import { medalFor } from '../sim/types';
import { COPY, MECHANIC_COPY, trayVerdict } from './copy';
import { Icon, IconButton, speakerState } from './Hud';
import { MedalDisc } from './LevelResults';
import type { BestTable, UiSettings } from './storage';

export type SharedCard = { kind: 'ok'; holeNumber: number; teamStrokes: number; toPlay: PlayerId } | { kind: 'invalid' };

export type TitleProps = {
  bests: BestTable;
  settings: UiSettings;
  shared: SharedCard | null;
  onlineAvailable: boolean;
  /** HTTP health endpoint derived from the WebSocket URL; null when online is unavailable */
  healthUrl: string | null;
  version: string;
  muted: boolean;
  audioLocked: boolean;
  /** "Level select" from the campaign card lands with the tray focused (UX.md §3.8); otherwise the last-used mode button */
  focusTray: boolean;
  onToggleMute(): void;
  onSolo(levelId: string): void;
  onLocal(levelId: string): void;
  onOnline(): void;
  onOpenSettings(): void;
  onContinueShared(playerCount: 1 | 2): void;
  onDismissShared(): void;
};

type ServerHealth = 'waking' | 'ok' | 'offline';
const HEALTH_TIMEOUT_MS = 5000;

function useServerHealth(url: string | null): ServerHealth | null {
  const [health, setHealth] = useState<ServerHealth | null>(url === null ? null : 'waking');
  useEffect(() => {
    if (url === null) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    fetch(url, { signal: controller.signal, mode: 'cors', cache: 'no-store' })
      .then((r) => setHealth(r.ok ? 'ok' : 'offline'))
      .catch(() => setHealth('offline'))
      .finally(() => window.clearTimeout(timer));
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [url]);
  return health;
}

function defaultSelection(bests: BestTable): string {
  const firstUnplayed = LEVELS.find((l) => bests[l.id] === undefined);
  return (firstUnplayed ?? LEVELS[0])?.id ?? '';
}

function Backdrop(): React.JSX.Element {
  return (
    <svg className="title-backdrop" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--sky1)" />
          <stop offset="1" stopColor="var(--sky2)" />
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#sky)" />
      <circle cx="1110" cy="150" r="72" fill="rgba(255,255,255,.28)" />
      <circle cx="1110" cy="150" r="52" fill="var(--sun)" stroke="var(--ink)" strokeWidth="4" />
      <g className="clouds" fill="#fff" stroke="var(--cloud-ink)" strokeWidth="4" strokeLinejoin="round">
        <g transform="translate(150 150) scale(1.1)">
          <circle r="30" /> <circle cx="28" cy="-10" r="24" /> <circle cx="52" cy="2" r="22" /> <circle cx="-26" cy="6" r="20" />
        </g>
        <g transform="translate(1000 290) scale(.75)">
          <circle r="30" /> <circle cx="28" cy="-10" r="24" /> <circle cx="52" cy="2" r="22" /> <circle cx="-26" cy="6" r="20" />
        </g>
        <g transform="translate(300 330) scale(.65)">
          <circle r="30" /> <circle cx="28" cy="-10" r="24" /> <circle cx="52" cy="2" r="22" /> <circle cx="-26" cy="6" r="20" />
        </g>
      </g>
      <path d="M0 600 L0 520 Q120 470 260 500 T560 490 T860 480 T1140 470 T1280 450 L1280 640 L0 640Z" fill="var(--hill-far)" />
      <path d="M0 640 L0 570 Q90 530 200 555 T470 550 T760 548 T1060 542 T1280 530 L1280 660 L0 660Z" fill="var(--hill-mid)" stroke="var(--hill-mid-ink)" strokeWidth="3" />
      <g fill="var(--tree)" stroke="var(--hill-mid-ink)" strokeWidth="3">
        <path d="M150 550v14M612 530v14M905 524v14M1210 528v14" strokeWidth="4" />
        <circle cx="150" cy="536" r="14" /> <circle cx="612" cy="518" r="12" /> <circle cx="905" cy="509" r="15" /> <circle cx="1210" cy="516" r="12" />
      </g>
      <rect x="-20" y="600" width="1320" height="140" fill="var(--dirt)" stroke="var(--ink)" strokeWidth="4" />
      <rect x="-20" y="600" width="1320" height="24" fill="var(--grass)" stroke="var(--ink)" strokeWidth="4" />
      <rect x="-20" y="615" width="1320" height="9" fill="var(--grass-sh)" />
      <g className="golfer red" transform="translate(72 600)">
        <ellipse cy="2" rx="22" ry="6" fill="var(--shadow)" />
        <rect x="-9" y="-20" width="10" height="18" rx="4" fill="var(--skin)" stroke="var(--ink)" strokeWidth="3" />
        <rect x="3" y="-20" width="10" height="18" rx="4" fill="var(--skin)" stroke="var(--ink)" strokeWidth="3" />
        <rect x="-16" y="-32" width="32" height="16" rx="6" fill="var(--shorts)" stroke="var(--ink)" strokeWidth="4" />
        <rect x="-19" y="-58" width="38" height="30" rx="10" fill="var(--p1)" stroke="var(--ink)" strokeWidth="4" />
        <circle cy="-76" r="19" fill="var(--skin)" stroke="var(--ink)" strokeWidth="4" />
        <path d="M-19 -78 A19 19 0 0 1 19 -78 Z" fill="var(--p1)" stroke="var(--ink)" strokeWidth="4" />
        <rect x="6" y="-86" width="26" height="9" rx="4" fill="var(--p1)" stroke="var(--ink)" strokeWidth="3" />
        <circle cx="5" cy="-73" r="2.8" fill="var(--ink)" /> <circle cx="13" cy="-73" r="2.8" fill="var(--ink)" />
        <path d="M3 -69 A6 6 0 0 0 15 -69 Z" fill="#fff" stroke="var(--ink)" strokeWidth="2.5" />
        <path className="wave-arm" d="M12 -52 L30 -96" stroke="var(--ink)" strokeWidth="14" strokeLinecap="round" />
        <path className="wave-arm" d="M12 -52 L30 -96" stroke="var(--p1)" strokeWidth="8" strokeLinecap="round" />
        <circle className="wave-arm" cx="30" cy="-96" r="6.5" fill="#fff" stroke="var(--ink)" strokeWidth="3" />
      </g>
      <circle cx="120" cy="588" r="12" fill="var(--p1)" stroke="var(--ink)" strokeWidth="4" />
      <g className="golfer blue" transform="translate(1158 600)">
        <ellipse cy="2" rx="22" ry="6" fill="var(--shadow)" />
        <rect x="-9" y="-20" width="10" height="18" rx="4" fill="var(--skin)" stroke="var(--ink)" strokeWidth="3" />
        <rect x="3" y="-20" width="10" height="18" rx="4" fill="var(--skin)" stroke="var(--ink)" strokeWidth="3" />
        <rect x="-16" y="-32" width="32" height="16" rx="6" fill="var(--shorts)" stroke="var(--ink)" strokeWidth="4" />
        <rect x="-19" y="-58" width="38" height="30" rx="10" fill="var(--p2)" stroke="var(--ink)" strokeWidth="4" />
        <circle cy="-76" r="19" fill="var(--skin)" stroke="var(--ink)" strokeWidth="4" />
        <path d="M-19 -78 A19 19 0 0 1 19 -78 Z" fill="var(--p2)" stroke="var(--ink)" strokeWidth="4" />
        <rect x="6" y="-86" width="26" height="9" rx="4" fill="var(--p2)" stroke="var(--ink)" strokeWidth="3" />
        <circle cx="5" cy="-73" r="2.8" fill="var(--ink)" /> <circle cx="13" cy="-73" r="2.8" fill="var(--ink)" />
        <path d="M5 -68 A4.5 4.5 0 0 0 13 -68" fill="none" stroke="var(--ink)" strokeWidth="2.5" />
        <path d="M12 -52 L18 -30" stroke="var(--ink)" strokeWidth="14" strokeLinecap="round" />
        <path d="M12 -52 L18 -30" stroke="var(--p2)" strokeWidth="8" strokeLinecap="round" />
        <path d="M18 -30 L30 -1" stroke="var(--ink)" strokeWidth="7" strokeLinecap="round" />
        <path d="M18 -30 L30 -1" stroke="var(--coil)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="18" cy="-30" r="6.5" fill="#fff" stroke="var(--ink)" strokeWidth="3" />
      </g>
      <circle cx="1198" cy="588" r="12" fill="var(--p2)" stroke="var(--ink)" strokeWidth="4" />
      <ellipse cx="1236" cy="600" rx="17" ry="6" fill="var(--ink)" />
      <rect x="1233" y="524" width="6" height="78" rx="3" fill="#fff" stroke="var(--ink)" strokeWidth="3" />
      <rect x="1239" y="520" width="34" height="24" rx="4" fill="#fff" stroke="var(--ink)" strokeWidth="3" />
      <path d="M1239 520h8.5v8h-8.5zM1256 520h8.5v8h-8.5zM1247.5 528h8.5v8h-8.5zM1264.5 528h8.5v8h-8.5zM1239 536h8.5v8h-8.5zM1256 536h8.5v8h-8.5z" fill="var(--ink)" />
    </svg>
  );
}

function LevelTile({ level, best, selected, onSelect, onActivate }: { level: Level; best: BestTable[string] | undefined; selected: boolean; onSelect(): void; onActivate(): void }): React.JSX.Element {
  const medal = best === undefined ? 'none' : medalFor(best.teamStrokes, level.par);
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      className={`tile${selected ? ' cur' : ''}`}
      onClick={onSelect}
      onDoubleClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }}
      aria-label={`${COPY.title.levelSelect}: ${level.order}. ${level.name}, ${COPY.title.par(level.par)}, ${best === undefined ? COPY.title.notPlayed : `${COPY.title.team(best.teamStrokes)}, ${trayVerdict(best.teamStrokes, level.par)}`}`}
    >
      <span className="num" aria-hidden="true">
        {level.order}
      </span>
      {selected && <span className="ribbon">{COPY.title.startHere}</span>}
      <span className="name">{level.name}</span>
      <span className="par">{COPY.title.par(level.par)}</span>
      <div className="row">
        <span title={COPY.title.medalTooltip}>
          <MedalDisc medal={medal} size={42} />
        </span>
        <span className="best">
          {best === undefined ? '—' : COPY.title.team(best.teamStrokes)}
          <small>{best === undefined ? COPY.title.notPlayed : trayVerdict(best.teamStrokes, level.par)}</small>
        </span>
        <span className="teach">{COPY.title.teach(MECHANIC_COPY[level.mechanicsIntroduced[0]].name)}</span>
      </div>
    </div>
  );
}

export default function Title(props: TitleProps): React.JSX.Element {
  const { bests, settings, shared, onlineAvailable, healthUrl, version, muted, audioLocked, focusTray, onToggleMute, onSolo, onLocal, onOnline, onOpenSettings, onContinueShared, onDismissShared } = props;
  const [selected, setSelected] = useState(() => defaultSelection(bests));
  const health = useServerHealth(onlineAvailable ? healthUrl : null);
  const defaultButton = useRef<HTMLButtonElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const [announced, setAnnounced] = useState('');
  const speaker = speakerState(audioLocked, muted);

  useEffect(() => {
    const tile = trayRef.current?.querySelector<HTMLElement>('.tile.cur') ?? null;
    if (focusTray && tile !== null) tile.focus();
    else defaultButton.current?.focus({ preventScroll: true });
    const t = window.setTimeout(() => setAnnounced(COPY.title.a11y), 0);
    return () => window.clearTimeout(t);
  }, [focusTray]);

  // Accelerators 1/2/3; silent while any modal (Settings, its reset confirm) is open above the title.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[aria-modal="true"]') !== null) return;
      if (e.key === '1') onSolo(selected);
      else if (e.key === '2') onLocal(selected);
      else if (e.key === '3' && onlineAvailable) onOnline();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, onlineAvailable, onSolo, onLocal, onOnline]);

  const moveSelection = (delta: number): void => {
    const index = LEVELS.findIndex((l) => l.id === selected);
    const next = LEVELS[(index + delta + LEVELS.length) % LEVELS.length];
    if (next !== undefined) {
      setSelected(next.id);
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>('.tile.cur')?.focus());
    }
  };

  return (
    <main className="screen title">
      <Backdrop />
      <div className={`title-ui${shared === null ? '' : ' with-shared'}`}>
        <h1 className="logo" aria-label={COPY.app.name}>
          <span className="line flash">{COPY.title.flash}</span>
          <span className="line golf">
            {COPY.title.golf[0]}
            <span className="o" aria-hidden="true" />
            {COPY.title.golf[1]}
          </span>
        </h1>
        <p className="tag-sticker">{COPY.title.tagline}</p>

        {shared !== null && (
          <section className="shared-card" aria-label="Shared game">
            {shared.kind === 'ok' ? (
              <>
                <span className="shared-text">{COPY.shared.title(shared.holeNumber, shared.teamStrokes, shared.toPlay)}</span>
                <div className="button-row">
                  <button type="button" className="btn btn-primary btn-small" onClick={() => onContinueShared(1)}>
                    {COPY.shared.continueSolo}
                  </button>
                  <button type="button" className="btn btn-paper btn-small" onClick={() => onContinueShared(2)}>
                    {COPY.shared.continue2p}
                  </button>
                </div>
              </>
            ) : (
              <span className="shared-text" role="alert">
                {COPY.shared.broken}
              </span>
            )}
            <IconButton icon="close" label={COPY.shared.dismiss} onClick={onDismissShared} size={44} sfx="back" />
          </section>
        )}

        <nav className="menu" aria-label="Play">
          <button type="button" ref={settings.lastMode === 'solo' ? defaultButton : undefined} className="mode-btn solo" onClick={() => onSolo(selected)}>
            <span className="ico" aria-hidden="true">
              <span className="ball ball-p1" />
            </span>
            {COPY.title.solo}
            <span className="sub">{COPY.title.soloSub}</span>
          </button>
          <button type="button" ref={settings.lastMode === 'local' ? defaultButton : undefined} className="mode-btn local" onClick={() => onLocal(selected)}>
            <span className="ico" aria-hidden="true">
              <span className="ball ball-p1" />
              <span className="ball ball-p2" />
            </span>
            {COPY.title.local}
            <span className="sub">{COPY.title.localSub}</span>
          </button>
          <button type="button" ref={settings.lastMode === 'online' ? defaultButton : undefined} className="mode-btn online" onClick={onOnline} disabled={!onlineAvailable}>
            <span className="ico" aria-hidden="true">
              <Icon name="link" size={30} />
            </span>
            {COPY.title.online}
            <span className="sub">{onlineAvailable ? COPY.title.onlineSub : COPY.title.onlineUnavailable}</span>
          </button>
        </nav>

        <section className="tray" aria-label={COPY.title.levelSelect}>
          <div className="head">
            <span className="badge">{COPY.title.world}</span>
            <span>{COPY.title.worldSub(LEVELS.length)}</span>
            <span className="legend">{COPY.title.medalLegend}</span>
          </div>
          <div
            ref={trayRef}
            className="levels"
            role="radiogroup"
            aria-label={COPY.title.levelSelect}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                moveSelection(1);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                moveSelection(-1);
              }
            }}
          >
            {LEVELS.map((level) => (
              <LevelTile key={level.id} level={level} best={bests[level.id]} selected={selected === level.id} onSelect={() => setSelected(level.id)} onActivate={() => onSolo(level.id)} />
            ))}
          </div>
        </section>

        {health !== null && (
          <div className={`server-pill server-${health}`} aria-live="polite">
            <i aria-hidden="true" />
            {health === 'ok' ? COPY.title.serverOk : health === 'waking' ? COPY.title.serverWaking : COPY.title.serverOffline}
          </div>
        )}
        <div className="title-corners">
          <div className="corner-left">
            <span className="version-pill">
              {COPY.app.name.toUpperCase()} {COPY.app.version(version)} · {COPY.app.footer}
            </span>
          </div>
          <div className="corner-right">
            <IconButton icon={speaker.icon} label={speaker.label} onClick={onToggleMute} pressed={speaker.pressed} size={44} />
            <IconButton icon="gear" label={COPY.title.settings} onClick={onOpenSettings} size={44} />
          </div>
        </div>
        <div className="sr-only" aria-live="polite">
          {announced}
        </div>
      </div>
    </main>
  );
}
