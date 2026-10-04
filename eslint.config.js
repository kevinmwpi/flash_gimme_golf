// ESLint flat config. Enforces the ARCH.md §0 dependency rule with no-restricted-imports (regex
// patterns per directory) on top of typescript-eslint recommended + react-hooks. A later block
// REPLACES the rule entry of an earlier block for the same file, so every narrower block repeats
// the bans of the directory it lives in.
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/** Anything that is not a relative import (an npm package), or that reaches another layer. */
const SIM_BANS = '^[^.]|/(view|ui|net|server)/';

/** @param {string} regex @param {string} message @param {boolean} [allowTypeImports] */
const forbid = (regex, message, allowTypeImports = false) => ({
  '@typescript-eslint/no-restricted-imports': ['error', { patterns: [{ regex, message, allowTypeImports }] }],
});

export default tseslint.config(
  { ignores: ['dist/**', 'dist-server/**', 'node_modules/**', 'design/**', 'public/**', 'coverage/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
      '@typescript-eslint/consistent-type-imports': ['warn', { fixStyle: 'inline-type-imports' }],
      'no-console': 'error',
      'no-restricted-globals': ['error', 'event', 'name'],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs['recommended-latest'].rules },
  },
  {
    // sim/* -> sim/* only; no packages, no DOM, no Date, no Math.random (grep-tested by sim-purity.test.ts)
    files: ['src/sim/**/*.ts'],
    ignores: ['src/sim/__tests__/**'],
    rules: {
      ...forbid(SIM_BANS, 'src/sim may import only from src/sim (ARCH.md §0).'),
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'The sim is deterministic: use sim/rng.ts.' },
        { object: 'Math', property: 'hypot', message: 'Banned for cross-engine determinism; use vec.len.' },
        { object: 'Math', property: 'pow', message: 'Banned for cross-engine determinism; multiply.' },
        { object: 'Date', property: 'now', message: 'No wall clock inside the sim.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "BinaryExpression[operator='**']", message: 'Banned for cross-engine determinism; multiply.' },
        { selector: "CallExpression[callee.property.name='toFixed']", message: 'Use quantize2/4/1 from types.ts.' },
        { selector: 'MetaProperty', message: 'import.meta is banned inside the sim.' },
      ],
    },
  },
  {
    // sim/levels/* -> sim/types, sim/terrain, sim/levels/authoring (+ sibling level files from index.ts)
    files: ['src/sim/levels/**/*.ts'],
    rules: forbid(
      `${SIM_BANS}|^\\.\\./(sim|physics|serialize|rng)$`,
      'Level files may import only sim/types, sim/terrain and levels/authoring (ARCH.md §0).',
    ),
  },
  {
    // net/protocol.ts -> sim/types only
    files: ['src/net/protocol.ts'],
    rules: forbid('^(?!\\.\\./sim/types$)', 'protocol.ts may import only ../sim/types (ARCH.md §0).'),
  },
  {
    // net/GameClient -> net/protocol, net/wsUrl, sim/types, sim/serialize
    files: ['src/net/GameClient.ts'],
    rules: forbid(
      '^(?!(\\./protocol|\\./wsUrl|\\.\\./sim/types|\\.\\./sim/serialize)$)\\.',
      'GameClient may import only net/protocol, net/wsUrl, sim/types, sim/serialize (ARCH.md §0).',
    ),
  },
  {
    // view/* -> sim/* (read-only), view/*; net types only (GameCanvas session types); never ui/server
    files: ['src/view/**/*.{ts,tsx}'],
    ignores: ['src/view/__tests__/**'],
    rules: forbid('/(ui|server)/|/net/', 'src/view may import only sim/* and view/* (net types only) (ARCH.md §0).', true),
  },
  {
    // view/input/* -> sim/types, sim/sim (allowedCommands, canControl, seatOf), view/view (screenToWorld), siblings
    files: ['src/view/input/**/*.ts'],
    rules: forbid(
      '/(ui|server)/|/net/|/sim/(physics|terrain|serialize|rng)$|/sim/levels|/view/(render|audio|GameCanvas)',
      'src/view/input may import only sim/types, sim/sim, view/view and its siblings (ARCH.md §0).',
      true,
    ),
  },
  {
    // ui/* -> sim/types, sim/levels (LEVELS/WORLD1_IDS), view/audio, net/GameClient types, ui/*
    files: ['src/ui/**/*.{ts,tsx}'],
    ignores: ['src/ui/__tests__/**'],
    rules: forbid(
      '/sim/levels/w1-|/sim/(physics|terrain|serialize|rng)$|/view/(render|input)/|/server/',
      'src/ui may import only sim/types, sim/levels/index, view/audio, net types and ui/* (ARCH.md §0).',
      true,
    ),
  },
  {
    // server/* -> sim/*, net/protocol; never view/ui
    files: ['server/**/*.ts'],
    rules: forbid('/(view|ui)/|/net/(?!protocol$)', 'server may import only sim/* and net/protocol (ARCH.md §0).'),
  },
);
