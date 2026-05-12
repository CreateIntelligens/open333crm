import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { snap } from './helpers/screenshot';

test.describe('Analytics', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('analytics overview renders', async ({ page }, testInfo) => {
    await page.goto('/dashboard/analytics');
    await expect(page).toHaveURL(/\/dashboard\/analytics/);
    // wait for chart libraries to render
    await page.waitForTimeout(2000);
    await snap(page, testInfo, 'analytics-overview');
  });

  test('my analytics page renders', async ({ page }, testInfo) => {
    await page.goto('/dashboard/analytics/my');
    await expect(page).toHaveURL(/\/dashboard\/analytics\/my/);
    await page.waitForTimeout(2000);
    await snap(page, testInfo, 'analytics-my');
  });
});
