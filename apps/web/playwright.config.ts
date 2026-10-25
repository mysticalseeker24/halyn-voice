import { defineConfig, devices } from '@playwright/test';

const port = 3100;
const ci = Boolean(process.env.CI);

// Runs against the production build (`turbo run test:e2e` builds first).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next start --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
});
