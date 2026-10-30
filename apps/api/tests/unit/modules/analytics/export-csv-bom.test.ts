/**
 * 匯出的 CSV 以 UTF-8 BOM 開頭（change fix-admin-settings-safeguards，analytics-reports）。
 * G12：沒有 BOM 時 Excel 以系統編碼開啟，中文變亂碼。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { exportCsv } from '#src/modules/analytics/analytics.service.js';
import { createMockTenantCtx } from '../../../support/mock-tenant-ctx.js';

test('CSV 以 BOM 開頭', async () => {
  const { ctx } = createMockTenantCtx({ case: { findMany: async () => [] } });
  const csv = await exportCsv(ctx, 'cases', new Date('2026-10-01'), new Date('2026-10-15'));
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.slice(1).startsWith('ID,標題,狀態'));
});
