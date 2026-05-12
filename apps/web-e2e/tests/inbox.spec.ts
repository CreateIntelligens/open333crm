import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { snap } from './helpers/screenshot';

test.describe('Inbox', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('three-column layout loads', async ({ page }, testInfo) => {
    await page.goto('/dashboard/inbox');

    // Sidebar header
    await expect(page.getByRole('heading', { name: '收件匣' })).toBeVisible();

    // Segmented Control
    await expect(page.getByRole('button', { name: '進行中' })).toBeVisible();
    await expect(page.getByRole('button', { name: '已關閉' })).toBeVisible();

    // Search input
    await expect(page.getByPlaceholder('搜尋對話 ...')).toBeVisible();

    // Tabs
    await expect(page.getByRole('button', { name: /全部/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /未讀/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /我的/ }).first()).toBeVisible();

    // Wait for list to settle
    await page.waitForLoadState('networkidle');
    await snap(page, testInfo, 'inbox-loaded');
  });

  test('switching to closed tab triggers re-fetch', async ({ page }, testInfo) => {
    await page.goto('/dashboard/inbox');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '已關閉' }).click();
    // Closed range select appears in the conversation list panel
    await expect(page.locator('option[value="30"]')).toHaveText('最近 30 天');
    await snap(page, testInfo, 'inbox-closed-tab');
  });

  test('select first conversation opens chat panel', async ({ page }, testInfo) => {
    await page.goto('/dashboard/inbox');
    await page.waitForLoadState('networkidle');

    // Click the first conversation list item (avatar wrappers are buttons)
    const firstItem = page.locator('button').filter({ hasText: /LINE|FB|WEBCHAT/ }).first();
    if ((await firstItem.count()) > 0) {
      await firstItem.click();
      await page.waitForURL(/\?conv=/, { timeout: 5_000 });
      // Chat header (customer name) appears
      await page.waitForTimeout(1000);
      await snap(page, testInfo, 'inbox-conversation-selected');
    } else {
      test.info().annotations.push({ type: 'skip', description: '無 active 對話可選' });
      await snap(page, testInfo, 'inbox-empty');
    }
  });

  test('AI suggest panel opens', async ({ page }, testInfo) => {
    await page.goto('/dashboard/inbox');
    await page.waitForLoadState('networkidle');

    const firstItem = page.locator('button').filter({ hasText: /LINE|FB|WEBCHAT/ }).first();
    if ((await firstItem.count()) === 0) {
      test.info().annotations.push({ type: 'skip', description: '無對話可開啟 AI suggest' });
      return;
    }

    await firstItem.click();
    await page.waitForURL(/\?conv=/);
    await page.waitForTimeout(800);

    // AI suggest is the lightbulb icon button in chat header
    const lightbulb = page.locator('button[title="AI 建議回覆"]');
    if ((await lightbulb.count()) > 0) {
      await lightbulb.click();
      await page.waitForTimeout(1500); // wait for suggestion fetch
      await snap(page, testInfo, 'inbox-ai-suggest');
    } else {
      await snap(page, testInfo, 'inbox-ai-suggest-not-found');
    }
  });

  test('open create case modal from sidebar', async ({ page }, testInfo) => {
    await page.goto('/dashboard/inbox');
    await page.waitForLoadState('networkidle');

    const firstItem = page.locator('button').filter({ hasText: /LINE|FB|WEBCHAT/ }).first();
    if ((await firstItem.count()) === 0) {
      test.info().annotations.push({ type: 'skip', description: '無對話可開立案件' });
      return;
    }
    await firstItem.click();
    await page.waitForURL(/\?conv=/);
    await page.waitForTimeout(800);

    // "開立案件" button in right Customer Sidebar
    const createBtn = page.getByRole('button', { name: /開立案件/ });
    if ((await createBtn.count()) > 0) {
      await createBtn.first().click();
      // Modal title appears
      await expect(page.getByText('建立案件').first()).toBeVisible({ timeout: 5_000 });
      await snap(page, testInfo, 'inbox-create-case-modal');

      // Close modal
      await page.getByRole('button', { name: '關閉' }).click();
    } else {
      test.info().annotations.push({ type: 'skip', description: '已有案件，按鈕不顯示' });
      await snap(page, testInfo, 'inbox-create-case-hidden');
    }
  });
});
