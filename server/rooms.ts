import { WebSocket } from 'ws';
import { createGameState, startGame, updateGame } from '../src/game/engine';
import { filterOnlineInput } from '../src/game/input';
import { serializeState } from '../src/game/state';
import { GameState, InputState } from '../src/game/types';
import type { ClientMessage, ServerMessage } from '../src/net/protocol';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const FIXED_STEP = 1 / 60;
const SIM_VIEWPORT = { x: 1280, y: 720 };

type InputSnapshot = { held: string[]; pressed: string[] };

export type Room = {
  code: string;
  host: WebSocket;
  guest: WebSocket | null;
  state: GameState;
  inputs: [InputSnapshot, InputSnapshot];
  tick: number;
  interval: ReturnType<typeof setInterval>;
};

const rooms = new Map<string, Room>();

function randomCode(): string {
  let code = '';
  for (let i = 0; i < 5; i += 1) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return rooms.has(code) ? randomCode() : code;
}

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function snapshotToInput(snapshot: InputSnapshot): InputState {
  return { held: new Set(snapshot.held), pressed: new Set(snapshot.pressed) };
}

function mergeRoomInput(room: Room): InputState {
  const merged: InputState = { held: new Set(), pressed: new Set() };
  const { state } = room;

  for (let playerId = 0; playerId < 2; playerId += 1) {
    const raw = snapshotToInput(room.inputs[playerId]);
    const filtered = filterOnlineInput(
      raw,
      state.phase,
      state.activePlayerIndex,
      playerId,
      playerId === 0,
    );
    for (const key of filtered.held) merged.held.add(key);
    for (const key of filtered.pressed) merged.pressed.add(key);
  }

  return merged;
}

function broadcastState(room: Room) {
  const payload: ServerMessage = {
    type: 'gameState',
    state: serializeState(room.state),
    tick: room.tick,
  };
  const raw = JSON.stringify(payload);
  if (room.host.readyState === WebSocket.OPEN) room.host.send(raw);
  if (room.guest?.readyState === WebSocket.OPEN) room.guest.send(raw);
}

function stepRoom(room: Room) {
  const input = mergeRoomInput(room);
  room.state = updateGame(room.state, input, FIXED_STEP, SIM_VIEWPORT);
  room.tick += 1;
  broadcastState(room);

  for (const snapshot of room.inputs) {
    snapshot.pressed = [];
  }
}

function destroyRoom(code: string) {
  const room = rooms.get(code);
  if (!room) return;
  clearInterval(room.interval);
  rooms.delete(code);
}

export function createRoom(host: WebSocket): string {
  const code = randomCode();
  const state = createGameState(2);
  const room: Room = {
    code,
    host,
    guest: null,
    state,
    inputs: [
      { held: [], pressed: [] },
      { held: [], pressed: [] },
    ],
    tick: 0,
    interval: undefined as unknown as ReturnType<typeof setInterval>,
  };
  room.interval = setInterval(() => stepRoom(room), 1000 / 60);
  rooms.set(code, room);
  return code;
}

export function joinRoom(code: string, guest: WebSocket): Room | null {
  const room = rooms.get(code.toUpperCase());
  if (!room || room.guest) return null;
  room.guest = guest;
  send(room.host, { type: 'peerJoined' });
  send(guest, { type: 'joined', code: room.code, playerId: 1 });
  broadcastState(room);
  return room;
}

export function findRoomBySocket(ws: WebSocket): Room | null {
  for (const room of rooms.values()) {
    if (room.host === ws || room.guest === ws) return room;
  }
  return null;
}

export function handleClientMessage(ws: WebSocket, message: ClientMessage) {
  switch (message.type) {
    case 'createRoom': {
      const code = createRoom(ws);
      send(ws, { type: 'roomCreated', code, playerId: 0 });
      send(ws, { type: 'waiting', code, playerId: 0 });
      break;
    }
    case 'joinRoom': {
      const room = joinRoom(message.code, ws);
      if (!room) {
        send(ws, { type: 'error', message: 'Room not found or full' });
        return;
      }
      break;
    }
    case 'input': {
      const room = findRoomBySocket(ws);
      if (!room) return;
      const playerId = room.host === ws ? 0 : 1;
      const slot = room.inputs[playerId];
      slot.held = message.held;
      // Accumulate pressed events across client messages. The client clears
      // its own pressed set every step, so a one-shot key (space, enter, R)
      // only appears in one snapshot; if two snapshots arrive before the
      // next server tick, replacing would drop the event.
      for (const key of message.pressed) {
        if (!slot.pressed.includes(key)) slot.pressed.push(key);
      }
      break;
    }
    case 'startGame': {
      const room = findRoomBySocket(ws);
      if (!room || room.host !== ws || !room.guest) return;
      if (room.state.phase !== 'start') return;
      const seed = Date.now() >>> 0;
      room.state = startGame(2, seed);
      room.tick = 0;
      broadcastState(room);
      break;
    }
    default:
      break;
  }
}

export function handleDisconnect(ws: WebSocket) {
  const room = findRoomBySocket(ws);
  if (!room) return;
  const peer = room.host === ws ? room.guest : room.host;
  if (peer) {
    send(peer, { type: 'error', message: 'Other player disconnected' });
  }
  destroyRoom(room.code);
}
