import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { snap } from './helpers/screenshot';

test.describe('Marketing', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('marketing landing renders', async ({ page }, testInfo) => {
    await page.goto('/dashboard/marketing');
    await expect(page).toHaveURL(/\/dashboard\/marketing/);
    await page.waitForLoadState('networkidle');
    await snap(page, testInfo, 'marketing-landing');
  });

  test('switch tabs without error', async ({ page }, testInfo) => {
    await page.goto('/dashboard/marketing');
    await page.waitForLoadState('networkidle');

    const tabs = ['範本', '活動', '客群', '推播'];
    for (const t of tabs) {
      const tab = page.getByRole('tab', { name: t }).or(page.getByRole('button', { name: t })).first();
      if ((await tab.count()) > 0 && (await tab.isVisible().catch(() => false))) {
        await tab.click();
        await page.waitForTimeout(400);
      }
    }
    await snap(page, testInfo, 'marketing-tabs');
  });
});
