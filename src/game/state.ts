import { GameState } from './types';

const STATE_PARAM = 'state';

function base64UrlEncode(input: string): string {
  const utf8 = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < utf8.length; i += 1) binary += String.fromCharCode(utf8[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function serializeState(state: GameState): string {
  return base64UrlEncode(JSON.stringify(state));
}

export function deserializeState(encoded: string): GameState {
  return JSON.parse(base64UrlDecode(encoded)) as GameState;
}

export function readStateFromUrl(): GameState | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get(STATE_PARAM);
  if (!encoded) return null;
  try {
    return deserializeState(encoded);
  } catch {
    return null;
  }
}

export function buildStateUrl(state: GameState): string {
  if (typeof window === 'undefined') return serializeState(state);
  const url = new URL(window.location.href);
  url.searchParams.set(STATE_PARAM, serializeState(state));
  return url.toString();
}
