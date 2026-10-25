import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Every suite runs inside workerd (Miniflare) with the D1 binding from wrangler.toml.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.toml' } })],
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'] } },
      { extends: true, test: { name: 'int', include: ['test/int/**/*.test.ts'] } },
    ],
    coverage: {
      // workerd has no V8 inspector: the Workers integration supports Istanbul only.
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
