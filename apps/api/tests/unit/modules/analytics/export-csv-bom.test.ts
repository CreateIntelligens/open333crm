/**
 * 匯出的 CSV 以 UTF-8 BOM 開頭（change fix-admin-settings-safeguards，analytics-reports）。
 * G12：沒有 BOM 時 Excel 以系統編碼開啟，中文變亂碼。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { exportCsv } from '#src/modules/analytics/analytics.service.js';
import { createMockTenantCtx } from '../../../support/mock-tenant-ctx.js';
import { ALL_CHANNELS } from '#src/services/channel-visibility.js';

test('CSV 以 BOM 開頭', async () => {
  const { ctx } = createMockTenantCtx({ case: { findMany: async () => [] } });
  const csv = await exportCsv(ctx, ALL_CHANNELS, 'cases', new Date('2026-10-01'), new Date('2026-10-15'));
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.slice(1).startsWith('ID,標題,狀態'));
});

test('渠道報表 CSV 的渠道欄顯示名稱（Instagram、Facebook、網站聊天室），不顯示系統代號', async () => {
  // getChannelAnalytics 依序查：各渠道訊息數、各渠道對話數、Bot 與人工、各渠道新聯絡人
  const results = [
    [{ channel_type: 'THREADS', count: 3n }, { channel_type: 'FB', count: 2n }, { channel_type: 'WEBCHAT', count: 1n }],
    [{ channel_type: 'THREADS', count: 2n }, { channel_type: 'FB', count: 1n }, { channel_type: 'WEBCHAT', count: 1n }],
    [],
    [],
  ];
  const { ctx } = createMockTenantCtx({ $queryRaw: async () => results.shift() ?? [] });
  const csv = await exportCsv(ctx, ALL_CHANNELS, 'channels', new Date('2026-10-01'), new Date('2026-10-15'));
  const lines = csv.slice(1).split('\n');
  assert.equal(lines[0], '渠道,訊息數,對話數');
  assert.deepEqual(lines.slice(1), ['Instagram,3,2', 'Facebook,2,1', '網站聊天室,1,1']);
});
