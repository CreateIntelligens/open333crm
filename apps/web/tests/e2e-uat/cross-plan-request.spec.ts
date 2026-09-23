import { test, expect } from '@playwright/test';
import { BASE_URL, openTenantContext, openPlatformContext } from './helpers';

/**
 * C2 跨平台安全閉環：方案升級「申請 → 平台看到 → 駁回 → 租戶方案不變」。
 * - 可逆：全程不核准，方案狀態測前 == 測後；只留一筆「已駁回」歷史紀錄。
 * - 用唯一備註標記（[E2E] 前綴 + 時間戳）鎖定本測試建立的申請，絕不動其他租戶的單。
 * - 若租戶已有一筆處理中的申請（非本測試建立），直接中止並回報，不代審。
 */
test('@cross C2 方案升級申請→平台駁回閉環', async ({ browser }) => {
  test.setTimeout(180_000);
  const marker = `[E2E] cross-plan-request ${new Date().toISOString()}`;

  const tenantCtx = await openTenantContext(browser);
  const platformCtx = await openPlatformContext(browser);
  const tenantPage = await tenantCtx.newPage();
  const platformPage = await platformCtx.newPage();

  let tenantName = '';
  let currentPlanLabel = '';

  try {
    // ── 步驟 1：租戶端送出升級申請 ──
    await test.step('租戶端送出升級申請（企業版，帶唯一標記備註）', async () => {
      await tenantPage.goto(`${BASE_URL}/dashboard/plan`, { waitUntil: 'networkidle' });
      expect(tenantPage.url(), 'session 掉了：落在登入頁').not.toMatch(/\/login/);

      // 既有 pending（非本測試的）就中止，不代審別人的單
      const pendingBlock = tenantPage.getByText('您有一筆處理中的申請');
      if (await pendingBlock.isVisible().catch(() => false)) {
        throw new Error('租戶已有一筆處理中的申請（非本測試建立），中止 C2；請人工確認後再跑');
      }

      await tenantPage.getByRole('button', { name: '升級方案', exact: true }).click();
      await tenantPage.locator('select').selectOption('enterprise');
      await tenantPage.locator('textarea').fill(marker);
      await tenantPage.getByRole('button', { name: '送出申請' }).click();

      await expect(tenantPage.getByText('✓ 申請已送出，等待平台方核准')).toBeVisible({ timeout: 15_000 });
      // 申請記錄出現本筆：升級 → enterprise + 處理中
      const row = tenantPage.locator('div', { hasText: marker }).filter({ hasText: '升級 → enterprise' }).last();
      await expect(row.getByText('處理中')).toBeVisible();
    });

    // ── 步驟 2：平台端看到該筆待審並駁回 ──
    await test.step('平台端 /admin/plan-changes 看到該筆待審（驗租戶名/類型/目標方案）後駁回', async () => {
      await platformPage.goto(`${BASE_URL}/admin/plan-changes`, { waitUntil: 'networkidle' });
      expect(platformPage.url(), '平台 session 掉了：落在登入頁').not.toMatch(/\/admin\/login/);

      const row = platformPage.locator('tbody tr', { hasText: marker });
      await expect(row, '平台端未出現本測試送出的申請').toHaveCount(1);
      await expect(row.getByText('升級方案')).toBeVisible();
      await expect(row.getByText('→ 企業版')).toBeVisible();

      tenantName = (await row.locator('td').first().innerText()).split('\n')[0].trim();
      expect(tenantName.length, '待審列應有租戶名').toBeGreaterThan(0);
      const currentText = await row.getByText(/目前：/).innerText().catch(() => '');
      currentPlanLabel = (currentText.match(/目前：(.+)/)?.[1] ?? '').trim();

      // 平台端駁回用 window.confirm，需掛 dialog handler；確認文案含「駁回」與租戶名才接受
      platformPage.once('dialog', (dialog) => {
        expect(dialog.message()).toContain('駁回');
        expect(dialog.message()).toContain(tenantName);
        void dialog.accept();
      });
      await row.getByRole('button', { name: '駁回' }).click();

      await expect(platformPage.getByText(`✓ 已駁回「${tenantName}」的申請`)).toBeVisible({ timeout: 15_000 });
      await expect(platformPage.locator('tbody tr', { hasText: marker })).toHaveCount(0);
    });

    // ── 步驟 3：平台端確認該租戶方案不變 ──
    await test.step('平台端 /admin/tenants 確認租戶方案維持原樣', async () => {
      await platformPage.goto(`${BASE_URL}/admin/tenants`, { waitUntil: 'networkidle' });
      const tenantRow = platformPage.locator('tbody tr', { hasText: tenantName });
      await expect(tenantRow.first()).toBeVisible();
      if (currentPlanLabel && currentPlanLabel !== '—') {
        await expect(tenantRow.first(), `租戶方案應仍為「${currentPlanLabel}」`).toContainText(currentPlanLabel);
      } else {
        // 待審列未顯示目前方案時只驗租戶仍存在；不可用 test.skip()（會把整個測試標成略過並跳過後續步驟）
        test.info().annotations.push({ type: 'note', description: '待審列未顯示目前方案，略過方案比對' });
      }
    });

    // ── 步驟 4：租戶端看到已駁回、表單解鎖、方案未變 ──
    await test.step('租戶端重整：申請顯示「已駁回」、可再送新申請', async () => {
      await tenantPage.reload({ waitUntil: 'networkidle' });
      const row = tenantPage.locator('div', { hasText: marker }).filter({ hasText: '升級 → enterprise' }).last();
      await expect(row.getByText('已駁回')).toBeVisible({ timeout: 15_000 });
      // pending 鎖解除 → 申請表單回來了
      await expect(tenantPage.getByRole('button', { name: '送出申請' })).toBeVisible();
      await expect(tenantPage.getByText('您有一筆處理中的申請')).toHaveCount(0);
    });
  } finally {
    await tenantCtx.close();
    await platformCtx.close();
  }
});
