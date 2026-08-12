import { test } from '@playwright/test';
import { login, goto, shotPage, sanitize } from './manual-helpers';

// 逐頁列表截圖（正式站，已用 storageState 登入）
const PAGES: Array<{ path: string; name: string; wait?: number }> = [
  { path: '/dashboard/inbox', name: 'inbox' },
  { path: '/dashboard/cases', name: 'cases' },
  { path: '/dashboard/contacts', name: 'contacts' },
  { path: '/dashboard/automation', name: 'automation' },
  { path: '/dashboard/knowledge', name: 'knowledge' },
  { path: '/dashboard/marketing', name: 'marketing' },
  { path: '/dashboard/marketing/materials', name: 'materials' },
  { path: '/dashboard/line/rich-menus', name: 'line-richmenu' },
  { path: '/dashboard/line/keyword-replies', name: 'line-keyword' },
  { path: '/dashboard/line/quick-replies', name: 'line-quickreply' },
  { path: '/dashboard/portal', name: 'portal' },
  { path: '/dashboard/shortlinks', name: 'shortlinks' },
  { path: '/dashboard/analytics', name: 'analytics' },
  { path: '/dashboard/analytics/my', name: 'analytics-my' },
  { path: '/dashboard/settings', name: 'settings' },
];

test('逐頁列表截圖', async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);
  for (const p of PAGES) {
    try {
      await goto(page, p.path);
      await page.waitForTimeout(p.wait || 1500);
      await sanitize(page);
      await shotPage(page, `page-${p.name}`);
    } catch (e) {
      console.log(`✗ ${p.name}: ${(e as Error).message.slice(0, 80)}`);
    }
  }
});
