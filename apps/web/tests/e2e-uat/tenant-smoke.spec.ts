import { test, expect } from '@playwright/test';
import { gotoAndCheck } from './helpers';

/**
 * 租戶後台全頁 smoke：每頁載入成功、非登入頁、console 無未捕捉錯誤。
 * 深入的功能驗收放各頁專屬 spec（tenant-<頁名>.spec.ts）。
 */
const PAGES: Array<{ path: string; name: string }> = [
  { path: '/dashboard', name: '儀表板首頁' },
  { path: '/dashboard/inbox', name: '收件匣' },
  { path: '/dashboard/contacts', name: '聯絡人' },
  { path: '/dashboard/cases', name: '案件' },
  { path: '/dashboard/automation', name: '自動化' },
  { path: '/dashboard/marketing', name: '行銷' },
  // 注意：/dashboard/line 沒有根 page.tsx（404 by design），側欄入口是 rich-menus
  { path: '/dashboard/line/rich-menus', name: 'LINE 素材（圖文選單）' },
  { path: '/dashboard/knowledge', name: '知識庫' },
  { path: '/dashboard/analytics', name: '數據分析' },
  { path: '/dashboard/notifications', name: '通知' },
  { path: '/dashboard/shortlinks', name: '短連結' },
  { path: '/dashboard/portal', name: '粉絲門戶' },
  { path: '/dashboard/plan', name: '方案' },
  { path: '/dashboard/settings', name: '設定' },
];

for (const p of PAGES) {
  test(`@smoke 租戶後台「${p.name}」頁可載入 (${p.path})`, async ({ page }) => {
    const consoleErrors = await gotoAndCheck(page, p.path);
    // 主內容區有渲染東西（不是空白頁/錯誤頁）；.first() 避免多元素 strict mode violation
    await expect(page.locator('main, [role="main"], .dashboard, body').first()).not.toBeEmpty();
    expect(consoleErrors, `console 錯誤：\n${consoleErrors.join('\n')}`).toHaveLength(0);
  });
}
