// OWNER: ui
/**
 * Pause menu (UX.md §3.6) plus the two modal primitives every card shares: `Modal` (viewport-space
 * scrim + paper card, focus trap, Esc, focus restore, scroll cue on short viewports) and `ConfirmDialog`. Local/solo: the loop stops
 * stepping; online: the sim keeps running and the header says so. Restart is host-only online and
 * announced to the guest by the sim's `levelRestart` event (Callouts toasts it).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerId, SimMode } from '../sim/types';
import type { InputDevice } from '../view/view';
import { COPY, otherPlayer } from './copy';

// ---------------------------------------------------------------------------------------------
// Modal primitive
// ---------------------------------------------------------------------------------------------

export type ModalProps = {
  /** id of the heading element inside the card */
  labelledBy: string;
  /** Esc / gamepad B */
  onClose?: (() => void) | undefined;
  /** tap on the scrim (LevelIntro continues; Pause resumes) */
  onScrimClick?: (() => void) | undefined;
  /** card width preset */
  size?: 'narrow' | 'default' | 'wide' | 'xwide';
  /** 'light' = 35 % scrim over the live world; 'none' for full-viewport screens */
  scrim?: 'light' | 'dark' | 'none';
  role?: 'dialog' | 'alertdialog';
  className?: string;
  children: React.ReactNode;
};

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/**
 * Where focus goes when a card closes (UX.md §3.6: "restored to the canvas on close"). A card opened
 * from a HUD button hands focus to the stage canvas so Space/Enter shoot again instead of re-firing
 * that button; a card opened from inside another card (ConfirmDialog over Pause) returns to it.
 */
export function restoreTarget(previous: HTMLElement | null): HTMLElement | null {
  if (previous === null || !document.contains(previous)) return null;
  if (previous.closest('.hud') === null) return previous;
  return document.querySelector<HTMLElement>('.stage-canvas') ?? null;
}

const SCROLL_CUE_SLACK_PX = 4;

/**
 * Short viewports scroll the card under its sticky action row (UX.md §13). `data-scroll="more"` while
 * content is still hidden below the fold drives the chevron cue on the action row.
 */
function useScrollCue(cardRef: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const card = cardRef.current;
    if (card === null) return;
    const update = (): void => {
      card.dataset['scroll'] = card.scrollHeight - card.clientHeight - card.scrollTop > SCROLL_CUE_SLACK_PX ? 'more' : 'end';
    };
    update();
    card.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(card);
    for (const child of Array.from(card.children)) observer?.observe(child);
    return () => {
      card.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [cardRef]);
}

