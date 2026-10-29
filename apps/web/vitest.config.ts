import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    // Packages run in parallel under `pnpm verify`; jsdom + userEvent tests crossed 5 s there (docs/HANDOFF.md 15).
    testTimeout: 20_000,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // Pages and layouts are covered by Playwright (e2e/); shadcn primitives are vendored.
      include: ['src/components/**/*.{ts,tsx}', 'src/lib/**/*.{ts,tsx}'],
      exclude: ['src/components/ui/**', 'src/test/**', 'src/**/*.test.{ts,tsx}'],
      thresholds: { lines: 60, branches: 60, functions: 60, statements: 60 },
    },
  },
});
