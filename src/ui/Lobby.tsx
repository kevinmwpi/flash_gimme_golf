// OWNER: ui
/**
 * Online lobby (UX.md §3.2; lobby-layout.html): viewport-space card, scrollable, max-width 640. Sub-
 * states are DERIVED from `ClientStatus` (menu / connecting / hosting / ready / joined / error), never
 * from events. Create / join / invite link / Share…, `?room=` auto-join exactly once, start-hole picker
 * via `client.setLevel` (the guest sees it live from `lobbyState`), Start disabled until the partner
 * is here, "Waking up the server" after 1.5 s, 15 s hard timeout, error table by ErrorCode with raw
 * server text never shown. Also exports `NetOverlay` (UX.md §3.9) for the in-game disconnect states.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientStatus, GameClient } from '../net/GameClient';
import type { LobbyState } from '../net/protocol';
import { ROOM_CODE_LENGTH } from '../net/protocol';
import { LEVELS, WORLD1_IDS } from '../sim/levels/index';
import type { PlayerId } from '../sim/types';
import { COPY, lobbyError, nameOf, otherPlayer, type LobbyErrorCopy, type LobbyErrorKind } from './copy';
import { Icon } from './Hud';
import { ConfirmDialog } from './Pause';
import { inviteUrlFor, normaliseRoomCode } from './url';

export type LobbyProps = {
  client: GameClient;
  status: ClientStatus;
  /** code from `?room=` (already normalised) */
  initialCode: string | null;
  /** attempt the join once on mount */
  autoJoin: boolean;
  /** "Create a new room" from an in-game overlay: create once on mount instead of showing the menu */
  autoCreate: boolean;
  onBack(): void;
  onPlaySolo(): void;
};

type LobbyView =
  | { sub: 'menu' }
  | { sub: 'connecting'; code: string | null }
  | { sub: 'hosting'; code: string; lobby: LobbyState; ready: boolean }
  | { sub: 'joined'; code: string; lobby: LobbyState }
  | { sub: 'error'; kind: LobbyErrorKind; code: string | null };

const SLOW_CONNECT_MS = 1500;
const CONNECT_TIMEOUT_MS = 15000;
const COPIED_MS = 1500;

function viewOf(status: ClientStatus, attemptedCode: string | null, timedOut: boolean): LobbyView {
  if (timedOut) return { sub: 'error', kind: 'unreachable', code: attemptedCode };
  switch (status.kind) {
    case 'idle':
      return { sub: 'menu' };
    case 'connecting':
    case 'reconnecting':
      return { sub: 'connecting', code: attemptedCode };
    case 'waiting':
      return { sub: 'hosting', code: status.code, lobby: status.lobby, ready: status.peerConnected };
    case 'joined':
      return { sub: 'joined', code: status.code, lobby: status.lobby };
    case 'playing':
      return { sub: 'connecting', code: status.code };
    case 'closed':
      if (status.reason === 'left') return { sub: 'menu' };
      if (status.reason === 'serverUnreachable' || status.reason === 'timeout') return { sub: 'error', kind: 'unreachable', code: attemptedCode };
      return { sub: 'error', kind: 'roomClosed', code: attemptedCode };
    case 'error':
      return { sub: 'error', kind: status.code, code: attemptedCode };
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function useCopied(): [string | null, (key: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const t = window.setTimeout(() => setCopied(null), COPIED_MS);
    return () => window.clearTimeout(t);
  }, [copied]);
  return [copied, setCopied];
}

function PlayerChip({ player, tag }: { player: PlayerId; tag: string }): React.JSX.Element {
  return (
    <span className="lobby-chip">
      <span className={`ball-dot ball-p${player + 1}`} aria-hidden="true" />
      {nameOf(player).toUpperCase()} · {tag}
    </span>
  );
}

/**
 * No `maxLength` on the input: a URL that arrives through drag-drop or an IME commit (no paste event)
 * must reach `normaliseRoomCode`, which extracts `room=` and caps the length itself.
 */
function RoomCodeForm({ initial, disabled, onJoin }: { initial: string; disabled: boolean; onJoin(code: string): void }): React.JSX.Element {
  const [code, setCode] = useState(initial);
  const valid = code.length === ROOM_CODE_LENGTH;
  return (
    <form
      className="code-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onJoin(code);
      }}
    >
      <input
        className="code-input"
        value={code}
        onChange={(e) => setCode(normaliseRoomCode(e.target.value))}
        onPaste={(e) => {
          e.preventDefault();
          setCode(normaliseRoomCode(e.clipboardData.getData('text')));
        }}
        placeholder={COPY.lobby.codePlaceholder}
        aria-label={COPY.lobby.codeLabel}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
      />
      <button type="submit" className="btn btn-paper" disabled={!valid || disabled}>
        {COPY.lobby.join}
      </button>
    </form>
  );
}