export function Modal({ labelledBy, onClose, onScrimClick, size = 'default', scrim = 'light', role = 'dialog', className, children }: ModalProps): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null);
  useScrollCue(cardRef);

  useEffect(() => {
    const card = cardRef.current;
    if (card === null) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const preferred = card.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(card)[0] ?? card;
    // No preventScroll: on short viewports the card scrolls so the primary action is in view (UX.md §13).
    preferred.focus();
    return () => {
      const target = restoreTarget(previous);
      if (target !== null) target.focus({ preventScroll: true });
    };
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape' && onClose !== undefined) {
        e.stopPropagation();
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || cardRef.current === null) return;
      const items = focusables(cardRef.current);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return (
    <div
      className={`overlay overlay-${scrim}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && onScrimClick !== undefined) onScrimClick();
      }}
    >
      <div
        ref={cardRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`card card-${size}${className === undefined ? '' : ` ${className}`}`}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------------------------

export type ConfirmDialogProps = {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm(): void;
  onCancel(): void;
};

export function ConfirmDialog({ title, body, confirmLabel, cancelLabel, danger = false, onConfirm, onCancel }: ConfirmDialogProps): React.JSX.Element {
  return (
    <Modal labelledBy="confirm-title" onClose={onCancel} size="narrow" scrim="dark" role="alertdialog">
      <h2 id="confirm-title" className="card-title">
        {title}
      </h2>
      <p className="body">{body}</p>
      <div className="button-row">
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} data-autofocus>
          {confirmLabel}
        </button>
        <button type="button" className="btn btn-paper" onClick={onCancel} data-sfx="back">
          {cancelLabel}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Pause menu
// ---------------------------------------------------------------------------------------------

export type PauseProps = {
  mode: SimMode;
  isHost: boolean;
  /** campaignResults: the round is over, so Restart and the share link are hidden (nothing to restart or resume) */
  roundOver: boolean;
  /** the local seat (online) — names the partner in copy */
  seat: PlayerId | null;
  roomCode?: string | undefined;
  holeNumber: number;
  device: InputDevice;
  /** the level's intro hint, replayable here once the intro card is gone */
  hint: string;
  /** the level's watchOut: shown as the "Stuck?" tip */
  watchOut: string;
  muted: boolean;
  onToggleMute(): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  onOpenSettings(): void;
  /** local modes only; resolves true when the link reached the clipboard */
  onCopyShare?: (() => Promise<boolean>) | undefined;
  /** online only */
  onCopyInvite?: (() => Promise<boolean>) | undefined;
};

type CopyState = 'idle' | 'copied' | 'failed';
const COPIED_MS = 1500;

function useCopyLabel(): [CopyState, (run: () => Promise<boolean>) => void] {
  const [state, setState] = useState<CopyState>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = window.setTimeout(() => setState('idle'), COPIED_MS);
    return () => window.clearTimeout(t);
  }, [state]);
  const run = useCallback((fn: () => Promise<boolean>) => {
    void fn().then((ok) => setState(ok ? 'copied' : 'failed'));
  }, []);
  return [state, run];
}

export default function Pause(props: PauseProps): React.JSX.Element {
  const { mode, isHost, roundOver, seat, roomCode, holeNumber, hint, watchOut, muted, onToggleMute, onResume, onRestart, onQuit, onOpenSettings, onCopyShare, onCopyInvite } = props;
  const online = mode === 'online';
  const partner: PlayerId = seat === null ? 1 : otherPlayer(seat);
  const [confirm, setConfirm] = useState<'restart' | 'quit' | null>(null);
  const [shareState, runShare] = useCopyLabel();
  const [inviteState, runInvite] = useCopyLabel();

  const copyLabel = (state: CopyState, idle: string): string => (state === 'copied' ? COPY.lobby.copied : state === 'failed' ? COPY.toast.copyFailed : idle);

  if (confirm === 'restart') {
    return (
      <ConfirmDialog
        title={COPY.pause.restartTitle(holeNumber)}
        body={online ? `${COPY.pause.restartBody} ${COPY.pause.restartBodyOnline(partner)}` : COPY.pause.restartBody}
        confirmLabel={COPY.pause.restartConfirm}
        cancelLabel={COPY.pause.restartCancel}
        onConfirm={() => {
          setConfirm(null);
          onRestart();
        }}
        onCancel={() => setConfirm(null)}
      />
    );
  }
  if (confirm === 'quit') {
    return (
      <ConfirmDialog
        title={online ? COPY.pause.leaveTitle : COPY.pause.quitTitle}
        body={online ? COPY.pause.leaveBody(partner) : COPY.pause.quitBody}
        confirmLabel={online ? COPY.pause.leaveConfirm : COPY.pause.quitConfirm}
        cancelLabel={COPY.pause.quitCancel}
        danger
        onConfirm={() => {
          setConfirm(null);
          onQuit();
        }}
        onCancel={() => setConfirm(null)}
      />
    );
  }

  return (
    <Modal labelledBy="pause-title" onClose={onResume} onScrimClick={onResume} size="narrow" scrim={online ? 'light' : 'dark'}>
      <h2 id="pause-title" className="card-title">
        {online ? COPY.pause.menuTitle : COPY.pause.title}
      </h2>
      {online && <p className="body muted-text">{COPY.pause.onlineNote(partner)}</p>}
      <div className="button-col">
        <button type="button" className="btn btn-primary" onClick={onResume} data-autofocus data-sfx="own">
          {COPY.pause.resume}
        </button>
        {online && roomCode !== undefined && (
          <div className="row-between">
            <span className="label">{COPY.pause.room(roomCode)}</span>
            {onCopyInvite !== undefined && (
              <button type="button" className="btn btn-paper btn-small" onClick={() => runInvite(onCopyInvite)}>
                {copyLabel(inviteState, COPY.pause.copyInvite)}
              </button>
            )}
          </div>
        )}
        {!roundOver && (
          <div className="stack-tight">
            <button type="button" className="btn btn-paper" disabled={!isHost} onClick={() => setConfirm('restart')}>
              {COPY.pause.restart}
            </button>
            {!isHost && <span className="caption">{COPY.pause.restartHostOnly(0)}</span>}
          </div>
        )}
        {!online && !roundOver && onCopyShare !== undefined && (
          <div className="stack-tight">
            <button type="button" className="btn btn-paper" onClick={() => runShare(onCopyShare)}>
              {copyLabel(shareState, COPY.pause.share)}
            </button>
            <span className="caption">{COPY.pause.shareSub}</span>
          </div>
        )}
        <div className="row-between">
          <button type="button" className="btn btn-paper" onClick={onOpenSettings}>
            {COPY.pause.settings}
          </button>
          <button type="button" className="btn btn-paper" onClick={onToggleMute} aria-pressed={muted}>
            {muted ? COPY.hud.unmute : COPY.hud.mute}
          </button>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => setConfirm('quit')} data-sfx="back">
          {online ? COPY.pause.leave : COPY.pause.quit}
        </button>
      </div>
      {!roundOver && (
        <div className="tips">
          <p className="tip">
            <strong>{COPY.pause.hint}</strong> {hint}
          </p>
          <p className="tip tip-stuck">
            <strong>{COPY.pause.stuck}</strong> {watchOut}
          </p>
        </div>
      )}
    </Modal>
  );
}
