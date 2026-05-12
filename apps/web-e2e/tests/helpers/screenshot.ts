import type { Page, TestInfo } from '@playwright/test';

/**
 * Take a labelled screenshot and attach it to the test report.
 * Filename: <slug>.png under test-results/<test-id>/
 *
 * Usage:
 *   await snap(page, testInfo, 'inbox-loaded');
 */
export async function snap(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
  const buffer = await page.screenshot({ fullPage: true });
  await testInfo.attach(safeLabel, {
    body: buffer,
    contentType: 'image/png',
  });
}
