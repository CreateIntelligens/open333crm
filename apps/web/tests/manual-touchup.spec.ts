import { test } from '@playwright/test';
import { login, goto, shotPage, sanitize } from './manual-helpers';

/** automation：糊化含「louis」的測試規則列（內部人名，對外觀感） */
test('自動化頁（糊化測試規則）', async ({ page }) => {
  await login(page);
  await goto(page, '/dashboard/automation');
  await page.waitForTimeout(1500);
  await sanitize(page);
  // 糊化名稱或描述含 louis 的整列
  await page.evaluate(() => {
    document.querySelectorAll('table tbody tr').forEach((tr) => {
      if (/louis/i.test(tr.textContent || '')) {
        (tr as HTMLElement).style.filter = 'blur(5px)';
      }
    });
  });
  await page.waitForTimeout(300);
  await shotPage(page, 'page-automation');
});

/** shortlinks：糊化目標 URL 欄（可能含個人網域） */
test('短連結頁（糊化目標 URL）', async ({ page }) => {
  await login(page);
  await goto(page, '/dashboard/shortlinks');
  await page.waitForTimeout(1500);
  await sanitize(page);
  await page.addStyleTag({
    content: 'table tbody tr td:nth-child(3){filter:blur(5px)!important;}',
  });
  await page.waitForTimeout(300);
  await shotPage(page, 'page-shortlinks');
});
