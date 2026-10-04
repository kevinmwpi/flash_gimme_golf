// OWNER: ui
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket URL of the game server (e.g. wss://flash-gimme-golf.fly.dev/ws). Unset => online hidden. */
  readonly VITE_WS_URL?: string;
  /** Shown in the title's version pill; falls back to "dev" when the build does not set it. */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
