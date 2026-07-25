/**
 * ESLint flat config (audit F4).
 *
 * A small set of rules chosen to catch the classes of bug that have actually bitten this
 * codebase — a variable shadow shipped once (`stage`/`flipStage`) and was caught only by
 * Windows test ordering. `eslint` and its data-only companion `globals` are the two
 * dev-tooling additions F4 approves onto the §4.3 allowlist.
 *
 * Globals are declared broadly (browser + node + worker + ES built-ins) rather than per
 * directory: over-declaring only makes `no-undef` slightly less strict about environment
 * mismatch, while under-declaring produces false positives — and the rules that earn their
 * keep here (no-shadow, no-var, prefer-const, eqeqeq, no-unused-vars) do not depend on it.
 */
import globals from 'globals';

const ambient = {
  ...globals.browser,
  ...globals.node,
  ...globals.worker,
  ...globals.serviceworker,
  ...globals.es2025,
};

export default [
  {
    ignores: [
      'node_modules/**',
      'app/assets/bundle.js', // esbuild output
      'app/assets/dict-worker.js', // esbuild output (F3)
      'app/sw.js', // built from app/src/sw.js
      '**/.wrangler/**', // wrangler dev/deploy scratch bundles
      '.venv/**',
      'coverage/**',
      'packs/zh/data/**',
      'packs/zh/audio/**', // Python + generated
    ],
  },
  {
    // The service worker reads a build-time constant esbuild replaces via --define (§9).
    files: ['app/src/sw.js'],
    languageOptions: { globals: { __PACK_VERSION__: 'readonly' } },
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: ambient,
    },
    rules: {
      'no-shadow': 'error',
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true, caughtErrors: 'none' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }], // `x != null` stays idiomatic
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
];
