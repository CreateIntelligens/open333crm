/**
 * 轉為付費方案時脫離試用（change fix-csat-intercept-and-trial-upgrade，AUDIT TRIAL-01）。
 *
 * trial-signup 的設計把「試用轉正式」交給 plan-change-request，但核准升級時沒有清 trialEndsAt，
 * 已付費的租戶到了原本的試用到期日會被排程停用。這裡驗證核准升級、轉付費與排程三者的接續。
 * 每個測試在交易內建立方案、租戶與申請，結束時 rollback。
 *
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { approveRequest, createPlanChangeRequest } from '#src/modules/platform/plan-change.service.js';
import { convertToPaid } from '#src/modules/platform/trial-admin.service.js';
import { updateTenant } from '#src/modules/platform/platform-tenant.service.js';
import { runTrialLifecycle } from '#src/modules/trial/trial.scheduler.js';

const prisma = new PrismaClient();
const REVIEWER = '00000000-0000-4000-8000-0000000000ff';
const DAY = 24 * 60 * 60 * 1000;

class Rollback extends Error {}

afterAll(async () => {
  await prisma.$disconnect();
});

let seq = 0;

interface Fixture {
  tx: PrismaClient;
  trialPlan: { id: string; slug: string };
  paidPlan: { id: string; slug: string };
  tenant: (data: { trialEndsAt: Date | null; isActive?: boolean; purgedAt?: Date | null }) => Promise<string>;
  request: (tenantId: string, type: 'upgrade' | 'token_topup', targetPlanSlug?: string) => Promise<string>;
}

/** 在交易內執行，結束時 rollback，不留資料。 */
function scenario(name: string, fn: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    await assert.rejects(
      prisma.$transaction(async (raw) => {
        const tx = raw as unknown as PrismaClient;
        const tag = `trial-exit-${Date.now()}-${seq++}`;
        const trialPlan = await tx.plan.create({
          data: { slug: `${tag}-trial`, name: 'trial', limits: { monthlyTokens: 1000 } },
        });
        const paidPlan = await tx.plan.create({
          data: { slug: `${tag}-paid`, name: 'paid', limits: { monthlyTokens: 100000 } },
        });
        // 試用政策指向本測試的試用方案（slug 不是 'trial'，確認判斷讀的是政策而非寫死的字串）
        await tx.platformSetting.upsert({
          where: { key: 'trial.planSlug' },
          create: { key: 'trial.planSlug', value: trialPlan.slug },
          update: { value: trialPlan.slug },
        });
        await fn({
          tx,
          trialPlan,
          paidPlan,
          tenant: async (data) =>
            (await tx.tenant.create({ data: { name: tag, planId: trialPlan.id, ...data } })).id,
          request: async (tenantId, type, targetPlanSlug = paidPlan.slug) =>
            (
              await tx.planChangeRequest.create({
                data:
                  type === 'upgrade'
                    ? { tenantId, type, targetPlanSlug }
                    : { tenantId, type, topupTokens: 500 },
              })
            ).id,
        });
        throw new Rollback();
      }),
      Rollback,
    );
  });
}

const state = (tx: PrismaClient, id: string) =>
  tx.tenant.findUniqueOrThrow({
    where: { id },
    select: { planId: true, trialEndsAt: true, isActive: true, purgedAt: true },
  });

scenario('核准試用租戶的升級申請：脫離試用', async ({ tx, paidPlan, tenant, request }) => {
  const id = await tenant({ trialEndsAt: new Date(Date.now() + 7 * DAY), isActive: true });
  const result = await approveRequest(tx, await request(id, 'upgrade'), REVIEWER);

  const t = await state(tx, id);
  assert.equal(t.planId, paidPlan.id);
  assert.equal(t.trialEndsAt, null);
  assert.equal(t.isActive, true);
  assert.equal(result.trialExited, true);
});

scenario('申請審核期間試用已到期並被軟刪：核准後恢復啟用並清除軟刪標記', async ({ tx, tenant, request }) => {
  const id = await tenant({
    trialEndsAt: new Date(Date.now() - 40 * DAY),
    isActive: false,
    purgedAt: new Date(Date.now() - 5 * DAY),
  });
  await approveRequest(tx, await request(id, 'upgrade'), REVIEWER);

  const t = await state(tx, id);
  assert.equal(t.trialEndsAt, null);
  assert.equal(t.purgedAt, null);
  assert.equal(t.isActive, true);
});

