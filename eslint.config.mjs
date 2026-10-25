// Root ESLint flat config. ESLint 10 looks up config from each file's directory, so every package
// uses this file unless it has its own (apps/web extends it with the Next.js rules).
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Pure modules (CLAUDE.md §6): no I/O, no clock, no randomness. Inject `clock` and `rng` instead.
export const pureFiles = [
  'apps/api/src/gate/**',
  'apps/api/src/grants/**',
  'apps/api/src/ledger/**',
  'apps/api/src/pass/**',
  'packages/shared/src/**',
];

const pureMessage = 'Pure module (CLAUDE.md §6): no I/O. Pass data, `clock` and `rng` in from the caller.';

export const pureRules = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        { regex: '(^|/)(db|bolna|hub|core-client)(/|$)', message: pureMessage },
        { regex: '^(cloudflare|node):', message: pureMessage },
        {
          regex:
            '^(fs|path|http|https|http2|net|tls|dns|dgram|child_process|cluster|os|crypto|stream|worker_threads)(/|$)',
          message: pureMessage,
        },
        { regex: '^(hono|drizzle-orm|drizzle-kit|@tidbcloud|mysql2|undici|ws)(/|$)', message: pureMessage },
        { regex: '^@halyn/(api|aero-core|web)(/|$)', message: pureMessage },
      ],
    },
  ],
  'no-restricted-globals': [
    'error',
    ...['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'caches', 'setTimeout', 'setInterval'].map(
      (name) => ({ name, message: pureMessage }),
    ),
  ],
  'no-restricted-properties': [
    'error',
    { object: 'Date', property: 'now', message: 'Pure module: take time from the injected `clock`.' },
    { object: 'Math', property: 'random', message: 'Pure module: take randomness from the injected `rng`.' },
    { object: 'crypto', property: 'getRandomValues', message: 'Pure module: use the injected `rng`.' },
    { object: 'crypto', property: 'randomUUID', message: 'Pure module: use the injected `rng`.' },
    { object: 'performance', property: 'now', message: 'Pure module: take time from the injected `clock`.' },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: 'Pure module: take time from the injected `clock`.',
    },
    {
      selector: "CallExpression[callee.name='Date']",
      message: 'Pure module: take time from the injected `clock`.',
    },
  ],
};

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/.next/',
    '**/.turbo/',
    '**/.wrangler/',
    '**/.vitest/',
    '**/coverage/',
    '**/playwright-report/',
    '**/test-results/',
    '**/worker-configuration.d.ts',
    '**/next-env.d.ts',
    'policy-packs/compiled/',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Tool configs live outside the package tsconfig projects; lint them without type information.
    files: ['**/*.config.{ts,mts,cts}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  { files: pureFiles, rules: pureRules },
  prettier,
]);
