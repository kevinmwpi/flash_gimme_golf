// OWNER: ui
/**
 * The ARIA radio-group keyboard pattern the hole and world pickers share (the Title tray, the lobby's START AT
 * rows): one tab stop per group, the checked radio (roving tabindex), and the arrow keys move the choice and
 * the focus together, wrapping at both ends. Space/Enter stay the buttons' native activation.
 */
import type React from 'react';

/** A radio group's arrow step: Right/Down forward, Left/Up back, any other key 0. */
export function arrowDelta(key: string): number {
  if (key === 'ArrowRight' || key === 'ArrowDown') return 1;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return -1;
  return 0;
}

/**
 * An arrow key on a radio group whose choice is confirmed elsewhere (the lobby's START AT, which the server
 * echoes in `lobbyState`): the radio after the focused one takes the focus at once and `pick` receives its
 * index, so a quick second press steps on from there instead of waiting for the round trip. Other keys keep
 * their native handling.
 */
export function stepRadio(e: React.KeyboardEvent<HTMLElement>, pick: (index: number) => void): void {
  const delta = arrowDelta(e.key);
  if (delta === 0) return;
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
  const from = radios.findIndex((r) => r === e.target);
  if (from < 0) return;
  e.preventDefault();
  const index = (from + delta + radios.length) % radios.length;
  radios[index]?.focus();
  pick(index);
}
