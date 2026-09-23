/**
 * 依角色捕捉登入 session：開有頭瀏覽器停在 /login 等手動登入（含過 captcha），
 * 成功後把 session 存成 auth-state-<role>.json 供 RBAC E2E 測試重用。
 *
 * 跑法：npx tsx tests/e2e-uat/capture-auth-role.ts supervisor
 *      npx tsx tests/e2e-uat/capture-auth-role.ts agent
 */
import { chromium } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
const BASE_URL = (process.env.MANUAL_BASE_URL || '').replace(/\/$/, '');

const role = process.argv[2];
if (role !== 'supervisor' && role !== 'agent') {
  console.error('用法：npx tsx tests/e2e-uat/capture-auth-role.ts <supervisor|agent>');
  process.exit(1);
}
const STATE_PATH = path.resolve(__dirname, `../../auth-state-${role}.json`);

(async () => {
  if (!BASE_URL) throw new Error('缺少 .env.local 的 MANUAL_BASE_URL');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  console.log('\n============================================');
  console.log(`👉 請在彈出的瀏覽器裡用「${role.toUpperCase()}」角色帳號手動登入（完成 captcha 小遊戲）`);
  console.log('   登入成功、看到「收件匣」後，這裡會自動偵測並存檔。');
  console.log('============================================\n');

  await page.waitForSelector('text=收件匣', { timeout: 300_000 });
  await page.waitForTimeout(1500);

  await context.storageState({ path: STATE_PATH });
  console.log(`\n✅ 登入狀態已存到 ${STATE_PATH}\n`);
  await browser.close();
})();
