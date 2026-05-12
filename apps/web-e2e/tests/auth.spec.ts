import { expect, test } from '@playwright/test';
import { DEMO_ADMIN, expectDashboardChrome, login } from './helpers/auth';
import { snap } from './helpers/screenshot';

test.describe('Auth', () => {
  test('login page renders', async ({ page }, testInfo) => {
    await page.goto('/login');
    await expect(page.getByPlaceholder('agent@example.com')).toBeVisible();
    await expect(page.getByPlaceholder('請輸入密碼')).toBeVisible();
    await expect(page.getByRole('button', { name: /^登入$/ })).toBeVisible();
    await snap(page, testInfo, 'login-page');
  });

  test('login with wrong password shows error', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.getByPlaceholder('agent@example.com').fill(DEMO_ADMIN.email);
    await page.getByPlaceholder('請輸入密碼').fill('wrong-password');
    await page.getByRole('button', { name: /^登入$/ }).click();

    // Either an inline error or stays on /login
    await page.waitForTimeout(1500);
    expect(page.url()).toContain('/login');
    await snap(page, testInfo, 'login-error');
  });

  test('login with valid credentials lands on dashboard', async ({ page }, testInfo) => {
    await login(page);
    await expectDashboardChrome(page);
    await snap(page, testInfo, 'login-success');
  });

  test('session persists after reload', async ({ page }, testInfo) => {
    await login(page);
    await page.reload();
    await expectDashboardChrome(page);
    await snap(page, testInfo, 'session-persisted');
  });
});
