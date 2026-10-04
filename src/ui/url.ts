// OWNER: ui
/**
 * `?room=` / `?state=` query helpers (ARCH.md §1.13, UX.md §2). Params are read once at boot and
 * stripped with `history.replaceState` BEFORE anything connects or decodes, so a reload never
 * re-joins and the address bar is never rewritten during play.
 */
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_CODE_RE } from '../net/protocol';

function readParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get(name);
  return value === null || value.length === 0 ? null : value;
}

/**
 * The normalised `?room=` text, or null when absent / nothing survives normalisation. A code that is
 * not a complete room code (a mangled link) still opens the lobby with the text prefilled so the
 * player sees what arrived; only a complete code auto-joins (`isRoomCode`).
 */
export function readRoomParam(): string | null {
  const raw = readParam('room');
  if (raw === null) return null;
  const code = normaliseRoomCode(raw);
  return code.length === 0 ? null : code;
}

export function isRoomCode(code: string): boolean {
  return ROOM_CODE_RE.test(code);
}

export function readStateParam(): string | null {
  return readParam('state');
}

/** Removes the listed params via history.replaceState (no navigation). */
export function clearParams(names: readonly string[]): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  for (const name of names) url.searchParams.delete(name);
  window.history.replaceState(window.history.state, '', url.toString());
}

/** `https://host/?room=K7PQ2` for the current origin (what the host copies and shares). */
export function inviteUrlFor(code: string): string {
  if (typeof window === 'undefined') return `?room=${code}`;
  return `${window.location.origin}${window.location.pathname}?room=${code}`;
}

/**
 * Lobby input normalisation (UX.md §3.2): uppercase, `0 -> O`, `1 -> I`, drop everything outside the
 * room-code alphabet, cap at the code length. A pasted invite URL yields its `room=` value.
 */
export function normaliseRoomCode(text: string): string {
  const fromUrl = /[?&]room=([^&#\s]+)/i.exec(text);
  const source = fromUrl?.[1] ?? text;
  let out = '';
  for (const ch of source.toUpperCase()) {
    const mapped = ch === '0' ? 'O' : ch === '1' ? 'I' : ch;
    if (ROOM_CODE_ALPHABET.includes(mapped)) out += mapped;
    if (out.length === ROOM_CODE_LENGTH) break;
  }
  return out;
}