function HostCard({ code, lobby, ready, onSetLevel, onStart, onCancel }: { code: string; lobby: LobbyState; ready: boolean; onSetLevel(id: string): void; onStart(): void; onCancel(): void }): React.JSX.Element {
  const [copied, setCopied] = useCopied();
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const invite = inviteUrlFor(code);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const copy = async (key: string, text: string): Promise<void> => {
    const ok = await copyText(text);
    if (ok) setCopied(key);
    else setFallbackUrl(text);
  };
  const share = (): void => {
    void navigator.share({ title: COPY.app.name, text: COPY.lobby.shareText(code), url: invite }).catch(() => undefined);
  };
  const [seenReady, setSeenReady] = useState(false);
  if (ready && !seenReady) setSeenReady(true);
  useEffect(() => {
    if (ready) document.querySelector<HTMLButtonElement>('.start-btn')?.focus();
  }, [ready]);
  const statusText = ready ? COPY.lobby.partnerJoined(1) : seenReady ? COPY.lobby.partnerLeft(1) : COPY.lobby.waitingPartner;

  return (
    <section className="lobby-card" aria-label={COPY.lobby.yourRoom}>
      <h1 className="card-title">{COPY.lobby.yourRoom}</h1>
      <span className="lab">{COPY.lobby.roomCode}</span>
      <div className="code-tile">{code}</div>
      <div className="button-row stretch">
        <button type="button" className="btn btn-paper" onClick={() => void copy('code', code)}>
          {copied === 'code' ? COPY.lobby.copied : COPY.lobby.copyCode}
        </button>
        <button type="button" className="btn btn-paper" onClick={() => void copy('link', invite)}>
          {copied === 'link' ? COPY.lobby.copied : COPY.lobby.copyLink}
        </button>
        {canShare && (
          <button type="button" className="btn btn-paper" onClick={share}>
            {COPY.lobby.share}
          </button>
        )}
      </div>
      {fallbackUrl !== null && (
        <label className="fallback-copy">
          <span className="caption">{COPY.lobby.longPress}</span>
          <input readOnly value={fallbackUrl} onFocus={(e) => e.currentTarget.select()} />
        </label>
      )}
      <p className={`status${ready ? ' good' : ''}`} aria-live="polite">
        <i aria-hidden="true" />
        {statusText}
      </p>
      <div className="chips">
        <PlayerChip player={0} tag={COPY.lobby.chipYou} />
        {ready && <PlayerChip player={1} tag={COPY.lobby.chipPartner} />}
      </div>
      <span className="lab">{COPY.lobby.startAt}</span>
      <div className="holes" role="radiogroup" aria-label={COPY.lobby.startAt}>
        {LEVELS.map((level) => (
          <button key={level.id} type="button" role="radio" aria-checked={lobby.levelId === level.id} className={`hole${lobby.levelId === level.id ? ' on' : ''}`} onClick={() => onSetLevel(level.id)}>
            {COPY.lobby.hole(level.order)}
          </button>
        ))}
      </div>
      <div className="start-row">
        <div className="stack-tight">
          <button type="button" className={`btn btn-primary start-btn${ready ? ' bounce' : ''}`} disabled={!ready} onClick={onStart}>
            {ready ? COPY.lobby.startReady(1) : COPY.lobby.start}
          </button>
          {!ready && <span className="caption">{COPY.lobby.startNeeds2}</span>}
        </div>
        <button type="button" className="btn btn-ghost" onClick={onCancel} data-sfx="back">
          {COPY.lobby.cancelRoom}
        </button>
      </div>
    </section>
  );
}

