/**
 * 排程讀取租戶之後、更新之前，平台延長或停用租戶，或另一次排程先處理（PR #312 審查意見）。
 *
 * 排程先撈出租戶清單，再逐一更新。平台的操作若發生在兩者之間，排程不能用讀到的
 * 舊狀態蓋掉操作的結果。測試把 tx 包一層：排程第一次讀到目標租戶時，先執行平台的
 * 操作，再把讀到的舊資料交給排程。每個測試在交易內執行，結束時 rollback。
 *
 * 提醒信換成 mock，以租戶名稱篩出本測試的呼叫。
 *
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, test, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { extendTrial } from '#src/modules/platform/trial-admin.service.js';
import { runTrialLifecycle } from '#src/modules/trial/trial.scheduler.js';
import { sendReminderEmail } from '#src/modules/trial/trial-emails.js';

vi.mock('#src/modules/trial/trial-emails.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#src/modules/trial/trial-emails.js')>()),
  sendReminderEmail: vi.fn(async () => {}),
}));

const prisma = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;

class Rollback extends Error {}

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.mocked(sendReminderEmail).mockClear();
});

let seq = 0;

type TenantData = { trialEndsAt: Date; isActive: boolean };

interface Fixture {
  tx: PrismaClient;
  /** 建立試用租戶與一位 ADMIN，回傳租戶 id。 */
  tenant: (data: TenantData) => Promise<string>;
  /** 本測試的租戶收到的提醒信數。 */
  reminders: () => number;
}

/** 回傳包過的 tx：tenant.findMany 第一次讀到 id 時，在交回結果之前執行 action。 */
function afterSnapshot(tx: PrismaClient, id: string, action: () => Promise<unknown>): PrismaClient {
  let done = false;
  const tenant = new Proxy(tx.tenant, {
    get(target, prop, receiver) {
      if (prop !== 'findMany') return Reflect.get(target, prop, receiver);
      return async (args: Parameters<PrismaClient['tenant']['findMany']>[0]) => {
        const rows = await target.findMany(args);
        if (!done && rows.some((r) => r.id === id)) {
          done = true;
          await action();
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
function scenario(name: string, fn: (f: Fixture) => Promise<void>) {
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
          await fn({
            tx,
            tenant: async (data) => {
              const { id } = await tx.tenant.create({ data: { name: tag, ...data } });
              await tx.agent.create({
                data: { tenantId: id, email: `${tag}@example.com`, name: tag, role: 'ADMIN', passwordHash: 'x' },
              });
              return id;
            },
            reminders: () =>
              vi.mocked(sendReminderEmail).mock.calls.filter(([, vars]) => vars.siteName === tag).length,
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
  tx.tenant.findUniqueOrThrow({
    where: { id },
    select: { isActive: true, purgedAt: true, trialRemindersSent: true },
  });

const audits = (tx: PrismaClient, action: string, id: string) =>
  tx.platformAuditLog.count({ where: { action, targetId: id } });

scenario('排程讀取後延長：到期的租戶不被停用', async ({ tx, tenant }) => {
  const id = await tenant({ trialEndsAt: new Date(Date.now() - DAY), isActive: true });

  await runTrialLifecycle(afterSnapshot(tx, id, () => extendTrial(tx, id, 7)));

  assert.equal((await state(tx, id)).isActive, true);
  assert.equal(await audits(tx, 'tenant.trial.expire', id), 0);
});

scenario('排程讀取後延長：保留期滿的租戶不被標記', async ({ tx, tenant }) => {
  const id = await tenant({ trialEndsAt: new Date(Date.now() - 40 * DAY), isActive: false });

  await runTrialLifecycle(afterSnapshot(tx, id, () => extendTrial(tx, id, 7)));

  const t = await state(tx, id);
  assert.equal(t.purgedAt, null);
  assert.equal(t.isActive, true);
  assert.equal(await audits(tx, 'tenant.trial.purge', id), 0);
});

scenario('排程讀取後延長：不寄舊到期日的提醒，提醒標記維持清空', async ({ tx, tenant, reminders }) => {
  const id = await tenant({ trialEndsAt: new Date(Date.now() + 5 * DAY), isActive: true });

  await runTrialLifecycle(afterSnapshot(tx, id, () => extendTrial(tx, id, 7)));

  assert.equal(reminders(), 0);
  assert.deepEqual((await state(tx, id)).trialRemindersSent, []);
});

scenario('排程讀取後停用：不寄提醒，也不寫提醒標記', async ({ tx, tenant, reminders }) => {
  const id = await tenant({ trialEndsAt: new Date(Date.now() + 5 * DAY), isActive: true });

  await runTrialLifecycle(
    afterSnapshot(tx, id, () => tx.tenant.update({ where: { id }, data: { isActive: false } })),
  );

  assert.equal(reminders(), 0);
  assert.deepEqual((await state(tx, id)).trialRemindersSent, []);
});

scenario('兩次排程同時讀到同一個租戶：提醒只寄一次', async ({ tx, tenant, reminders }) => {
  const id = await tenant({ trialEndsAt: new Date(Date.now() + 5 * DAY), isActive: true });

  await runTrialLifecycle(afterSnapshot(tx, id, () => runTrialLifecycle(tx)));

  assert.equal(reminders(), 1);
  assert.deepEqual((await state(tx, id)).trialRemindersSent, [7]);
});

scenario('沒有競態時照常寄提醒並寫入標記', async ({ tx, tenant, reminders }) => {
  const id = await tenant({ trialEndsAt: new Date(Date.now() + 5 * DAY), isActive: true });

  await runTrialLifecycle(tx);

  assert.equal(reminders(), 1);
  assert.deepEqual((await state(tx, id)).trialRemindersSent, [7]);
});
