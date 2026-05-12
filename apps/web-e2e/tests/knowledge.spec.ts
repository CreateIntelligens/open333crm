import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { snap } from './helpers/screenshot';

test.describe('Knowledge', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('knowledge page renders', async ({ page }, testInfo) => {
    await page.goto('/dashboard/knowledge');
    await expect(page).toHaveURL(/\/dashboard\/knowledge/);
    await page.waitForLoadState('networkidle');
    await snap(page, testInfo, 'knowledge-page');
  });
});
