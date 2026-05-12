import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { snap } from './helpers/screenshot';

test.describe('Dashboard overview', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('overview page renders', async ({ page }, testInfo) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.waitForLoadState('networkidle');
    await snap(page, testInfo, 'dashboard-overview');
  });
});
