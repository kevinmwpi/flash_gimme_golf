import type { InputState } from './types';

export class KeyboardInput {
  state: InputState = { down: new Set(), pressed: new Set() };
  private onDown = (event: KeyboardEvent) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Tab'].includes(event.key)) event.preventDefault();
    if (!this.state.down.has(event.key)) this.state.pressed.add(event.key);
    this.state.down.add(event.key);
  };
  private onUp = (event: KeyboardEvent) => this.state.down.delete(event.key);

  attach() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
  }

  detach() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
  }

  endFrame() {
    this.state.pressed.clear();
  }
}

export const isDown = (input: InputState, ...keys: string[]) => keys.some((key) => input.down.has(key));
export const wasPressed = (input: InputState, ...keys: string[]) => keys.some((key) => input.pressed.has(key));
