import { useState } from 'react';
import GameCanvas from './game/GameCanvas';

export default function App() {
  const [sessionId, setSessionId] = useState(0);

  return (
    <main className="app-shell">
      <GameCanvas key={sessionId} onRestartApp={() => setSessionId((id) => id + 1)} />
    </main>
  );
}
