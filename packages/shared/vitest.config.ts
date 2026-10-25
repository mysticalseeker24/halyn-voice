import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // docs/TESTING.md: packages/shared ≥ 95% lines and branches.
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
});
