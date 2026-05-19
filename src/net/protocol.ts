import { GameState } from '../game/types';

export type ClientMessage =
  | { type: 'createRoom' }
  | { type: 'joinRoom'; code: string }
  | { type: 'input'; held: string[]; pressed: string[] }
  | { type: 'startGame' };

export type ServerMessage =
  | { type: 'roomCreated'; code: string; playerId: 0 }
  | { type: 'joined'; code: string; playerId: 1 }
  | { type: 'waiting'; code: string; playerId: 0 }
  | { type: 'peerJoined' }
  | { type: 'gameState'; state: string; tick: number }
  | { type: 'error'; message: string };

export type OnlineSession = {
  playerId: number;
  isHost: boolean;
  roomCode: string;
  state: GameState;
  tick: number;
  sendInput: (held: string[], pressed: string[]) => void;
  startGame: () => void;
};

export function getWsUrl(): string {
  const env = import.meta.env.VITE_WS_URL as string | undefined;
  if (env) return env;
  if (typeof window === 'undefined') return 'ws://localhost:3001';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}
