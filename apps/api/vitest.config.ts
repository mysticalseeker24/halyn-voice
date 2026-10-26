import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Every suite runs inside workerd (Miniflare) with the bindings from wrangler.toml.
const pure = { lines: 95, branches: 95 };

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.toml' } })],
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'] } },
      { extends: true, test: { name: 'int', include: ['test/int/**/*.test.ts'] } },
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
