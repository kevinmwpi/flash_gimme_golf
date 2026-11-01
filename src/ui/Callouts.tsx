// OWNER: ui
/**
 * Turn banner + toasts (BUILD_DECISIONS D3 VISUAL 1-5): ONLY the banner ("RED'S TURN" / "YOUR TURN",
 * plus the paper stage announcements HOLE COMPLETE! / HOLE RESTARTED / OUT OF BOUNDS) and the ink
 * toasts ("Blue teed off", "Red restarted the hole", "Blue is here!", "Red left", the holder tip).
 * World-anchored callouts (GIMME!, IN THE HOLE!, BONK! …) are canvas text owned by VIEW. Lives in
 * stage space (App wraps it in the scaled stage layer). One polite live region announces banners
 * and toasts for screen readers (UX.md §6). An info banner holds for its full duration: a turn banner
 * that arrives while it shows (restartLevel emits levelRestart + turnStart in one step) is queued
 * behind it instead of replacing it (UX.md §3.6 "HOLE RESTARTED then the turn banner"). Every turn the
 * WAITING rule hands over (`turnSkipped`, emitted in the same tick as and just before its `turnStart`)
 * shows its banner with "Red is caught — Blue shoots again" under the main line (D10.10).
 */
import React, { useEffect, useRef, useState } from 'react';
import type { PlayerId, SimMode } from '../sim/types';
import { COPY, turnBannerLines, type TurnSkip } from './copy';
import type { EventBus } from './eventBus';

/** `ms` overrides TOAST_MS for one toast (the holder tip). */
export type Toast = { id: number; text: string; tone?: 'info' | 'good' | 'bad'; ms?: number };

export type CalloutsProps = {
  bus: EventBus;
  /** seats this browser controls */
  seats: readonly PlayerId[];
  mode: SimMode;
  /** toasts raised by App (network status, copy results) — merged with the sim-derived ones */
  toasts: readonly Toast[];
  onToastDone(id: number): void;
};

/** `say` is what the live region reads (a skipped turn adds its whole sentence to the main line). */
type BannerBody = { kind: 'player'; player: PlayerId; text: string; sub: string | null; say: string } | { kind: 'info'; text: string; tone: 'paper' | 'warn' };
type Banner = BannerBody & { nonce: number };

const TURN_BANNER_MS = 1400;
/** Also the hold before the results card mounts (App), so HOLE COMPLETE! finishes before the card. */
export const INFO_BANNER_MS = 1200;
const TOAST_MS = 2500;
const MAX_TOASTS = 2;

export default function Callouts({ bus, seats, mode, toasts, onToastDone }: CalloutsProps): React.JSX.Element {
  const [banner, setBanner] = useState<Banner | null>(null);
  const [simToasts, setSimToasts] = useState<Toast[]>([]);
  const nonce = useRef(0);
  const toastId = useRef(-1);

  useEffect(() => {
    let timer = 0;
    let queued = 0;
    /** performance.now() until which the current info banner must stay up */
    let infoUntil = 0;
    const show = (b: BannerBody, ms: number): void => {
      nonce.current += 1;
      setBanner({ ...b, nonce: nonce.current });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setBanner(null), ms);
    };
    const showInfo = (text: string, tone: 'paper' | 'warn'): void => {
      infoUntil = performance.now() + INFO_BANNER_MS;
      show({ kind: 'info', text, tone }, INFO_BANNER_MS);
    };
    const showTurn = (b: BannerBody): void => {
      const wait = infoUntil - performance.now();
      window.clearTimeout(queued);
      if (wait <= 0) show(b, TURN_BANNER_MS);
      else queued = window.setTimeout(() => show(b, TURN_BANNER_MS), wait);
    };
    const toast = (text: string): void => {
      toastId.current -= 1;
      const id = toastId.current;
      setSimToasts((list) => [...list.slice(-(MAX_TOASTS - 1)), { id, text }]);
      window.setTimeout(() => setSimToasts((list) => list.filter((t) => t.id !== id)), TOAST_MS);
    };
    /** The ball the WAITING rule passed over, kept until the turnStart of the same tick it explains. */
    let skipped: (TurnSkip & { tick: number; nextPlayer: PlayerId }) | null = null;
    const unsubscribe = bus.subscribe((e) => {
      switch (e.type) {
        case 'turnSkipped':
          skipped = { playerId: e.playerId, reason: e.reason, tick: e.tick, nextPlayer: e.nextPlayer };
          break;
        case 'turnStart': {
          const skip = skipped !== null && skipped.tick === e.tick && skipped.nextPlayer === e.playerId ? skipped : null;
          skipped = null;
          showTurn({ kind: 'player', player: e.playerId, ...turnBannerLines(e.playerId, skip, seats, mode) });
          break;
        }
        case 'levelComplete':
          showInfo(COPY.banner.holeComplete, 'paper');
          break;
        case 'levelRestart':
          showInfo(COPY.banner.restarted, 'paper');
          if (mode === 'online' && !seats.includes(e.byPlayer)) toast(COPY.toast.restarted(e.byPlayer));
          break;
        case 'fellOffWorld':
          showInfo(COPY.banner.oob, 'warn');
          break;
        default:
          break;
      }
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
      window.clearTimeout(queued);
    };
  }, [bus, seats, mode]);

  // Every App toast gets its own lifetime; a newer toast never extends an older one.
  const timed = useRef(new Map<number, number>());
  useEffect(() => {
    const timers = timed.current;
    for (const t of toasts) {
      if (timers.has(t.id)) continue;
      timers.set(
        t.id,
        window.setTimeout(() => {
          timers.delete(t.id);
          onToastDone(t.id);
        }, t.ms ?? TOAST_MS),
      );
    }
  }, [toasts, onToastDone]);
  useEffect(() => {
    const timers = timed.current;
    return () => {
      for (const id of timers.values()) window.clearTimeout(id);
      timers.clear();
    };
  }, []);

  const visible = [...simToasts, ...toasts].slice(-MAX_TOASTS);
  const newestToast = visible[visible.length - 1];

  return (
    <>
      {banner !== null && (
        <div
          key={banner.nonce}
          className={`banner ${banner.kind === 'player' ? `banner-p${banner.player + 1}` : `banner-${banner.tone}`}`}
          aria-hidden="true"
        >
          <span className="banner-text">{banner.text}</span>
          {banner.kind === 'player' && banner.sub !== null && <small>{banner.sub}</small>}
        </div>
      )}
      <div className="toasts" aria-hidden="true">
        {visible.map((t) => (
          <div key={t.id} className={`toast${t.tone === undefined ? '' : ` toast-${t.tone}`}`}>
            {t.text}
          </div>
        ))}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {banner === null ? '' : banner.kind === 'player' ? banner.say : banner.text}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {newestToast?.text ?? ''}
      </div>
    </>
  );
}
