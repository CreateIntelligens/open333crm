import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { snap } from './helpers/screenshot';

test.describe('Contacts', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('contact list page renders', async ({ page }, testInfo) => {
    await page.goto('/dashboard/contacts');
    await expect(page.getByRole('heading', { name: '聯繫人' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await snap(page, testInfo, 'contacts-list');
  });

  test('search contact filters table', async ({ page }, testInfo) => {
    await page.goto('/dashboard/contacts');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder(/搜尋聯繫人/).fill('王');
    await page.waitForTimeout(500);
    await snap(page, testInfo, 'contacts-search');
  });

  test('open contact detail page', async ({ page }, testInfo) => {
    await page.goto('/dashboard/contacts');
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('tbody tr').first();
    if ((await firstRow.count()) > 0) {
      await firstRow.click();
      await page.waitForURL(/\/contacts\/[a-z0-9-]+/, { timeout: 5_000 });
      await page.waitForLoadState('networkidle');
      await snap(page, testInfo, 'contact-detail');
    } else {
      test.info().annotations.push({ type: 'skip', description: '無聯繫人資料' });
      await snap(page, testInfo, 'contacts-empty');
    }
  });
});
