import { useEffect, useMemo, useState } from 'react';
import { GameClient, LobbyStatus } from './net/GameClient';

type LobbyProps = {
  onLocalPlay: () => void;
  onOnlinePlay: (client: GameClient) => void;
};

export default function Lobby({ onLocalPlay, onOnlinePlay }: LobbyProps) {
  const client = useMemo(() => new GameClient(), []);
  const [status, setStatus] = useState<LobbyStatus>({ kind: 'idle' });
  const [joinCode, setJoinCode] = useState('');

  useEffect(() => {
    return client.subscribe((next) => {
      setStatus(next);
      if (next.kind === 'playing') onOnlinePlay(client);
    });
  }, [client, onOnlinePlay]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room && status.kind === 'idle') {
      setJoinCode(room.toUpperCase());
      void client.joinRoom(room);
    }
  }, [client, status.kind]);

  const shareUrl = (code: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', code);
    return url.toString();
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* ignore */
    }
  };

  const copyLink = async (code: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl(code));
    } catch {
      /* ignore */
    }
  };

  const errorHint = () => {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'Local dev: run npm run server in another terminal.';
    }
    return 'Online mode isn’t available yet on this build. Try Play locally for same-keyboard co-op.';
  };

  return (
    <div className="lobby">
      <div className="lobby-panel">
        <h1>Flash Golf</h1>
        <p className="lobby-tagline">Co-op artillery golf — scrappy on purpose.</p>

        {status.kind === 'idle' && (
          <div className="lobby-actions">
            <button type="button" className="lobby-btn primary" onClick={() => void client.createRoom()}>
              Create online room
            </button>
            <div className="lobby-join">
              <input
                type="text"
                placeholder="Room code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={6}
                aria-label="Room code"
              />
              <button
                type="button"
                className="lobby-btn"
                onClick={() => void client.joinRoom(joinCode)}
                disabled={joinCode.trim().length < 4}
              >
                Join
              </button>
            </div>
            <button type="button" className="lobby-btn ghost" onClick={onLocalPlay}>
              Play locally (same keyboard)
            </button>
          </div>
        )}

        {status.kind === 'connecting' && <p className="lobby-status">Connecting…</p>}

        {status.kind === 'waiting' && (
          <div className="lobby-room">
            <p className="lobby-status">Room code — send to your friend:</p>
            <p className="lobby-code">{status.code}</p>
            <div className="lobby-room-actions">
              <button type="button" className="lobby-btn" onClick={() => void copyCode(status.code)}>
                Copy code
              </button>
              <button type="button" className="lobby-btn" onClick={() => void copyLink(status.code)}>
                Copy invite link
              </button>
            </div>
            <p className="lobby-hint">
              {status.peerConnected ? 'Friend connected! Press Start when ready.' : 'Waiting for friend to join…'}
            </p>
            {status.peerConnected && (
              <button type="button" className="lobby-btn primary" onClick={() => client.startGame()}>
                Start game
              </button>
            )}
            <button type="button" className="lobby-btn ghost" onClick={() => client.disconnect()}>
              Cancel
            </button>
          </div>
        )}

        {status.kind === 'joined' && (
          <div className="lobby-room">
            <p className="lobby-status">Joined room {status.code}</p>
            <p className="lobby-hint">
              {status.peerConnected ? 'Host will start the game.' : 'Waiting for host…'}
            </p>
            <button type="button" className="lobby-btn ghost" onClick={() => client.disconnect()}>
              Leave
            </button>
          </div>
        )}

        {status.kind === 'error' && (
          <div className="lobby-error">
            <p>{status.message}</p>
            <p className="lobby-hint">{errorHint()}</p>
            <button type="button" className="lobby-btn" onClick={() => client.disconnect()}>
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
