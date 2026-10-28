import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // src/: unit and property tests next to the code. test/: contract tests that read the repo's own specs.
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Property tests run 100+ async cases; under pnpm verify's parallel load 5 s is not enough (290 ms alone).
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__fixtures__/**'],
      // docs/TESTING.md: packages/shared ≥ 95% lines and branches.
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
});
