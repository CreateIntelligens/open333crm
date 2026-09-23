import { test, expect } from '@playwright/test';
import { gotoAndCheck } from './helpers';

/**
 * 平台管理後台全頁 smoke。
 * ⚠️ 平台後台有租戶停用/方案變更等破壞性操作——smoke 只驗載入，絕不按確認。
 */
const PAGES: Array<{ path: string; name: string }> = [
  { path: '/admin/tenants', name: '租戶管理' },
  { path: '/admin/plans', name: '方案管理' },
  { path: '/admin/plan-changes', name: '方案異動' },
  { path: '/admin/trial', name: '試用管理' },
  { path: '/admin/usage', name: '用量統計' },
];

for (const p of PAGES) {
  test(`@smoke 平台後台「${p.name}」頁可載入 (${p.path})`, async ({ page }) => {
    const consoleErrors = await gotoAndCheck(page, p.path);
    // .first() 避免多元素 strict mode violation
    await expect(page.locator('main, [role="main"], table, body').first()).not.toBeEmpty();
    expect(consoleErrors, `console 錯誤：\n${consoleErrors.join('\n')}`).toHaveLength(0);
  });
}
