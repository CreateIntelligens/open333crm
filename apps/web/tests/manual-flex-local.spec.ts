import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 本機（localhost）Flex 新介面截圖 spec，供操作手冊 ch06 使用。
 * 與既有 manual-*.spec.ts 走 UAT + storageState 不同：本機無 captcha，
 * 這支自己走登入頁登入，並把畫面的浮動元素/工具列雜訊藏掉，維持與現有
 * 手冊截圖一致的乾淨風格（1440×900、無通知紅點/浮動 widget）。
 *
 * 跑法（本機 WEB:3000 / API:3001 需先起）：
 *   FLEX_SHOWCASE_ID=xxx FLEX_TEMPLATE_ID=yyy \
 *   npx playwright test --config=playwright.shots.config.ts tests/manual-flex-local.spec.ts
 */

// 預設值為本機 dev seed 帳號（非真實憑證）；可用環境變數覆寫以適應不同本機環境。
const BASE = process.env.MANUAL_LOCAL_BASE || 'http://localhost:3000';
const EMAIL = process.env.MANUAL_LOCAL_EMAIL || 'admin@open333crm.dev';
const PASSWORD = process.env.MANUAL_LOCAL_PASSWORD || 'Admin1234!';
const SHOWCASE_ID = process.env.FLEX_SHOWCASE_ID || '';
const TEMPLATE_ID = process.env.FLEX_TEMPLATE_ID || '';
const SHOTS_DIR = path.resolve(__dirname, '..', 'public/manual/uploads/shots');

fs.mkdirSync(SHOTS_DIR, { recursive: true });

/** 藏掉會干擾截圖的浮動 / 工具列雜訊（通知紅點、操作說明、右下 widget、左下 issue 標記） */
async function hideChrome(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    // 通用：藏掉所有 position:fixed/sticky-to-viewport 的浮動層
    // （右下客服 widget、右側主題切換條、左下 dev issue 標記）。排除主側欄/topbar（它們是 sticky 版面）。
    document.querySelectorAll('body *').forEach((el) => {
      const cs = getComputedStyle(el as Element);
      const rect = (el as HTMLElement).getBoundingClientRect();
      // fixed 且尺寸小（浮動小工具，非整條側欄/topbar）→ 藏
      if (cs.position === 'fixed' && rect.width < 400 && rect.height < 400) {
        (el as HTMLElement).style.display = 'none';
      }
    });
    // Topbar 右側的操作說明 / Skill / 通知鈴鐺（含未讀紅點）——找 topbar 內帶這些文字/aria 的按鈕
    const killTexts = ['操作說明', 'Skill'];
    document.querySelectorAll('header a, header button').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (killTexts.some((k) => t.includes(k))) (el as HTMLElement).style.visibility = 'hidden';
      // 通知鈴鐺（含紅點 badge）：按鈕內有數字 badge
      if (el.querySelector('[class*="badge" i]') || /^\d+$/.test(t)) (el as HTMLElement).style.visibility = 'hidden';
    });
  });
  await page.waitForTimeout(200);
}

test.beforeEach(async ({ page }) => {
  // 沒指定任何素材 id 時整個檔案跳過——連登入都不做，避免 CI 或 `playwright test` 全掃時
  // 對未啟動的本機服務發起連線而 timeout（此為本機手動截圖工具，非常規 CI 測試）。
  test.skip(!SHOWCASE_ID && !TEMPLATE_ID, '需指定 FLEX_SHOWCASE_ID 或 FLEX_TEMPLATE_ID（本機截圖工具）');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  // 若已登入會被導走；沒登入才填表單
  if (page.url().includes('/login')) {
    await page.getByPlaceholder('agent@example.com').fill(EMAIL);
    await page.getByPlaceholder('請輸入密碼').fill(PASSWORD);
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  }
});

test('Flex 精選範本：空狀態雙起手（AI 生成 + 從範本建立）', async ({ page }) => {
  test.skip(!SHOWCASE_ID, '需 FLEX_SHOWCASE_ID');
  await page.goto(`${BASE}/dashboard/marketing/materials/${SHOWCASE_ID}`, { waitUntil: 'networkidle' });
  await expect(page.getByPlaceholder('如：母親節新品推播')).toBeVisible({ timeout: 15_000 });
  await hideChrome(page);
  await page.waitForTimeout(500);
  // 截「訊息內容」那塊（含 AI 生成紫框 + 從範本建立），避免整頁工具列
  const block = page.locator('text=用 AI 描述生成').locator('xpath=ancestor::div[contains(@class,"space-y")][1]');
  await block.first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS_DIR, 'materials-flex-empty.png') });
  console.log('✓ materials-flex-empty.png');
});

