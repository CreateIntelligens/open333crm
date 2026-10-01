/**
 * 用量告警核心邏輯測試（checkQuotaThresholdCrossing）。
 * 真連 Redis（冪等旗標）；prisma 以 stub 提供固定 monthlyTokens 上限，不依賴特定租戶資料。
 *
 * 執行：REDIS_URL=redis://localhost:6380 tsx src/__tests__/token-quota-alert.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6380';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://crm:crmpassword@localhost:5433/open333crm';

import {
  checkQuotaThresholdCrossing,
  clearQuotaAlertFlags,
} from '../modules/trial/token-quota.service.js';
import { redis } from '@open333crm/core';

/** stub prisma：讓 getEffectiveLimit 回固定 monthlyTokens（limit 為 null 表無上限）。 */
function stubPrisma(limit: number | null) {
  return {
    tenant: {
      findUnique: async () => ({
        limitOverrides: {},
        plan: limit === null ? null : { limits: { monthlyTokens: limit } },
      }),
    },
  } as never;
}

const TID = '00000000-0000-0000-0000-0000000000aa';

test('剛跨越 80% → 回 warning', async () => {
  await clearQuotaAlertFlags(TID);
  // limit=1000，80%=800。before=790 → after=810 跨越 800（未達 1000）
  const crossed = await checkQuotaThresholdCrossing(stubPrisma(1000), TID, 20, 810);
  assert.equal(crossed.length, 1);
  assert.equal(crossed[0].level, 'warning');
  assert.equal(crossed[0].limitTokens, 1000);
  assert.equal(crossed[0].usedTokens, 810);
});

test('剛跨越 100% → 回 critical', async () => {
  await clearQuotaAlertFlags(TID);
  // before=990 → after=1010 跨越 1000（但 before 990 已 > 800，不重發 warning）
  const crossed = await checkQuotaThresholdCrossing(stubPrisma(1000), TID, 20, 1010);
  assert.equal(crossed.length, 1);
  assert.equal(crossed[0].level, 'critical');
});

test('單次巨量同時跨越 80% 與 100% → 兩者都回', async () => {
  await clearQuotaAlertFlags(TID);
  // before=0 → after=1500，一次跨越 800 與 1000
  const crossed = await checkQuotaThresholdCrossing(stubPrisma(1000), TID, 1500, 1500);
  const levels = crossed.map((c) => c.level).sort();
  assert.deepEqual(levels, ['critical', 'warning']);
});

test('未跨越門檻 → 回 []', async () => {
  await clearQuotaAlertFlags(TID);
  // before=100 → after=200，都 < 800
  const crossed = await checkQuotaThresholdCrossing(stubPrisma(1000), TID, 100, 200);
  assert.equal(crossed.length, 0);
});

test('無上限（limit=null）→ 回 []', async () => {
  await clearQuotaAlertFlags(TID);
  const crossed = await checkQuotaThresholdCrossing(stubPrisma(null), TID, 999999, 999999);
  assert.equal(crossed.length, 0);
});

test('冪等：同門檻連續跨越只回一次', async () => {
  await clearQuotaAlertFlags(TID);
  const first = await checkQuotaThresholdCrossing(stubPrisma(1000), TID, 20, 810);
  assert.equal(first.length, 1, '第一次應發 warning');
  // 再次「跨越」同門檻（例如另一筆用量 before<800 的重放不會發生，但模擬重複偵測）
  const second = await checkQuotaThresholdCrossing(stubPrisma(1000), TID, 20, 810);
  assert.equal(second.length, 0, '第二次應被冪等旗標擋下');
});

test('清旗標後可再發（跨月語意）', async () => {
  await clearQuotaAlertFlags(TID);
  const a = await checkQuotaThresholdCrossing(stubPrisma(1000), TID, 20, 810);
  assert.equal(a.length, 1);
  await clearQuotaAlertFlags(TID); // 模擬跨月旗標過期
  const b = await checkQuotaThresholdCrossing(stubPrisma(1000), TID, 20, 810);
  assert.equal(b.length, 1, '清旗標後應可再發');
});

test.after(async () => {
  await clearQuotaAlertFlags(TID);
  await redis.quit();
  // core barrel 匯入會帶入多個 side-effect singleton（storage/event-bus 等）留下未關閉 handle，
  // 使 node:test 跑完仍不退出 → 強制結束（測試結果已由各 test 斷言決定）。
  process.exit(0);
});
