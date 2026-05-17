import type { InputState } from './types';

export function createInput(): InputState {
  return { keys: new Set(), pressed: new Set() };
}

export function bindInput(input: InputState, onNumber: (count: number) => void) {
  const down = (event: KeyboardEvent) => {
    const key = normalizeKey(event.key);
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Tab'].includes(event.key)) event.preventDefault();
    if (!input.keys.has(key)) input.pressed.add(key);
    input.keys.add(key);
    if (/^[1-4]$/.test(key)) onNumber(Number(key));
  };
  const up = (event: KeyboardEvent) => input.keys.delete(normalizeKey(event.key));
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
  };
}

export function consumePressed(input: InputState, key: string) {
  if (!input.pressed.has(key)) return false;
  input.pressed.delete(key);
  return true;
}

export function clearPressed(input: InputState) {
  input.pressed.clear();
}

function normalizeKey(key: string) {
  if (key === ' ') return 'Space';
  return key.length === 1 ? key.toLowerCase() : key;
}
