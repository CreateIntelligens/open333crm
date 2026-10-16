/**
 * 主規格 trial-data-purge 與 trial-lifecycle「到期自動停用（資料保留）」（change restore-trial-data-purge-specs）。
 *
 * 直接呼叫排程 runTrialLifecycle() 與平台服務。每個測試在交易內建立租戶，結束時 rollback。
 * 排程會掃整個資料庫的試用租戶，所以只檢查本測試建立的租戶。
 *
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listTrialTenants, restorePurgedTenant } from '#src/modules/platform/trial-admin.service.js';
import { runTrialLifecycle } from '#src/modules/trial/trial.scheduler.js';

const prisma = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;

class Rollback extends Error {}

afterAll(async () => {
  await prisma.$disconnect();
});

let seq = 0;

interface Fixture {
  tx: PrismaClient;
  tenant: (data: { trialEndsAt: Date | null; isActive: boolean; purgedAt?: Date | null }) => Promise<string>;
}

/** 在交易內執行，結束時 rollback，不留資料。保留天數固定為 30 天。 */
function scenario(name: string, fn: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    await assert.rejects(
      prisma.$transaction(
        async (raw) => {
          const tx = raw as unknown as PrismaClient;
          const tag = `trial-purge-${Date.now()}-${seq++}`;
          await tx.platformSetting.upsert({
            where: { key: 'trial.dataRetentionDays' },
            create: { key: 'trial.dataRetentionDays', value: 30 },
            update: { value: 30 },
          });
          await fn({
            tx,
            tenant: async (data) => (await tx.tenant.create({ data: { name: tag, ...data } })).id,
          });
          throw new Rollback();
        },
        { timeout: 30_000 },
      ),
      Rollback,
    );
  });
}

const state = (tx: PrismaClient, id: string) =>
  tx.tenant.findUniqueOrThrow({ where: { id }, select: { isActive: true, purgedAt: true } });

const audits = (tx: PrismaClient, action: string, id: string) =>
  tx.platformAuditLog.findMany({ where: { action, targetId: id } });

scenario('保留期滿的停用試用租戶被標記', async ({ tx, tenant }) => {
  const id = await tenant({ trialEndsAt: new Date(Date.now() - 40 * DAY), isActive: false });
  const contact = await tx.contact.create({ data: { tenantId: id, displayName: '試用期的客人' } });
  const before = Date.now();

  await runTrialLifecycle(tx);

  const t = await state(tx, id);
  assert.ok(t.purgedAt, '有軟刪標記');
  assert.ok(t.purgedAt.getTime() >= before && t.purgedAt.getTime() <= Date.now(), '標記時間是執行時的時間');
  const logs = await audits(tx, 'tenant.trial.purge', id);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].platformUserId, null, '系統動作沒有平台人員');
  assert.ok(await tx.contact.findUnique({ where: { id: contact.id } }), '聯絡人仍然存在');
});

scenario('保留期未滿不標記', async ({ tx, tenant }) => {
  const id = await tenant({ trialEndsAt: new Date(Date.now() - 10 * DAY), isActive: false });

  await runTrialLifecycle(tx);

  assert.equal((await state(tx, id)).purgedAt, null);
  assert.equal((await audits(tx, 'tenant.trial.purge', id)).length, 0);
});

scenario('已標記的租戶不重複處理', async ({ tx, tenant }) => {
  const purgedAt = new Date(Date.now() - 5 * DAY);
  const id = await tenant({ trialEndsAt: new Date(Date.now() - 40 * DAY), isActive: false, purgedAt });

  await runTrialLifecycle(tx);

  assert.equal((await state(tx, id)).purgedAt?.getTime(), purgedAt.getTime());
  assert.equal((await audits(tx, 'tenant.trial.purge', id)).length, 0);
});

scenario('停用的非試用租戶不標記', async ({ tx, tenant }) => {
  const id = await tenant({ trialEndsAt: null, isActive: false });

  await runTrialLifecycle(tx);

  assert.equal((await state(tx, id)).purgedAt, null);
});

scenario('復原已標記的租戶', async ({ tx, tenant }) => {
  const id = await tenant({
    trialEndsAt: new Date(Date.now() - 40 * DAY),
    isActive: false,
    purgedAt: new Date(Date.now() - 5 * DAY),
  });

  await restorePurgedTenant(tx, id);

  const t = await state(tx, id);
  assert.equal(t.purgedAt, null);
  assert.equal(t.isActive, false, '復原不啟用租戶');
});

scenario('未標記的租戶不能復原', async ({ tx, tenant }) => {
  const id = await tenant({ trialEndsAt: new Date(Date.now() - 40 * DAY), isActive: false });

  await assert.rejects(restorePurgedTenant(tx, id), (err: unknown) => {
    const e = err as { code?: string; statusCode?: number };
    assert.equal(e.statusCode, 422);
    assert.equal(e.code, 'NOT_PURGED');
    return true;
  });
  assert.deepEqual(await state(tx, id), { isActive: false, purgedAt: null });
});

scenario('已標記的租戶狀態是 purged', async ({ tx, tenant }) => {
  // 仍啟用、還沒到期的租戶也一樣：purgedAt 有值就是 purged
  const id = await tenant({
    trialEndsAt: new Date(Date.now() + 7 * DAY),
    isActive: true,
    purgedAt: new Date(Date.now() - 5 * DAY),
  });

  const rows = await listTrialTenants(tx);

  assert.equal(rows.find((r) => r.id === id)?.status, 'purged');
});

scenario('到期停用', async ({ tx, tenant }) => {
  const id = await tenant({ trialEndsAt: new Date(Date.now() - DAY), isActive: true });
  const contact = await tx.contact.create({ data: { tenantId: id, displayName: '試用期的客人' } });

  await runTrialLifecycle(tx);

  const t = await state(tx, id);
  assert.equal(t.isActive, false);
  assert.equal(t.purgedAt, null, '保留期未滿，不標記');
  assert.equal((await audits(tx, 'tenant.trial.expire', id)).length, 1);
  assert.ok(await tx.contact.findUnique({ where: { id: contact.id } }), '資料保留');
});
