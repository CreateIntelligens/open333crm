import { test, expect } from '@playwright/test';
import { BASE_URL, openPlatformContext } from './helpers';

/**
 * C3 破壞性操作驗證：只對名稱帶 [E2E] 前綴的專用租戶操作，絕不觸碰其他租戶的列。
 * 流程：平台開通 [E2E] 租戶（最低階 trial）→ 登入 API 可用 → 停用 → 登入 API 403
 *      → 重新啟用 → 登入 API 恢復 → 再次停用（依指示最終留在停用狀態，不刪除）。
 * 註：UAT 無 email 服務，開通信寄不出去屬正常，不列為失敗。
 * 租戶端 UI 驗證卡 playcaptcha，登入驗證一律走 API（無 captcha 檢查）。
 */
const TENANT_NAME = '[E2E] 測試租戶-0902';
const ADMIN_EMAIL = 'e2e-tenant-0902@example.com';
const ADMIN_PASSWORD = 'E2eTest1234!';

test('@cross C3 [E2E] 租戶生命週期：開通→停用擋登入→啟用→停用', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const ctx = await openPlatformContext(browser);
  const page = await ctx.newPage();

  const tenantRow = () => page.locator('tbody tr', { hasText: TENANT_NAME });
  const loginApi = () =>
    request.post(`${BASE_URL}/api/v1/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });

  try {
    await page.goto(`${BASE_URL}/admin/tenants`, { waitUntil: 'networkidle' });
    expect(page.url(), '平台 session 掉了：落在登入頁').not.toMatch(/\/admin\/login/);

    // ── 步驟 1：開通 [E2E] 專用租戶（已存在則沿用，具重跑冪等性） ──
    await test.step(`開通「${TENANT_NAME}」（trial 方案）`, async () => {
      if ((await tenantRow().count()) > 0) {
        test.info().annotations.push({ type: 'note', description: '[E2E] 租戶已存在，沿用不重建' });
        return;
      }
      await page.getByPlaceholder('站台名稱').fill(TENANT_NAME);
      await page.locator('form select').selectOption('trial');
      await page.getByPlaceholder('管理員 Email').fill(ADMIN_EMAIL);
      await page.getByPlaceholder('管理員姓名').fill('[E2E] Admin');
      await page.getByPlaceholder('管理員密碼（≥8）').fill(ADMIN_PASSWORD);
      await page.getByRole('button', { name: '開通' }).click();
      await expect(page.getByText(`✓ 已開通「${TENANT_NAME}」`)).toBeVisible({ timeout: 20_000 });
      await expect(tenantRow()).toHaveCount(1);
      await expect(tenantRow()).toContainText('免費試用');
    });

    // 若租戶目前是停用（前次跑到一半），先啟用歸位再走完整流程
    await test.step('前置：確認租戶為啟用狀態', async () => {
      if (await tenantRow().getByRole('button', { name: '啟用', exact: true }).isVisible().catch(() => false)) {
        await tenantRow().getByRole('button', { name: '啟用', exact: true }).click();
      }
      await expect(tenantRow().getByRole('button', { name: '停用', exact: true })).toBeVisible({ timeout: 10_000 });
    });

    // ── 步驟 2：啟用狀態下登入 API 應成功 ──
    await test.step('啟用狀態：登入 API 回 200', async () => {
      const res = await loginApi();
      expect(res.status(), `登入 API 應成功，實際 ${res.status()}：${await res.text()}`).toBe(200);
    });

    // ── 步驟 3：停用 → 平台端狀態變更 + 登入 API 被擋 ──
    await test.step('停用租戶：平台端顯示停用、登入 API 回 403 TENANT_DISABLED', async () => {
      await tenantRow().getByRole('button', { name: '停用', exact: true }).click();
      await expect(tenantRow().getByRole('button', { name: '啟用', exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(tenantRow()).toContainText('停用');

      const res = await loginApi();
      expect(res.status(), '停用租戶登入應被拒').toBe(403);
      expect(await res.text()).toContain('TENANT_DISABLED');
    });

    // ── 步驟 4：重新啟用 → 登入 API 恢復 ──
    await test.step('重新啟用：登入 API 恢復 200', async () => {
      await tenantRow().getByRole('button', { name: '啟用', exact: true }).click();
      await expect(tenantRow().getByRole('button', { name: '停用', exact: true })).toBeVisible({ timeout: 10_000 });

      const res = await loginApi();
      expect(res.status(), '重新啟用後登入應恢復').toBe(200);
    });

    // ── 步驟 5：再次停用（依測試紀律，[E2E] 租戶最終留在停用狀態） ──
    await test.step('再次停用：留在停用狀態收尾', async () => {
      await tenantRow().getByRole('button', { name: '停用', exact: true }).click();
      await expect(tenantRow().getByRole('button', { name: '啟用', exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(tenantRow()).toContainText('停用');

      const res = await loginApi();
      expect(res.status()).toBe(403);
    });
  } finally {
    await ctx.close();
  }
});
