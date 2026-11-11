/**
 * 主規格 trial-lifecycle「平台延長試用」（change fix-trial-extend-clears-purge）。
 *
 * 直接呼叫 extendTrial()。每個測試在交易內建立租戶，結束時 rollback。
 * 路由寫的 tenant.trial.extend 稽核由 tests/unit/modules/platform/platform-audit-routes.test.ts 涵蓋。
 *
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { extendTrial } from '#src/modules/platform/trial-admin.service.js';

const prisma = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;

class Rollback extends Error {}

afterAll(async () => {
  await prisma.$disconnect();
});

let seq = 0;

type TenantData = {
  trialEndsAt: Date | null;
  isActive: boolean;
  purgedAt?: Date | null;
  trialRemindersSent?: number[];
};

/** 在交易內執行，結束時 rollback，不留資料。 */
function scenario(name: string, fn: (tx: PrismaClient, tenant: (data: TenantData) => Promise<string>) => Promise<void>) {
  test(name, async () => {
    await assert.rejects(
      prisma.$transaction(async (raw) => {
        const tx = raw as unknown as PrismaClient;
        const tag = `trial-extend-${Date.now()}-${seq++}`;
        await fn(tx, async (data) => (await tx.tenant.create({ data: { name: tag, ...data } })).id);
        throw new Rollback();
      }),
      Rollback,
    );
  });
}

const state = (tx: PrismaClient, id: string) =>
  tx.tenant.findUniqueOrThrow({
    where: { id },
    select: { trialEndsAt: true, isActive: true, purgedAt: true, trialRemindersSent: true },
  });

scenario('延長未到期的試用', async (tx, tenant) => {
  const endsAt = new Date(Date.now() + 10 * DAY);
  const id = await tenant({ trialEndsAt: endsAt, isActive: true });

  await extendTrial(tx, id, 7);

  assert.equal((await state(tx, id)).trialEndsAt?.getTime(), endsAt.getTime() + 7 * DAY);
});

scenario('延長已到期停用的試用', async (tx, tenant) => {
  const id = await tenant({ trialEndsAt: new Date(Date.now() - 10 * DAY), isActive: false, trialRemindersSent: [7, 1] });
  const before = Date.now();

  await extendTrial(tx, id, 7);

  const t = await state(tx, id);
  const ends = t.trialEndsAt!.getTime();
  assert.ok(ends >= before + 7 * DAY && ends <= Date.now() + 7 * DAY, '從延長當下起算');
  assert.equal(t.isActive, true);
  assert.deepEqual(t.trialRemindersSent, []);
});

scenario('延長已清除的試用', async (tx, tenant) => {
  const id = await tenant({
    trialEndsAt: new Date(Date.now() - 40 * DAY),
    isActive: false,
    purgedAt: new Date(Date.now() - 5 * DAY),
  });

  await extendTrial(tx, id, 7);

  const t = await state(tx, id);
  assert.equal(t.purgedAt, null);
  assert.equal(t.isActive, true);
});

scenario('非試用租戶不能延長', async (tx, tenant) => {
  const id = await tenant({ trialEndsAt: null, isActive: false });

  await assert.rejects(extendTrial(tx, id, 7), (err: unknown) => {
    const e = err as { code?: string; statusCode?: number };
    assert.equal(e.statusCode, 400);
    assert.equal(e.code, 'NOT_TRIAL');
    return true;
  });
  const t = await state(tx, id);
  assert.equal(t.trialEndsAt, null);
  assert.equal(t.isActive, false);
});
