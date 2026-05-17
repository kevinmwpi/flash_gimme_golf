import { InputState } from './types';

const blockedKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Tab']);

export function createInput(): InputState {
  return { keysDown: new Set(), keysPressed: new Set() };
}

export function attachInput(input: InputState) {
  const down = (event: KeyboardEvent) => {
    if (blockedKeys.has(event.key)) event.preventDefault();
    if (!input.keysDown.has(event.key)) input.keysPressed.add(event.key);
    input.keysDown.add(event.key);
  };
  const up = (event: KeyboardEvent) => {
    input.keysDown.delete(event.key);
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
  };
}

export function consumeFrame(input: InputState) {
  input.keysPressed.clear();
}

export function isDown(input: InputState, ...keys: string[]) {
  return keys.some((key) => input.keysDown.has(key));
}

export function wasPressed(input: InputState, ...keys: string[]) {
  return keys.some((key) => input.keysPressed.has(key));
}
