import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // docs/TESTING.md: ≥ 80% outside the pure core (Step 3 raises the SDK to 95%).
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
