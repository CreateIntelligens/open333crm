import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { snap } from './helpers/screenshot';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('settings page renders', async ({ page }, testInfo) => {
    await page.goto('/dashboard/settings');
    await expect(page).toHaveURL(/\/dashboard\/settings/);
    await page.waitForLoadState('networkidle');
    await snap(page, testInfo, 'settings-overview');
  });

  test('switch through main tabs', async ({ page }, testInfo) => {
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    const tabs = ['通用', '渠道', '客服', '團隊', '標籤', 'SLA', 'API Keys', '營業時間'];
    for (const t of tabs) {
      const tab = page.getByRole('tab', { name: t }).or(page.getByRole('button', { name: t })).first();
      if ((await tab.count()) > 0 && (await tab.isVisible().catch(() => false))) {
        await tab.click();
        await page.waitForTimeout(400);
      }
    }
    await snap(page, testInfo, 'settings-tabs');
  });
});
