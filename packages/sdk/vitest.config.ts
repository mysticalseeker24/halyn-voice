import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__fixtures__/**'],
      // PROMPTS.md Step 3: the SDK a bank installs is held to the pure-module bar.
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
});
