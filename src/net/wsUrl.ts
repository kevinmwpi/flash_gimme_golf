// OWNER: net
/** `import.meta.env.VITE_WS_URL`, or same-origin `/ws` on localhost (the Vite dev proxy); null when online is unavailable. */
export function getWsUrl(): string | null {
  const configured = import.meta.env.VITE_WS_URL;
  if (typeof configured === 'string' && configured.length > 0) return configured;
  if (typeof window === 'undefined') return null;
  const { hostname, protocol, host } = window.location;
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') return null;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/ws`;
}
