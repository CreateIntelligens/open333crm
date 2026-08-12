import { Page, Locator } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

export const BASE_URL = (process.env.MANUAL_BASE_URL || '').replace(/\/$/, '');
export const EMAIL = process.env.MANUAL_EMAIL || '';
export const PASSWORD = process.env.MANUAL_PASSWORD || '';
export const ACCESS_TOKEN = process.env.MANUAL_ACCESS_TOKEN || '';
export const SHOTS_DIR = path.resolve(
  __dirname,
  '..',
  process.env.MANUAL_SHOTS_DIR || 'public/manual/uploads/shots',
);

fs.mkdirSync(SHOTS_DIR, { recursive: true });

/** 登入後台，含成功檢查（失敗直接 throw，避免默默截登入頁） */
export async function login(page: Page) {
  if (!BASE_URL) throw new Error('缺少 .env.local 的 MANUAL_BASE_URL');
  // config 已用 storageState 帶入登入 session，這裡只導到後台確認
  await page.goto(`${BASE_URL}/dashboard/inbox`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const ok = await page
    .waitForSelector('text=收件匣', { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) throw new Error('登入狀態失效——請重跑 tests/capture-auth.ts 重新捕捉 session');
}

/** 去識別化：截圖前就地改 DOM，遮蔽 Email / 姓名跑馬燈等個資 */
export async function sanitize(page: Page) {
  await page.evaluate(() => {
    const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const ns: Text[] = [];
    let n: Node | null;
    while ((n = w.nextNode())) ns.push(n as Text);
    for (const node of ns) {
      let t = node.textContent || '';
      const orig = t;
      if (emailRe.test(t)) t = t.replace(emailRe, 'member@example.com');
      // 手機號碼（台灣 09 開頭 / 一般長數字串）
      t = t.replace(/09\d{2}[-\s]?\d{3}[-\s]?\d{3}/g, '09xx-xxx-xxx');
      // 最新訊息 / 最新操作跑馬燈含真人名
      t = t.replace(/(最新訊息[：:]\s*)[^｜|]+/g, '$1（已隱藏）');
      t = t.replace(/(最新操作[：:]\s*)\S+/g, '$1（已隱藏）');
      if (t !== orig) node.textContent = t;
    }
  });
}

/**
 * 強力去識別化：模糊所有頭像圖片 + 糊化指定選擇器（姓名欄等）。
 * 用於聯繫人 / 工單這類會露真人名與頭像的頁面。
 * blurSelectors：要整塊模糊的 CSS 選擇器（如表格第一欄的姓名 cell）。
 */
export async function sanitizeStrong(page: Page, blurSelectors: string[] = []) {
  await sanitize(page);
  // 模糊所有 img（頭像照片）與帶背景圖的圓形頭像
  await page.addStyleTag({
    content: `
      img { filter: blur(8px) !important; }
      [class*="avatar"], [class*="Avatar"] { filter: blur(8px) !important; }
      ${blurSelectors.map((s) => `${s}{filter:blur(6px)!important;}`).join('\n')}
    `,
  });
  await page.waitForTimeout(300);
}

/** 局部截圖：截某個元件而非整頁 */
export async function shot(page: Page, locator: Locator, name: string) {
  const count = await locator.count();
  if (!count) {
    console.log(`✗ ${name}：找不到元素`);
    return false;
  }
  await locator.first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500);
  await sanitize(page);
  await locator.first().screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });
  console.log(`✓ ${name}.png`);
  return true;
}

/** 整頁截圖（列表頁用），去識別化後拍可視區 */
export async function shotPage(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(600);
  await sanitize(page);
  await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`), fullPage });
  console.log(`✓ ${name}.png`);
}

/** 導到後台某路徑並等穩定 */
export async function goto(page: Page, pathname: string) {
  await page.goto(`${BASE_URL}${pathname}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
}
