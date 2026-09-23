/**
 * 平台管理後台登入捕捉：開有頭瀏覽器停在 /admin/login 等手動登入，
 * 成功後把 session 存成 auth-state-platform.json 供 E2E 測試重用。
 *
 * 跑法：npx tsx tests/e2e-uat/capture-auth-platform.ts
 */
import { chromium } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
const BASE_URL = (process.env.MANUAL_BASE_URL || '').replace(/\/$/, '');
const STATE_PATH = path.resolve(__dirname, '../../auth-state-platform.json');

(async () => {
  if (!BASE_URL) throw new Error('缺少 .env.local 的 MANUAL_BASE_URL');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/admin/login`, { waitUntil: 'networkidle' });
  console.log('\n============================================');
  console.log('👉 請在彈出的瀏覽器裡登入平台管理後台');
  console.log('   登入成功、進到租戶列表後，這裡會自動偵測並存檔。');
  console.log('============================================\n');

  // 等手動登入成功（進到 /admin 內頁），最多等 5 分鐘
  await page.waitForURL(/\/admin\/(?!login)/, { timeout: 300_000 });
  await page.waitForTimeout(1500);

  await context.storageState({ path: STATE_PATH });
  console.log(`\n✅ 平台登入狀態已存到 ${STATE_PATH}\n`);
  await browser.close();
})();
