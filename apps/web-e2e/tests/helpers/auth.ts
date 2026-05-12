import type { Page } from '@playwright/test';

export const DEMO_ADMIN = {
  email: 'admin@demo.com',
  password: 'admin123',
} as const;

export const DEMO_AGENT = {
  email: 'agent1@demo.com',
  password: 'admin123',
} as const;

/**
 * Log in via the UI. Lands on /dashboard/inbox after a successful login.
 * Throws if the network call fails or redirect doesn't happen.
 */
export async function login(
  page: Page,
  creds: { email: string; password: string } = DEMO_ADMIN,
): Promise<void> {
  // Retry once if first attempt times out (transient API/refresh-token races)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto('/login');
      await page.getByPlaceholder('agent@example.com').fill(creds.email);
      await page.getByPlaceholder('請輸入密碼').fill(creds.password);
      await Promise.all([
        page.waitForURL(/\/dashboard/, { timeout: 20_000 }),
        page.getByRole('button', { name: /^登入$/ }).click(),
      ]);
      return;
    } catch (err) {
      if (attempt === 1) throw err;
      await page.waitForTimeout(1000);
    }
  }
}

/**
 * Quick sanity that we're authenticated and on the dashboard shell.
 */
export async function expectDashboardChrome(page: Page): Promise<void> {
  // Brand chip in LayoutTopbar
  await page.waitForSelector('text=open333CRM 客服系統', { timeout: 10_000 });
  // User dropdown
  await page.waitForSelector('header [role="button"], header button', { timeout: 5_000 });
}