test('Flex 精選範本：選範本 dialog（9 官方範本）', async ({ page }) => {
  test.skip(!SHOWCASE_ID, '需 FLEX_SHOWCASE_ID');
  await page.goto(`${BASE}/dashboard/marketing/materials/${SHOWCASE_ID}`, { waitUntil: 'networkidle' });
  await expect(page.getByPlaceholder('如：母親節新品推播')).toBeVisible({ timeout: 15_000 });
  const openBtn = page.getByRole('button', { name: '從範本建立', exact: true });
  await openBtn.scrollIntoViewIfNeeded();
  await openBtn.click();
  await expect(page.getByRole('dialog').getByText('從範本建立')).toBeVisible({ timeout: 10_000 });
  await hideChrome(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS_DIR, 'dlg-flex-picker.png') });
  console.log('✓ dlg-flex-picker.png');
});

test('Flex 填空編輯器：業務區塊分組（套範本後）', async ({ page }) => {
  test.skip(!SHOWCASE_ID, '需 FLEX_SHOWCASE_ID');
  await page.goto(`${BASE}/dashboard/marketing/materials/${SHOWCASE_ID}`, { waitUntil: 'networkidle' });
  await expect(page.getByPlaceholder('如：母親節新品推播')).toBeVisible({ timeout: 15_000 });
  // 套第一個範本（餐廳介紹）進填空編輯器
  const openBtn = page.getByRole('button', { name: '從範本建立', exact: true });
  await openBtn.scrollIntoViewIfNeeded();
  await openBtn.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('從範本建立')).toBeVisible({ timeout: 10_000 });
  // 點「餐廳介紹」範本卡（role=button div，含範本名）
  await dialog.getByRole('button').filter({ hasText: '餐廳介紹' }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '選擇', exact: true }).click();
  // 等填空編輯器出現（「標題與內文」分組）
  await expect(page.getByText('標題與內文').first()).toBeVisible({ timeout: 10_000 });
  await hideChrome(page);
  await page.getByText('訊息內容').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS_DIR, 'materials-flex-editor.png') });
  console.log('✓ materials-flex-editor.png');
});

test('Flex AI 潤稿選單（潤飾/縮短/換語氣）', async ({ page }) => {
  test.skip(!SHOWCASE_ID, '需 FLEX_SHOWCASE_ID');
  await page.goto(`${BASE}/dashboard/marketing/materials/${SHOWCASE_ID}`, { waitUntil: 'networkidle' });
  await expect(page.getByPlaceholder('如：母親節新品推播')).toBeVisible({ timeout: 15_000 });
  // 套餐廳範本以取得有文字的欄位
  const openBtn = page.getByRole('button', { name: '從範本建立', exact: true });
  await openBtn.scrollIntoViewIfNeeded();
  await openBtn.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('從範本建立')).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button').filter({ hasText: '餐廳介紹' }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '選擇', exact: true }).click();
  await expect(page.getByText('標題與內文').first()).toBeVisible({ timeout: 10_000 });
  await hideChrome(page);
  // 找第一個啟用的「AI 潤稿」鈕（有文字的欄位），捲進視野後點開選單
  const rewriteBtn = page.locator('button[title="AI 潤稿"]:not([disabled])').first();
  await rewriteBtn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await rewriteBtn.click();
  await expect(page.getByText('潤飾', { exact: true })).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(300);
  // 截潤稿鈕所在欄位附近（含彈出選單）
  await page.screenshot({ path: path.join(SHOTS_DIR, 'dlg-flex-rewrite.png') });
  console.log('✓ dlg-flex-rewrite.png');
});

test('Flex JSON 匯入編輯器', async ({ page }) => {
  test.skip(!TEMPLATE_ID, '需 FLEX_TEMPLATE_ID');
  await page.goto(`${BASE}/dashboard/marketing/materials/${TEMPLATE_ID}`, { waitUntil: 'networkidle' });
  await expect(page.getByPlaceholder('如：母親節新品推播')).toBeVisible({ timeout: 15_000 });
  await hideChrome(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS_DIR, 'materials-flex-json.png') });
  console.log('✓ materials-flex-json.png');
});
