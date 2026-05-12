import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { snap } from './helpers/screenshot';

test.describe('Cases', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('case list page renders', async ({ page }, testInfo) => {
    await page.goto('/dashboard/cases');
    await expect(page.getByRole('heading', { name: '工單' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await snap(page, testInfo, 'cases-list');
  });

  test('dashboard stats cards visible', async ({ page }, testInfo) => {
    await page.goto('/dashboard/cases');
    // Stat cards use <p> for label — match by tag to avoid colliding with <option> labels
    await expect(page.locator('p', { hasText: '開啟中' }).first()).toBeVisible();
    await expect(page.locator('p', { hasText: 'SLA 違規' }).first()).toBeVisible();
    await expect(page.locator('p', { hasText: '即將到期' }).first()).toBeVisible();
    await expect(page.locator('p', { hasText: '今日解決' }).first()).toBeVisible();
    await snap(page, testInfo, 'cases-stats');
  });

  test('search filters table', async ({ page }, testInfo) => {
    await page.goto('/dashboard/cases');
    await page.waitForLoadState('networkidle');
    const searchInput = page.getByPlaceholder(/搜尋工單/);
    await searchInput.fill('測試');
    await page.waitForTimeout(500);
    await snap(page, testInfo, 'cases-search');
  });

  test('switch to status tab', async ({ page }, testInfo) => {
    await page.goto('/dashboard/cases');
    await page.waitForLoadState('networkidle');
    // The status tab includes a count: "開啟 (10)" — match precisely
    await page.getByRole('button', { name: /^開啟 \(/ }).click();
    await page.waitForTimeout(500);
    await snap(page, testInfo, 'cases-tab-open');
  });

  test('open create case modal from toolbar', async ({ page }, testInfo) => {
    await page.goto('/dashboard/cases');
    await page.getByRole('button', { name: /建立案件/ }).first().click();
    await expect(page.getByText('建立案件').first()).toBeVisible({ timeout: 5_000 });
    await snap(page, testInfo, 'cases-create-modal');
  });
});
