// OWNER: tooling
// Keeps the Fly deploy config in step with the server: rooms are process-local (one machine) and the
// proxy's connection cap must not sit below what LIMITS lets the server hold.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/net/protocol';

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const FLY_TOML = read('../../fly.toml');
const DEPLOY_YML = read('../../.github/workflows/fly-deploy.yml');

/** Reads `key = value` from the named TOML table (up to the next table header). */
function tomlValue(table: string, key: string): string | undefined {
  const start = FLY_TOML.indexOf(`[${table}]`);
  if (start < 0) return undefined;
  const body = FLY_TOML.slice(start + table.length + 2).split(/^\s*\[/m)[0] ?? '';
  return new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n]+?)"?\\s*$`, 'm').exec(body)?.[1];
}

describe('fly deploy config', () => {
  it('caps proxied connections per machine above two sockets per room', () => {
    expect(tomlValue('http_service.concurrency', 'type')).toBe('connections');
    const soft = Number(tomlValue('http_service.concurrency', 'soft_limit'));
    const hard = Number(tomlValue('http_service.concurrency', 'hard_limit'));
    expect(soft).toBeGreaterThanOrEqual(LIMITS.maxRooms * 2);
    expect(hard).toBeGreaterThan(soft);
  });

  it('deploys without HA spares and pins the app to one machine', () => {
    expect(DEPLOY_YML).toMatch(/flyctl deploy --remote-only --ha=false/);
    expect(DEPLOY_YML).toMatch(/flyctl scale count 1 --yes/);
  });

  it('names the deploy step the way the live-commit lookup matches it', () => {
    expect(DEPLOY_YML).toMatch(/- name: flyctl deploy\r?\n/);
    expect(DEPLOY_YML).toMatch(/contains\("flyctl deploy"\)/);
  });
});
