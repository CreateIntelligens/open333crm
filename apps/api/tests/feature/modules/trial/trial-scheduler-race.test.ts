/**
 * 排程讀取租戶之後、更新之前，平台延長試用（PR #312 審查意見）。
 *
 * 排程先撈出租戶清單，再逐一更新。延長若發生在兩者之間，排程不能用讀到的舊狀態
 * 蓋掉延長的結果。測試把 tx 包一層：排程第一次讀到目標租戶時，先執行延長，
 * 再把讀到的舊資料交給排程。每個測試在交易內執行，結束時 rollback。
 *
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { extendTrial } from '#src/modules/platform/trial-admin.service.js';
import { runTrialLifecycle } from '#src/modules/trial/trial.scheduler.js';

const prisma = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;

class Rollback extends Error {}

afterAll(async () => {
  await prisma.$disconnect();
});

let seq = 0;

type TenantData = { trialEndsAt: Date; isActive: boolean };

/** 回傳包過的 tx：tenant.findMany 第一次讀到 id 時，在交回結果之前執行 extendTrial(id, 7)。 */
function extendAfterSnapshot(tx: PrismaClient, id: string): PrismaClient {
  let done = false;
  const tenant = new Proxy(tx.tenant, {
    get(target, prop, receiver) {
      if (prop !== 'findMany') return Reflect.get(target, prop, receiver);
      return async (args: Parameters<PrismaClient['tenant']['findMany']>[0]) => {
        const rows = await target.findMany(args);
        if (!done && rows.some((r) => r.id === id)) {
          done = true;
          await extendTrial(tx, id, 7);
        }
        return rows;
      };
    },
  });
  return new Proxy(tx, {
    get: (target, prop, receiver) => (prop === 'tenant' ? tenant : Reflect.get(target, prop, receiver)),
  });
}

/** 在交易內執行，結束時 rollback。保留天數固定為 30 天，提醒檔位固定為 7 天與 1 天。 */
function scenario(name: string, fn: (tx: PrismaClient, tenant: (data: TenantData) => Promise<string>) => Promise<void>) {
  test(name, async () => {
    await assert.rejects(
      prisma.$transaction(
        async (raw) => {
          const tx = raw as unknown as PrismaClient;
          const tag = `trial-race-${Date.now()}-${seq++}`;
          for (const [key, value] of [
            ['trial.dataRetentionDays', 30],
            ['trial.reminderDaysBefore', [7, 1]],
          ] as const) {
            await tx.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
          }
          await fn(tx, async (data) => (await tx.tenant.create({ data: { name: tag, ...data } })).id);
          throw new Rollback();
        },
        { timeout: 30_000 },
      ),
      Rollback,
    );
  });
}

const state = (tx: PrismaClient, id: string) =>
  tx.tenant.findUniqueOrThrow({
    where: { id },
    select: { isActive: true, purgedAt: true, trialRemindersSent: true },
  });

const audits = (tx: PrismaClient, action: string, id: string) =>
  tx.platformAuditLog.count({ where: { action, targetId: id } });

scenario('排程讀取後延長：到期的租戶不被停用', async (tx, tenant) => {
  const id = await tenant({ trialEndsAt: new Date(Date.now() - DAY), isActive: true });

  await runTrialLifecycle(extendAfterSnapshot(tx, id));

  assert.equal((await state(tx, id)).isActive, true);
  assert.equal(await audits(tx, 'tenant.trial.expire', id), 0);
});

scenario('排程讀取後延長：保留期滿的租戶不被標記', async (tx, tenant) => {
  const id = await tenant({ trialEndsAt: new Date(Date.now() - 40 * DAY), isActive: false });

  await runTrialLifecycle(extendAfterSnapshot(tx, id));

  const t = await state(tx, id);
  assert.equal(t.purgedAt, null);
  assert.equal(t.isActive, true);
  assert.equal(await audits(tx, 'tenant.trial.purge', id), 0);
});

scenario('排程讀取後延長：提醒標記維持清空', async (tx, tenant) => {
  const id = await tenant({ trialEndsAt: new Date(Date.now() + 5 * DAY), isActive: true });

  await runTrialLifecycle(extendAfterSnapshot(tx, id));

  assert.deepEqual((await state(tx, id)).trialRemindersSent, []);
});
