import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * UAT E2E 測試 config（租戶後台 + 平台管理後台），由 uat-e2e-tester agent 維護執行。
 * 跑法：npx playwright test --config playwright.uat.config.ts [--project=tenant|platform] [--grep @smoke]
 *
 * 前置：需先捕捉登入 session（UAT 登入頁有 captcha，測試不走登入頁）：
 *   npx tsx tests/e2e-uat/capture-auth-api.ts all        → 三角色（免 captcha，推薦）
 *   npx tsx tests/e2e-uat/capture-auth-platform.ts       → auth-state-platform.json（平台）
 *
 * ⚠️ 產出的 auth-state*.json 內含可換到有效 access token 的真實憑證，
 *    已列入 .gitignore，絕不可提交。
 */
/**
 * storage state 一律不進版控（內含可換 access token 的真實憑證，見 .gitignore）。
 * 缺檔時 Playwright 只會丟一句 ENOENT，看不出要怎麼補——這裡先擋下並說明。
 */
function assertStorageState(file: string): string {
  if (!existsSync(resolve(__dirname, file))) {
    throw new Error(
      `缺少 ${file}——storage state 不進版控，需先在本機產生：\n` +
        '  npx tsx tests/e2e-uat/capture-auth-api.ts all    （免 captcha，數秒完成三角色）\n' +
        '  npx tsx tests/e2e-uat/capture-auth-platform.ts   （平台後台）',
    );
  }
  return file;
}

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
      use: { ...devices['Desktop Chrome'], storageState: assertStorageState('auth-state.json') },
    },
    {
      name: 'platform',
      testMatch: /\/platform-[^/]+\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], storageState: assertStorageState('auth-state-platform.json') },
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
