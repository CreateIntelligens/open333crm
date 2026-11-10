/**
 * 用量統計「近 N 天」的區間與後端預設期間同一條公式
 * （platform-usage「每日用量以台灣日期分日並補齊沒有用量的日子」）。
 *
 * web 不依賴 @open333crm/core（core 的入口會載入 Redis 與 Prisma，web 的 Docker 映像也沒有 core），
 * 所以 usage-range.ts 自己算；這裡直接讀 core 的原始檔（taipei-time.ts 沒有任何 import）比對兩者。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { usageRange } from '#src/app/admin/lib/usage-range.js';
import { taipeiRecentDays } from '../../../../../../packages/core/src/coupon/taipei-time.js';

const NOWS = [
  '2026-11-10T02:00:00.000Z', // 台灣 11-10 10:00
  '2026-11-09T16:00:00.000Z', // 台灣 11-10 00:00 整
  '2026-11-09T15:59:59.999Z', // 台灣 11-09 23:59:59.999
  '2026-12-31T17:00:00.000Z', // 台灣隔年 01-01 01:00
  '2028-03-01T03:00:00.000Z', // 閏年 2 月之後
];

test('近 N 天與後端預設期間的公式一致', () => {
  for (const iso of NOWS) {
    const now = new Date(iso);
    for (const days of [1, 7, 30, 90]) {
      const core = taipeiRecentDays(days, now);
      assert.deepEqual(usageRange(days, now), { from: core.from.toISOString(), to: core.to.toISOString() }, `${iso} 近 ${days} 天`);
    }
  }
});
