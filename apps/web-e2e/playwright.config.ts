import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for open333crm web QA.
 *
 * Spawns its own Next.js dev server on port 3020 (avoids clash with the dev port 3000/3010).
 * Assumes the API is already running on port 3001 + Postgres/Redis up via docker compose.
 *
 * Run:
 *   pnpm --filter @open333crm/web-e2e test            # all tests
 *   pnpm --filter @open333crm/web-e2e test:ui         # interactive UI mode
 *   pnpm --filter @open333crm/web-e2e report          # open last HTML report
 */
const PORT = Number(process.env.E2E_PORT ?? 3020);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,                 // login is sequential (single demo account)
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,                           // single-worker run keeps demo state stable
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    baseURL: BASE_URL,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',         // failure → full trace
    screenshot: 'only-on-failure',      // failure → auto screenshot (success uses explicit page.screenshot)
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // Spawn a fresh Next.js dev server isolated from the user's dev session.
    command: `cd ../web && pnpm exec next dev --port ${PORT}`,
    port: PORT,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
