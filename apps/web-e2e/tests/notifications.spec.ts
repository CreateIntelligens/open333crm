import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { snap } from './helpers/screenshot';

test.describe('Notifications', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('notifications page renders', async ({ page }, testInfo) => {
    await page.goto('/dashboard/notifications');
    await expect(page).toHaveURL(/\/dashboard\/notifications/);
    await page.waitForLoadState('networkidle');
    await snap(page, testInfo, 'notifications-list');
  });
});
