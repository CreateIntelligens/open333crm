// 連 CDP Chrome，在其中開前端、操作到「欄位說明」對話框並截圖。
// 若未登入會提示。跑法：node apps/web/tests/preview-field-guide.mjs
import { chromium } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../../../preview-field-guide.png');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  console.log('→ 開前端渠道設定頁...');
  await page.goto('http://localhost:3000/dashboard/settings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // 判斷是否在登入頁
  if (page.url().includes('/login')) {
    console.log('⚠️ 未登入（停在 /login）。請在 CDP Chrome 手動登入 open333 後重跑本腳本。');
    await page.screenshot({ path: OUT });
    console.log(`  已截登入頁：${OUT}`);
    await browser.close();
    return;
  }

  // 點「新增渠道」
  console.log('→ 點新增渠道...');
  const addBtn = page.locator('button:has-text("新增渠道")').first();
  await addBtn.click();
  await page.waitForTimeout(800);

  // 確保渠道類型是 LINE（預設就是），點「欄位說明」
  console.log('→ 點欄位說明...');
  const guideLink = page.locator('button:has-text("欄位說明")').first();
  if (!(await guideLink.count())) {
    console.log('⚠️ 找不到「欄位說明」連結，截目前畫面除錯');
    await page.screenshot({ path: OUT });
    await browser.close();
    return;
  }
  await guideLink.click();
  await page.waitForTimeout(1000);

  await page.screenshot({ path: OUT, fullPage: false });
  console.log(`✅ 已截「欄位說明」對話框：${OUT}`);
  await browser.close();
})().catch((e) => { console.error('💥', e.message); process.exit(1); });
