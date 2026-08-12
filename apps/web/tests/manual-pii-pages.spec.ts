import { test } from '@playwright/test';
import { login, goto, shotPage, sanitizeStrong } from './manual-helpers';

/**
 * 重拍含個資的頁面，用強力去識別化（模糊頭像 + 糊化姓名欄）。
 * 姓名欄選擇器：表格 tbody 每列的第一個 cell（聯繫人 / 姓名欄）。
 */
test('聯繫人頁（去識別化）', async ({ page }) => {
  await login(page);
  await goto(page, '/dashboard/contacts');
  await page.waitForTimeout(1500);
  await sanitizeStrong(page, ['table tbody tr td:first-child', 'table tbody tr th:first-child']);
  await shotPage(page, 'page-contacts');
});

test('工單頁（去識別化聯繫人欄）', async ({ page }) => {
  await login(page);
  await goto(page, '/dashboard/cases');
  await page.waitForTimeout(1500);
  // 工單表格「聯繫人」欄需糊化；用寬鬆做法糊化含中文名的 cell 較難，改糊整個聯繫人欄
  // 聯繫人欄是第 3 欄（ID/標題/聯繫人）
  await sanitizeStrong(page, ['table tbody tr td:nth-child(3)']);
  await shotPage(page, 'page-cases');
});
