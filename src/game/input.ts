import { GamePhase, InputState } from './types';

const normalizeKey = (key: string) => key.length === 1 ? key.toLowerCase() : key;

const AIM_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's', ' ']);

export function snapshotInput(input: InputState): { held: string[]; pressed: string[] } {
  return { held: [...input.held], pressed: [...input.pressed] };
}

/** Restrict input to what this player may send in an online room. */
export function filterOnlineInput(
  input: InputState,
  phase: GamePhase,
  activePlayerIndex: number,
  localPlayerId: number,
  isHost: boolean,
): InputState {
  const held = new Set(input.held);
  const pressed = new Set(input.pressed);

  const isMyTurn = activePlayerIndex === localPlayerId;
  const canAim = isMyTurn && (phase === 'aiming' || phase === 'flying');

  if (!canAim) {
    for (const key of [...held, ...pressed]) {
      if (AIM_KEYS.has(normalizeKey(key))) {
        held.delete(key);
        pressed.delete(key);
      }
    }
  }

  if (phase === 'start') {
    for (let n = 1; n <= 4; n += 1) pressed.delete(String(n));
  }

  if (!isHost) {
    pressed.delete('r');
    if (phase === 'levelComplete' || phase === 'campaignComplete') {
      pressed.delete('Enter');
      pressed.delete(' ');
    }
  }

  return { held, pressed };
}

export function createInput(): InputState {
  return { held: new Set(), pressed: new Set() };
}

export function bindInput(input: InputState, element: Window = window) {
  const down = (event: KeyboardEvent) => {
    const key = normalizeKey(event.key);
    if ([' ', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
    }
    if (!input.held.has(key)) input.pressed.add(key);
    input.held.add(key);
  };
  const up = (event: KeyboardEvent) => input.held.delete(normalizeKey(event.key));
  element.addEventListener('keydown', down);
  element.addEventListener('keyup', up);
  return () => {
    element.removeEventListener('keydown', down);
    element.removeEventListener('keyup', up);
  };
}

export function consume(input: InputState, key: string) {
  const normalized = normalizeKey(key);
  const wasPressed = input.pressed.has(normalized);
  input.pressed.delete(normalized);
  return wasPressed;
}

export function isHeld(input: InputState, ...keys: string[]) {
  return keys.some((key) => input.held.has(normalizeKey(key)));
}

export function endInputFrame(input: InputState) {
  input.pressed.clear();
}
