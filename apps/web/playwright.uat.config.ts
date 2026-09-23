import { defineConfig, devices } from '@playwright/test';

/**
 * UAT E2E 測試 config（租戶後台 + 平台管理後台），由 uat-e2e-tester agent 維護執行。
 * 跑法：npx playwright test --config playwright.uat.config.ts [--project=tenant|platform] [--grep @smoke]
 *
 * 前置：需先捕捉登入 session（UAT 登入頁有 captcha，測試不走登入頁）：
 *   npx tsx tests/capture-auth.ts                        → auth-state.json（租戶）
 *   npx tsx tests/e2e-uat/capture-auth-platform.ts       → auth-state-platform.json（平台）
 */
export default defineConfig({
  testDir: './tests/e2e-uat',
  workers: 1, // UAT rotating token 經不起並行 session
  fullyParallel: false,
  reporter: [['line'], ['html', { outputFolder: 'playwright-report-uat', open: 'never' }]],
  timeout: 60_000,
  use: {
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'tenant',
      // 錨定檔名開頭：不錨定會誤抓 cross-tenant-lifecycle.spec.ts（含 tenant- 子字串）
      testMatch: /\/tenant-[^/]+\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], storageState: 'auth-state.json' },
    },
    {
      name: 'platform',
      testMatch: /\/platform-[^/]+\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], storageState: 'auth-state-platform.json' },
    },
    {
      // 跨平台互動測試：不綁 storageState，spec 內自行用
      // openTenantContext / openPlatformContext 同時開兩個身分的 context
      name: 'cross',
      testMatch: /\/cross-[^/]+\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
