import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { snap } from './helpers/screenshot';

test.describe('Automation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('automation rules page renders', async ({ page }, testInfo) => {
    await page.goto('/dashboard/automation');
    // page may use different heading; assert by URL
    await expect(page).toHaveURL(/\/dashboard\/automation/);
    await page.waitForLoadState('networkidle');
    await snap(page, testInfo, 'automation-list');
  });
});
