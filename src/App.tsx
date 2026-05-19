import { useCallback, useEffect, useState } from 'react';
import GameCanvas from './game/GameCanvas';
import Lobby from './Lobby';
import { GameClient } from './net/GameClient';
import { OnlineSession } from './net/protocol';

type AppMode =
  | { kind: 'lobby' }
  | { kind: 'local' }
  | { kind: 'online'; client: GameClient };

export default function App() {
  const [mode, setMode] = useState<AppMode>({ kind: 'lobby' });

  const handleLocalPlay = useCallback(() => setMode({ kind: 'local' }), []);

  const handleOnlinePlay = useCallback((client: GameClient) => {
    setMode({ kind: 'online', client });
  }, []);

  const handleLeaveOnline = useCallback(() => {
    if (mode.kind === 'online') mode.client.disconnect();
    setMode({ kind: 'lobby' });
  }, [mode]);

  if (mode.kind === 'lobby') {
    return <Lobby onLocalPlay={handleLocalPlay} onOnlinePlay={handleOnlinePlay} />;
  }

  if (mode.kind === 'online') {
    return <OnlineGame client={mode.client} onLeave={handleLeaveOnline} />;
  }

  return <GameCanvas />;
}

function OnlineGame({ client, onLeave }: { client: GameClient; onLeave: () => void }) {
  const [session, setSession] = useState<OnlineSession | null>(null);

  useEffect(() => {
    const status = client.getStatus();
    if (status.kind === 'playing') setSession(status.session);
    return client.subscribe((next) => {
      if (next.kind === 'playing') setSession(next.session);
      if (next.kind === 'error') onLeave();
    });
  }, [client, onLeave]);

  if (!session) {
    return <p className="lobby-status">Loading game…</p>;
  }

  return (
    <>
      <div className="online-bar">
        <span>Room {session.roomCode}</span>
        <span>
          Player {session.playerId + 1}
          {session.state.phase === 'aiming' && session.state.activePlayerIndex === session.playerId
            ? ' — your turn'
            : session.state.phase === 'aiming'
              ? ' — waiting'
              : ''}
        </span>
        <button type="button" className="lobby-btn ghost" onClick={onLeave}>
          Leave
        </button>
      </div>
      <GameCanvas online={session} />
    </>
  );
}
