import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The dev server binds to localhost only (audit #92); `npm run dev:lan` passes `--host` for phone
// testing on the LAN. `/ws` and `/healthz` are proxied to the local game server (`npm run server`,
// port 3001) so online mode and the title's server pill work in dev without VITE_WS_URL. Tests run in
// Node; a file that needs a DOM opts in with `// @vitest-environment jsdom` at its top.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const sha = process.env.VERCEL_GIT_COMMIT_SHA;
/** Title version pill: `0.2.0` locally, `0.2.0+ab12cde` on Vercel, unless VITE_APP_VERSION is set explicitly. */
const appVersion = process.env.VITE_APP_VERSION ?? (sha === undefined ? pkg.version : `${pkg.version}+${sha.slice(0, 7)}`);

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
  },
  server: {
    host: 'localhost',
    proxy: {
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
      '/healthz': {
        target: 'http://localhost:3001',
      },
    },
  },
  preview: {
    host: 'localhost',
  },
  test: {
    include: ['src/**/__tests__/**/*.test.ts', 'server/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
