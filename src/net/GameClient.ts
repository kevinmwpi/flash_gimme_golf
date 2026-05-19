import { createGameState } from '../game/engine';
import { deserializeState } from '../game/state';
import { GameState } from '../game/types';
import { ClientMessage, getWsUrl, OnlineSession, ServerMessage } from './protocol';

export type LobbyStatus =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'waiting'; code: string; playerId: 0; peerConnected: boolean }
  | { kind: 'joined'; code: string; playerId: 1; peerConnected: boolean }
  | { kind: 'playing'; session: OnlineSession }
  | { kind: 'error'; message: string };

type Listener = (status: LobbyStatus) => void;

export class GameClient {
  private socket: WebSocket | null = null;
  private status: LobbyStatus = { kind: 'idle' };
  private listeners = new Set<Listener>();
  private latestState: GameState = createGameState(2);
  private tick = 0;
  private playerId = 0;
  private roomCode = '';
  private peerConnected = false;

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    for (const listener of this.listeners) listener(this.status);
  }

  private setStatus(status: LobbyStatus) {
    this.status = status;
    this.emit();
  }

  private connect(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(getWsUrl());
      ws.addEventListener('open', () => resolve(ws));
      ws.addEventListener('error', () => reject(new Error('Could not connect to game server')));
    });
  }

  private attach(ws: WebSocket) {
    this.socket = ws;
    ws.addEventListener('message', (event) => this.onMessage(String(event.data)));
    ws.addEventListener('close', () => {
      if (this.status.kind !== 'error') {
        this.setStatus({ kind: 'error', message: 'Disconnected from server' });
      }
      this.socket = null;
    });
  }

  private send(message: ClientMessage) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private onMessage(raw: string) {
    let message: ServerMessage;
    try {
      message = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }

    switch (message.type) {
      case 'roomCreated':
        this.playerId = 0;
        this.roomCode = message.code;
        this.peerConnected = false;
        this.setStatus({ kind: 'waiting', code: message.code, playerId: 0, peerConnected: false });
        break;
      case 'waiting':
        this.playerId = 0;
        this.roomCode = message.code;
        this.setStatus({
          kind: 'waiting',
          code: message.code,
          playerId: 0,
          peerConnected: this.peerConnected,
        });
        break;
      case 'joined':
        this.playerId = 1;
        this.roomCode = message.code;
        this.peerConnected = false;
        this.setStatus({ kind: 'joined', code: message.code, playerId: 1, peerConnected: false });
        break;
      case 'peerJoined':
        this.peerConnected = true;
        if (this.status.kind === 'waiting') {
          this.setStatus({ ...this.status, peerConnected: true });
        } else if (this.status.kind === 'joined') {
          this.setStatus({ ...this.status, peerConnected: true });
        }
        break;
      case 'gameState': {
        const state = deserializeState(message.state);
        // Server broadcasts state every tick from room creation, so the
        // first gameState arrives in the same frame as peerJoined. Without
        // this guard the lobby unmounts before the host can click Start.
        if (state.phase === 'start') return;
        this.latestState = state;
        this.tick = message.tick;
        this.setStatus({
          kind: 'playing',
          session: this.buildSession(),
        });
        break;
      }
      case 'error':
        this.setStatus({ kind: 'error', message: message.message });
        break;
      default:
        break;
    }
  }

  private buildSession(): OnlineSession {
    return {
      playerId: this.playerId,
      isHost: this.playerId === 0,
      roomCode: this.roomCode,
      state: this.latestState,
      tick: this.tick,
      sendInput: (held, pressed) => this.send({ type: 'input', held, pressed }),
      startGame: () => this.send({ type: 'startGame' }),
    };
  }

  async createRoom() {
    this.setStatus({ kind: 'connecting' });
    try {
      const ws = await this.connect();
      this.attach(ws);
      this.send({ type: 'createRoom' });
    } catch (error) {
      this.setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Connection failed',
      });
    }
  }

  async joinRoom(code: string) {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) {
      this.setStatus({ kind: 'error', message: 'Enter a valid room code' });
      return;
    }
    this.setStatus({ kind: 'connecting' });
    try {
      const ws = await this.connect();
      this.attach(ws);
      this.send({ type: 'joinRoom', code: trimmed });
    } catch (error) {
      this.setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Connection failed',
      });
    }
  }

  startGame() {
    this.send({ type: 'startGame' });
  }

  disconnect() {
    this.socket?.close();
    this.socket = null;
    this.peerConnected = false;
    this.setStatus({ kind: 'idle' });
  }

  getStatus() {
    return this.status;
  }
}
