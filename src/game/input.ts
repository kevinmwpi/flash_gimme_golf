import { InputState } from './types';

const normalizeKey = (key: string) => key.length === 1 ? key.toLowerCase() : key;

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
