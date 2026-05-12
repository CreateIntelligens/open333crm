import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { snap } from './helpers/screenshot';

test.describe('Portal', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('portal page renders', async ({ page }, testInfo) => {
    await page.goto('/dashboard/portal');
    await expect(page).toHaveURL(/\/dashboard\/portal/);
    await page.waitForLoadState('networkidle');
    await snap(page, testInfo, 'portal-page');
  });
});
