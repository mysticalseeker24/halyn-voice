import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { loadDotEnv, tidbUrl } from '../../scripts/lib/tidb.ts';

// Every suite runs inside workerd (Miniflare) with the bindings from wrangler.toml, plus test-only secrets.
const pure = { lines: 95, branches: 95 };

// The DB suite (ADR-013) runs against TiDB's halyn_test database when credentials exist (local .env, or the CI
// secret TIDB_TEST_DATABASE_URL); otherwise it skips with a warning. Every other suite is offline.
loadDotEnv();
const testDatabaseUrl = tidbUrl('halyn_test') ?? '';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          HALYN_TOOL_SECRET: 'test-tool-secret-0123456789abcdef0123456789',
          SESSION_SECRET: 'test-session-secret-0123456789abcdef01234567',
          TIDB_TEST_DATABASE_URL: testDatabaseUrl,
        },
      },
    }),
  ],
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'] } },
      // Worker and Durable Object start-up (and TiDB round trips) need more than the default 5 s on a busy machine.
      { extends: true, test: { name: 'int', include: ['test/int/**/*.test.ts'], testTimeout: 20_000 } },
      {
        extends: true,
        test: {
          name: 'db',
          include: ['test/db/**/*.test.ts'],
          globalSetup: ['../../scripts/test-db-setup.ts'],
          testTimeout: 30_000,
        },
      },
      { extends: true, test: { name: 'scenarios', include: ['test/scenarios/**/*.test.ts'] } },
    ],
    coverage: {
      // workerd has no V8 inspector: the Workers integration supports Istanbul only.
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // docs/TESTING.md: ≥ 95% lines and branches for the pure core, ≥ 80% elsewhere.
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
        'src/gate/**': pure,
        'src/grants/**': pure,
        'src/ledger/**': pure,
        'src/pass/**': pure,
        'src/signals/*-lexicon.ts': pure,
      },
    },
  },
});
