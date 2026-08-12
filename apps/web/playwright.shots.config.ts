import { defineConfig, devices } from '@playwright/test';

/**
 * 手冊截圖專用 config（獨立於既有 E2E，不互相污染）
 * 跑法：npx playwright test --config=playwright.shots.config.ts tests/manual-xxx.spec.ts
 */
export default defineConfig({
  testDir: './tests',
  testMatch: /manual-.*\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  reporter: 'line',
  timeout: 90_000,
  use: {
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    storageState: 'auth-state.json',  // 重用已登入 session，跳過 captcha
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
