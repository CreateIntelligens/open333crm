import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { snap } from './helpers/screenshot';

test.describe('Shortlinks', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('shortlinks page renders', async ({ page }, testInfo) => {
    await page.goto('/dashboard/shortlinks');
    await expect(page).toHaveURL(/\/dashboard\/shortlinks/);
    await page.waitForLoadState('networkidle');
    await snap(page, testInfo, 'shortlinks-list');
  });
});
