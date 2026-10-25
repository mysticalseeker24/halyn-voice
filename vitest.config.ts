import { defineConfig } from 'vitest/config';

// Root-level checks on the repo's own tooling. Package tests run from each package (turbo).
export default defineConfig({
  test: {
    name: 'tooling',
    include: ['tests/tooling/**/*.test.ts'],
    environment: 'node',
  },
});
