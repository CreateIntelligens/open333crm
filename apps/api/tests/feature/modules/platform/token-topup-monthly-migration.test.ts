/**
 * 清除既有加購覆寫值的 migration（change make-token-topup-monthly，design D6）。
 *
 * 加購改成只計入核准當月之後，舊版核准加購寫進 tenants."limitOverrides" 的 monthlyTokens 要移除，
 * 否則永久提高的額度會一直留著（AUDIT PLAN-02、PLAN-05）。這裡在交易內建立租戶、執行 migration 的 SQL，
 * 驗證只移除 monthlyTokens、其他覆寫值不變、可重複執行，結束時 rollback。
 *
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { repoRoot } from '../../../support/paths.js';

const MIGRATION = join(
  repoRoot,
  'packages/database/prisma/migrations/20261110120000_remove_topup_monthly_tokens_override/migration.sql',
);

const prisma = new PrismaClient();

class Rollback extends Error {}

afterAll(async () => {
  await prisma.$disconnect();
});

test('移除 limitOverrides 的 monthlyTokens：其他覆寫值不變，沒有這個 key 的租戶不變，重複執行結果相同', async () => {
  assert.ok(existsSync(MIGRATION), `缺少 migration 檔：${MIGRATION}`);
  const sql = readFileSync(MIGRATION, 'utf8');

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const tag = `topup-migration-${Date.now()}`;
      const topped = await tx.tenant.create({
        data: { name: `${tag}-a`, limitOverrides: { monthlyTokens: 1_550_000, maxAgents: 8 } },
      });
      const onlyTokens = await tx.tenant.create({ data: { name: `${tag}-b`, limitOverrides: { monthlyTokens: null } } });
      const untouched = await tx.tenant.create({ data: { name: `${tag}-c`, limitOverrides: { maxChannels: 2 } } });

      const overrides = async () =>
        Object.fromEntries(
          (await tx.tenant.findMany({
            where: { id: { in: [topped.id, onlyTokens.id, untouched.id] } },
            select: { id: true, limitOverrides: true },
          })).map((t) => [t.id, t.limitOverrides]),
        );

      await tx.$executeRawUnsafe(sql);
      const once = await overrides();
      assert.deepEqual(once[topped.id], { maxAgents: 8 });
      assert.deepEqual(once[onlyTokens.id], {});
      assert.deepEqual(once[untouched.id], { maxChannels: 2 });

      await tx.$executeRawUnsafe(sql);
      assert.deepEqual(await overrides(), once);
      throw new Rollback();
    }),
    Rollback,
  );
});
