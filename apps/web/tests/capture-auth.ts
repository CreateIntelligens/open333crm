/**
 * 一次性登入捕捉：開有頭瀏覽器，停在登入頁等你手動登入（含過 captcha），
 * 登入成功後把 session 存成 auth-state.json 供截圖腳本重用。
 *
 * 跑法：npx tsx tests/capture-auth.ts
 */
import { chromium } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
const BASE_URL = (process.env.MANUAL_BASE_URL || '').replace(/\/$/, '');
const STATE_PATH = path.resolve(__dirname, '../auth-state.json');

(async () => {
  if (!BASE_URL) throw new Error('缺少 .env.local 的 MANUAL_BASE_URL');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  console.log('\n============================================');
  console.log('👉 請在彈出的瀏覽器裡手動登入（完成 captcha 小遊戲）');
  console.log('   登入成功、看到「收件匣」後，這裡會自動偵測並存檔。');
  console.log('============================================\n');

  // 等你手動登入成功（側欄出現「收件匣」），最多等 5 分鐘
  await page.waitForSelector('text=收件匣', { timeout: 300_000 });
  await page.waitForTimeout(1500);

  await context.storageState({ path: STATE_PATH });
  console.log(`\n✅ 登入狀態已存到 ${STATE_PATH}`);
  console.log('   之後截圖腳本會自動重用，不必再登入。\n');
  await browser.close();
})();