function GuestCard({ code, lobby, onLeave }: { code: string; lobby: LobbyState; onLeave(): void }): React.JSX.Element {
  const startIndex = Math.max(0, WORLD1_IDS.indexOf(lobby.levelId));
  return (
    <section className="lobby-card" aria-label={COPY.lobby.joinedTitle(code)}>
      <h1 className="card-title">{COPY.lobby.joinedTitle(code)}</h1>
      <div className="chips">
        <PlayerChip player={0} tag={COPY.lobby.chipHost} />
        <PlayerChip player={1} tag={COPY.lobby.chipYou} />
      </div>
      <p className="status" aria-live="polite">
        <i aria-hidden="true" />
        {COPY.lobby.waitingHost(0)}
      </p>
      <p className="body">{COPY.lobby.preteach(1)}</p>
      <p className="caption">{COPY.lobby.startingAt(startIndex + 1)}</p>
      <button type="button" className="btn btn-ghost" onClick={onLeave} data-sfx="back">
        {COPY.lobby.leave}
      </button>
    </section>
  );
}

/** Mounted only while connecting, so its own "slow" timer needs no reset (UX.md §3.2: 1.5 s). */
function ConnectingCard({ code, onCancel }: { code: string | null; onCancel(): void }): React.JSX.Element {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), SLOW_CONNECT_MS);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <section className="lobby-card centered" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <p className="body">{code === null ? COPY.lobby.connecting : COPY.lobby.joining(code)}</p>
      {slow && <p className="caption">{COPY.lobby.waking}</p>}
      <button type="button" className="btn btn-paper" onClick={onCancel} data-sfx="back">
        {COPY.lobby.cancel}
      </button>
    </section>
  );
}

type ErrorCardProps = {
  copy: LobbyErrorCopy;
  onPrimary(): void;
  onSecondary(): void;
  /** present when the failed join had a code to correct: "Edit the code" returns to the menu with it prefilled */
  onEdit: (() => void) | null;
};

function ErrorCard({ copy, onPrimary, onSecondary, onEdit }: ErrorCardProps): React.JSX.Element {
  const primaryLabel: Record<LobbyErrorCopy['primary'], string> = {
    tryAgain: COPY.lobby.tryAgain,
    retry: COPY.lobby.retry,
    reload: COPY.lobby.reload,
    back: COPY.lobby.back,
    backToTitle: COPY.lobby.backToTitleBtn,
  };
  const primaryIsBack = copy.primary === 'back' || copy.primary === 'backToTitle';
  const secondaryLabel = copy.secondary === null ? null : copy.secondary === 'createOwn' ? COPY.lobby.createOwn : copy.secondary === 'playSolo' ? COPY.lobby.playSolo : COPY.lobby.back;
  return (
    <section className="lobby-card" role="alert" aria-labelledby="lobby-error-title">
      <h1 id="lobby-error-title" className="card-title">
        {copy.title}
      </h1>
      <p className="body">{copy.body}</p>
      <div className="button-row">
        <button type="button" className="btn btn-primary" onClick={onPrimary} autoFocus data-sfx={primaryIsBack ? 'back' : undefined}>
          {primaryLabel[copy.primary]}
        </button>
        {secondaryLabel !== null && (
          <button type="button" className="btn btn-paper" onClick={onSecondary} data-sfx={copy.secondary === 'back' ? 'back' : undefined}>
            {secondaryLabel}
          </button>
        )}
        {onEdit !== null && (
          <button type="button" className="btn btn-ghost" onClick={onEdit} data-sfx="back">
            {COPY.lobby.editCode}
          </button>
        )}
      </div>
    </section>
  );
}

