import { defineConfig } from 'vitest/config';

// Root-level checks on the repo's own tooling. Package tests run from each package (turbo).
export default defineConfig({
  test: {
    name: 'tooling',
    // ESLint and tsx start-up per test; under pnpm verify's parallel load 5 s is not enough.
    testTimeout: 20_000,
    include: ['tests/tooling/**/*.test.ts'],
    environment: 'node',
  },
});
