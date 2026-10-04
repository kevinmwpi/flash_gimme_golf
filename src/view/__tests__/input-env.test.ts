// OWNER: input-loop
// Regression: Node 21+ defines a global `navigator` (without `maxTouchPoints`) but no `window`. Creating the
// input system there, as the contract test does, must not touch `window`. Stubbing `navigator` makes this
// fail on every Node version, not only on the Node 22 that CI runs.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInputSystem } from '../input/index';

describe('createInputSystem outside a browser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not touch window when navigator exists without touch support (Node 21+)', () => {
    vi.stubGlobal('navigator', { userAgent: 'Node.js' });
    expect(typeof window).toBe('undefined');
    expect(() => createInputSystem()).not.toThrow();
  });
});