export default function Lobby(props: LobbyProps): React.JSX.Element {
  const { client, status, initialCode, autoJoin, autoCreate, onBack, onPlaySolo } = props;
  const [attemptedCode, setAttemptedCode] = useState<string | null>(autoJoin ? initialCode : null);
  const [timedOut, setTimedOut] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const started = useRef(false);
  const view = viewOf(status, attemptedCode, timedOut);

  const join = useCallback(
    (code: string) => {
      setTimedOut(false);
      setAttemptedCode(code);
      void client.joinRoom(code);
    },
    [client],
  );
  const create = useCallback(() => {
    setTimedOut(false);
    setAttemptedCode(null);
    void client.createRoom();
  }, [client]);
  /** Error card -> menu (the client's `left` close maps to the menu); the attempted code stays prefilled. */
  const dismissError = useCallback(() => {
    setTimedOut(false);
    client.leave();
  }, [client]);

  // Mount, exactly once: auto-join a `?room=` code (attemptedCode is seeded with it above), auto-create
  // from an in-game "Create a new room", or clear a stale closed/error status left over from an
  // earlier room so the menu shows. Only client calls here; no React state changes.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (autoJoin && initialCode !== null) void client.joinRoom(initialCode);
    else if (autoCreate) void client.createRoom();
    else if (status.kind === 'closed' || status.kind === 'error') client.leave();
  }, [autoJoin, autoCreate, initialCode, client, status.kind]);

  useEffect(() => {
    if (view.sub !== 'connecting') return;
    const hardTimer = window.setTimeout(() => {
      client.leave();
      setTimedOut(true);
    }, CONNECT_TIMEOUT_MS);
    return () => window.clearTimeout(hardTimer);
  }, [view.sub, client]);

  const inRoom = view.sub === 'hosting' || view.sub === 'joined';
  const roomCode = inRoom ? view.code : null;

  useEffect(() => {
    if (roomCode === null) return;
    const previous = document.title;
    document.title = COPY.lobby.docTitle(roomCode);
    return () => {
      document.title = previous;
    };
  }, [roomCode]);
  const needsConfirm = (view.sub === 'hosting' && view.ready) || view.sub === 'joined';

  const leaveRoom = useCallback(() => {
    client.leave();
    setConfirmLeave(false);
  }, [client]);

  /** Title button: leaves any room / attempt and clears an error so the next ONLINE visit starts at the menu. */
  const back = useCallback(() => {
    if (needsConfirm) {
      setConfirmLeave(true);
      return;
    }
    if (inRoom || view.sub === 'connecting' || view.sub === 'error') client.leave();
    onBack();
  }, [needsConfirm, inRoom, view.sub, client, onBack]);

  // Esc: on an error card it steps back to the menu (code prefilled); elsewhere it is the Title button.
  const isError = view.sub === 'error';
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || confirmLeave) return;
      if (isError) dismissError();
      else back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back, dismissError, isError, confirmLeave]);

  const errorPrimary = (copy: LobbyErrorCopy): void => {
    switch (copy.primary) {
      case 'tryAgain':
      case 'retry':
        // Retry only ever repeats the SAME attempt; without a code there is nothing to retry, so step back.
        if (attemptedCode !== null) join(attemptedCode);
        else if (copy.primary === 'retry') create();
        else dismissError();
        break;
      case 'reload':
        window.location.reload();
        break;
      case 'back':
        dismissError();
        break;
      case 'backToTitle':
        back();
        break;
    }
  };
  const errorSecondary = (copy: LobbyErrorCopy): void => {
    if (copy.secondary === 'createOwn') create();
    else if (copy.secondary === 'playSolo') onPlaySolo();
    else dismissError();
  };

  return (
    <main className="screen lobby">
      <div className="lobby-top">
        <button type="button" className="btn btn-paper btn-small back-btn" onClick={back} data-sfx="back">
          <Icon name="back" size={18} /> {COPY.lobby.backToTitle}
        </button>
        {inRoom && (
          <span className="you-chip">
            <span className={`ball-dot ball-p${view.sub === 'hosting' ? 1 : 2}`} aria-hidden="true" />
            {COPY.lobby.youChip(view.sub === 'hosting' ? 0 : 1, view.sub === 'hosting')}
          </span>
        )}
      </div>

      {view.sub === 'menu' && (
        <section className="lobby-card" aria-labelledby="lobby-title">
          <h1 id="lobby-title" className="card-title">
            {COPY.lobby.title}
          </h1>
          <p className="body">{COPY.lobby.sub}</p>
          <button type="button" className="btn btn-primary btn-tall" onClick={create} autoFocus>
            {COPY.lobby.create}
          </button>
          <div className="divider">{COPY.lobby.or}</div>
          <RoomCodeForm initial={attemptedCode ?? initialCode ?? ''} disabled={false} onJoin={join} />
        </section>
      )}

      {view.sub === 'connecting' && (
        <ConnectingCard
          code={view.code}
          onCancel={() => {
            client.leave();
            setTimedOut(false);
          }}
        />
      )}

      {view.sub === 'hosting' && (
        <HostCard code={view.code} lobby={view.lobby} ready={view.ready} onSetLevel={(id) => client.setLevel(id)} onStart={() => client.start()} onCancel={back} />
      )}

      {view.sub === 'joined' && <GuestCard code={view.code} lobby={view.lobby} onLeave={back} />}

      {view.sub === 'error' && (
        <ErrorCard
          copy={lobbyError(view.kind, view.code)}
          onPrimary={() => errorPrimary(lobbyError(view.kind, view.code))}
          onSecondary={() => errorSecondary(lobbyError(view.kind, view.code))}
          onEdit={view.kind === 'ROOM_NOT_FOUND' && view.code !== null ? dismissError : null}
        />
      )}

      <p className="foot">{COPY.lobby.note}</p>

      {confirmLeave && (
        <ConfirmDialog
          title={COPY.lobby.leaveConfirm}
          body={COPY.lobby.leaveConfirmBody(view.sub === 'hosting' ? 1 : 0)}
          confirmLabel={COPY.lobby.leave}
          cancelLabel={COPY.lobby.stay}
          danger
          onConfirm={() => {
            leaveRoom();
            onBack();
          }}
          onCancel={() => setConfirmLeave(false)}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------------------------
// In-game network overlay (UX.md §3.9)
// ---------------------------------------------------------------------------------------------

export type NetOverlayKind = 'reconnecting' | 'rejoining' | 'lost' | 'partnerAway' | 'partnerLeft' | 'partnerTimeout' | 'roomClosed';

export type NetOverlayProps = {
  kind: NetOverlayKind;
  /** the local seat; names the partner */
  seat: PlayerId;
  roomCode: string | null;
  secondsLeft: number | null;
  isHost: boolean;
  onLeave(): void;
  onBack(): void;
  onCreateRoom(): void;
};

export function NetOverlay({ kind, seat, roomCode, secondsLeft, isHost, onLeave, onBack, onCreateRoom }: NetOverlayProps): React.JSX.Element {
  const partner = otherPlayer(seat);
  const [copied, setCopied] = useCopied();

  if (kind === 'partnerAway') {
    return (
      <div className="net-band" role="status" aria-live="polite">
        <span className="spinner small" aria-hidden="true" />
        <span className="net-band-text">
          {COPY.net.partnerAway(partner, secondsLeft ?? 0)}
          {roomCode !== null && <small>{COPY.net.partnerAwaySub(roomCode)}</small>}
        </span>
        <button type="button" className="btn btn-ghost btn-small" onClick={onLeave} data-sfx="back">
          {COPY.net.leave}
        </button>
      </div>
    );
  }

  const reconnecting = kind === 'reconnecting' || kind === 'rejoining';
  const title = reconnecting
    ? COPY.net.lostTitle
    : kind === 'lost'
      ? COPY.net.failedTitle
      : kind === 'partnerLeft'
        ? COPY.net.partnerLeftTitle(partner)
        : kind === 'partnerTimeout'
          ? COPY.net.partnerTimeoutTitle(partner)
          : COPY.net.roomClosedTitle;
  const body = reconnecting
    ? kind === 'rejoining'
      ? COPY.net.rejoining(roomCode ?? '')
      : COPY.net.reconnecting(secondsLeft ?? 0)
    : kind === 'lost'
      ? COPY.net.failed
      : kind === 'roomClosed'
        ? COPY.net.roomClosed
        : COPY.net.partnerLeftSub;

  return (
    <div className="overlay overlay-dark">
      <div className="card card-narrow net-card" role="alertdialog" aria-modal="true" aria-labelledby="net-title" aria-live="polite">
        {reconnecting && <span className="spinner" aria-hidden="true" />}
        <h2 id="net-title" className="card-title">
          {title}
        </h2>
        <p className="body">{body}</p>
        <div className="button-row">
          {reconnecting ? (
            <button type="button" className="btn btn-ghost" onClick={onLeave} data-sfx="back">
              {COPY.net.leave}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-primary" onClick={onBack} autoFocus data-sfx="back">
                {COPY.net.backToTitle}
              </button>
              {kind === 'lost' && roomCode !== null && (
                <button type="button" className="btn btn-paper" onClick={() => void copyText(roomCode).then((ok) => ok && setCopied('code'))}>
                  {copied === 'code' ? COPY.lobby.copied : COPY.net.copyCode}
                </button>
              )}
              {(kind === 'partnerLeft' || kind === 'partnerTimeout') && isHost && (
                <button type="button" className="btn btn-paper" onClick={onCreateRoom}>
                  {COPY.net.createNew}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