scenario('核准非試用租戶的升級申請：不改變啟用狀態', async ({ tx, paidPlan, tenant, request }) => {
  const id = await tenant({ trialEndsAt: null, isActive: false });
  const result = await approveRequest(tx, await request(id, 'upgrade'), REVIEWER);

  const t = await state(tx, id);
  assert.equal(t.planId, paidPlan.id);
  assert.equal(t.isActive, false, '平台停用的付費租戶不會因為核准升級而被啟用');
  assert.equal(result.trialExited, false);
});

scenario('核准試用租戶的加購申請：仍在試用', async ({ tx, tenant, request }) => {
  const endsAt = new Date(Date.now() + 7 * DAY);
  const id = await tenant({ trialEndsAt: endsAt, isActive: true });
  await approveRequest(tx, await request(id, 'token_topup'), REVIEWER);

  const t = await state(tx, id);
  assert.equal(t.trialEndsAt?.getTime(), endsAt.getTime());
});

scenario('轉付費清除軟刪標記', async ({ tx, paidPlan, tenant }) => {
  const id = await tenant({
    trialEndsAt: new Date(Date.now() - 40 * DAY),
    isActive: false,
    purgedAt: new Date(Date.now() - 5 * DAY),
  });
  await convertToPaid(tx, id, paidPlan.slug);

  const t = await state(tx, id);
  assert.equal(t.trialEndsAt, null);
  assert.equal(t.purgedAt, null);
  assert.equal(t.isActive, true);
});

scenario('平台在編輯頁改方案不脫離試用', async ({ tx, paidPlan, tenant }) => {
  const endsAt = new Date(Date.now() + 7 * DAY);
  const id = await tenant({ trialEndsAt: endsAt, isActive: true });
  await updateTenant(tx, id, { planSlug: paidPlan.slug });

  const t = await state(tx, id);
  assert.equal(t.planId, paidPlan.id);
  assert.equal(t.trialEndsAt?.getTime(), endsAt.getTime());
});

scenario('脫離試用後不被到期排程停用', async ({ tx, tenant, request }) => {
  const id = await tenant({ trialEndsAt: new Date(Date.now() - DAY), isActive: true });
  await approveRequest(tx, await request(id, 'upgrade'), REVIEWER);

  await runTrialLifecycle(tx);

  const t = await state(tx, id);
  assert.equal(t.isActive, true);
  const expired = await tx.platformAuditLog.count({
    where: { action: 'tenant.trial.expire', targetId: id },
  });
  assert.equal(expired, 0, '沒有寄出到期信，也沒有到期稽核');
});

/** AppError 400：試用方案不能當成升級或轉正式的目標 */
const isBadRequest = (err: unknown) => (err as { statusCode?: number }).statusCode === 400;

scenario('租戶申請升級到試用方案：回應 400，不建立申請', async ({ tx, trialPlan, tenant }) => {
  const id = await tenant({ trialEndsAt: new Date(Date.now() + 7 * DAY), isActive: true });
  await assert.rejects(
    createPlanChangeRequest(tx, id, { type: 'upgrade', targetPlanSlug: trialPlan.slug }),
    isBadRequest,
  );
  assert.equal(await tx.planChangeRequest.count({ where: { tenantId: id } }), 0);
});

scenario('平台核准目標為試用方案的升級申請：回應 400，租戶與申請不變', async ({ tx, trialPlan, tenant, request }) => {
  const endsAt = new Date(Date.now() + 7 * DAY);
  const id = await tenant({ trialEndsAt: endsAt, isActive: true });
  const requestId = await request(id, 'upgrade', trialPlan.slug);

  await assert.rejects(approveRequest(tx, requestId, REVIEWER), isBadRequest);

  const t = await state(tx, id);
  assert.equal(t.planId, trialPlan.id);
  assert.equal(t.trialEndsAt?.getTime(), endsAt.getTime());
  const req = await tx.planChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
  assert.equal(req.status, 'pending');
});

scenario('轉正式到試用方案：依試用政策判斷，回應 400', async ({ tx, trialPlan, tenant }) => {
  const endsAt = new Date(Date.now() + 7 * DAY);
  const id = await tenant({ trialEndsAt: endsAt, isActive: true });

  await assert.rejects(convertToPaid(tx, id, trialPlan.slug), isBadRequest);

  const t = await state(tx, id);
  assert.equal(t.trialEndsAt?.getTime(), endsAt.getTime());
});
