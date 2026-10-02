/**
 * CSAT 評分只能寫入「同租戶、同聯絡人」的工單（change fix-csat-intercept-and-trial-upgrade，AUDIT RLS-06）。
 *
 * 進站管線以 prismaAdmin（BYPASSRLS）呼叫 recordCsatScore()，RLS 擋不住跨租戶，
 * 因此這裡用同樣繞過 RLS 的 owner 連線，直接驗證應用層的查詢條件。
 * 每個測試在交易內建立資料，結束時 rollback。
 *
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { TenantDb } from '#src/lib/tenant-db.js';
import { recordCsatScore } from '#src/modules/csat/csat.service.js';
import { TENANT_A, TENANT_B } from '#tests/setup/feature-config.js';

const prisma = new PrismaClient();
const io = { to: () => ({ emit: () => true }) } as never;

class Rollback extends Error {}

afterAll(async () => {
  await prisma.$disconnect();
});

async function createCase(tx: TenantDb, tenantId: string, tag: string) {
  const channel = await tx.channel.create({
    data: { tenantId, channelType: 'WEBCHAT', displayName: `csat-${tag}`, credentialsEncrypted: 'x', isActive: true },
  });
  const contact = await tx.contact.create({ data: { tenantId, displayName: `csat-${tag}` } });
  const kase = await tx.case.create({
    data: { tenantId, contactId: contact.id, channelId: channel.id, title: `csat-${tag}`, status: 'RESOLVED' },
  });
  const conversation = await tx.conversation.create({
    data: { tenantId, contactId: contact.id, channelId: channel.id, channelType: 'WEBCHAT', caseId: kase.id },
  });
  return { caseId: kase.id, contactId: contact.id, conversationId: conversation.id };
}

/** 在交易內執行，結束時 rollback，不留資料。 */
async function scenario(name: string, fn: (tx: TenantDb) => Promise<void>) {
  test(name, async () => {
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await fn(tx as unknown as TenantDb);
        throw new Rollback();
      }),
      Rollback,
    );
  });
}

async function assertUntouched(tx: TenantDb, target: { caseId: string; conversationId: string }) {
  const kase = await tx.case.findUnique({ where: { id: target.caseId } });
  assert.equal(kase?.csatScore, null, '工單的評分沒有被寫入');
  assert.equal(kase?.csatRespondedAt, null);
  const messages = await tx.message.count({ where: { conversationId: target.conversationId } });
  assert.equal(messages, 0, '對話沒有新的感謝訊息');
}

scenario('CSAT response intercepted：同租戶、同聯絡人的工單寫入評分', async (tx) => {
  const own = await createCase(tx, TENANT_A, 'own');
  const recorded = await recordCsatScore(tx, io, own.caseId, 5, undefined, {
    tenantId: TENANT_A,
    contactId: own.contactId,
  });
  assert.equal(recorded, true);
  const kase = await tx.case.findUnique({ where: { id: own.caseId } });
  assert.equal(kase?.csatScore, 5);
});

scenario('CSAT response for a case of another tenant：不寫入、不送訊息', async (tx) => {
  const victim = await createCase(tx, TENANT_B, 'victim');
  const attacker = await createCase(tx, TENANT_A, 'attacker');
  const recorded = await recordCsatScore(tx, io, victim.caseId, 1, undefined, {
    tenantId: TENANT_A,
    contactId: attacker.contactId,
  });
  assert.equal(recorded, false);
  await assertUntouched(tx, victim);
});

scenario('CSAT response for a case of another contact：同租戶他人的工單不寫入', async (tx) => {
  const victim = await createCase(tx, TENANT_A, 'victim');
  const attacker = await createCase(tx, TENANT_A, 'attacker');
  const recorded = await recordCsatScore(tx, io, victim.caseId, 1, undefined, {
    tenantId: TENANT_A,
    contactId: attacker.contactId,
  });
  assert.equal(recorded, false);
  await assertUntouched(tx, victim);
});

scenario('CSAT response for a case that does not exist：回傳 false', async (tx) => {
  const recorded = await recordCsatScore(tx, io, '00000000-0000-4000-8000-000000000000', 5, undefined, {
    tenantId: TENANT_A,
  });
  assert.equal(recorded, false);
});

scenario('客服操作（不帶 contactId）只能寫入自己租戶的工單', async (tx) => {
  const other = await createCase(tx, TENANT_B, 'other');
  const recorded = await recordCsatScore(tx, io, other.caseId, 4, undefined, { tenantId: TENANT_A });
  assert.equal(recorded, false);
  await assertUntouched(tx, other);

  const own = await createCase(tx, TENANT_A, 'agent-own');
  assert.equal(await recordCsatScore(tx, io, own.caseId, 4, undefined, { tenantId: TENANT_A }), true);
});
