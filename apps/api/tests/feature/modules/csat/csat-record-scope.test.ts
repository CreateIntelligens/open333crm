/**
 * CSAT 評分只能寫入「同租戶、同聯絡人」的工單（主規格 inbound-message-processing「CSAT 回覆的攔截」，AUDIT RLS-06）。
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

scenario('同租戶、同聯絡人的工單寫入評分', async (tx) => {
  const own = await createCase(tx, TENANT_A, 'own');
  const recorded = await recordCsatScore(tx, io, own.caseId, 5, undefined, {
    tenantId: TENANT_A,
    contactId: own.contactId,
  });
  assert.equal(recorded, true);
  const kase = await tx.case.findUnique({ where: { id: own.caseId } });
  assert.equal(kase?.csatScore, 5);
});

scenario('其他租戶的工單：不寫入、不送訊息', async (tx) => {
  const victim = await createCase(tx, TENANT_B, 'victim');
  const attacker = await createCase(tx, TENANT_A, 'attacker');
  const recorded = await recordCsatScore(tx, io, victim.caseId, 1, undefined, {
    tenantId: TENANT_A,
    contactId: attacker.contactId,
  });
  assert.equal(recorded, false);
  await assertUntouched(tx, victim);
});

scenario('同租戶其他聯絡人的工單：不寫入', async (tx) => {
  const victim = await createCase(tx, TENANT_A, 'victim');
  const attacker = await createCase(tx, TENANT_A, 'attacker');
  const recorded = await recordCsatScore(tx, io, victim.caseId, 1, undefined, {
    tenantId: TENANT_A,
    contactId: attacker.contactId,
  });
  assert.equal(recorded, false);
  await assertUntouched(tx, victim);
});

scenario('不存在的工單：回傳 false', async (tx) => {
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

/**
 * 評分後客服看得到結果（issue #444，主規格 csat-survey「評分後收件匣的問卷卡片顯示分數」「評分寫入工單時間軸」）：
 * 以真的資料庫驗證 metadata.caseId 的 JSON 條件，以及只更新同租戶的問卷訊息。
 */
async function addSurvey(tx: TenantDb, conversationId: string, caseId: string) {
  return tx.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'SYSTEM',
      contentType: 'csat',
      content: { text: '滿意度調查', caseId },
      metadata: { type: 'csat_survey', caseId },
    },
  });
}

scenario('客人評分後問卷卡片顯示分數', async (tx) => {
  const own = await createCase(tx, TENANT_A, 'card');
  const survey = await addSurvey(tx, own.conversationId, own.caseId);
  // 另一張工單的問卷不受影響
  const other = await createCase(tx, TENANT_A, 'card-other');
  const otherSurvey = await addSurvey(tx, other.conversationId, other.caseId);

  assert.equal(await recordCsatScore(tx, io, own.caseId, 2, undefined, { tenantId: TENANT_A, contactId: own.contactId }), true);

  const after = await tx.message.findUniqueOrThrow({ where: { id: survey.id } });
  const metadata = after.metadata as Record<string, unknown>;
  assert.equal(metadata.csatScore, 2);
  assert.equal(metadata.csatRatedBy, 'customer');
  assert.equal(metadata.caseId, own.caseId);
  const untouched = await tx.message.findUniqueOrThrow({ where: { id: otherSurvey.id } });
  assert.equal((untouched.metadata as Record<string, unknown>).csatScore, undefined);
});

scenario('客人評分後時間軸有評分與自動關閉紀錄', async (tx) => {
  const own = await createCase(tx, TENANT_A, 'timeline');
  await recordCsatScore(tx, io, own.caseId, 2, undefined, { tenantId: TENANT_A, contactId: own.contactId });

  const events = await tx.caseEvent.findMany({ where: { caseId: own.caseId }, orderBy: { createdAt: 'asc' } });
  const rated = events.find((e) => e.eventType === 'csat_rated');
  assert.ok(rated, '有 csat_rated 事件');
  assert.equal(rated.actorType, 'contact');
  assert.deepEqual(rated.payload, { score: 2, source: 'customer' });
  const closed = events.find((e) => e.eventType === 'status_changed');
  assert.ok(closed, '有自動關閉的 status_changed 事件');
  assert.equal(closed.actorType, 'system');
  assert.deepEqual(closed.payload, { from: 'RESOLVED', to: 'CLOSED', reason: 'csat_rated' });
});

scenario('客服代評的時間軸紀錄標明客服', async (tx) => {
  const own = await createCase(tx, TENANT_A, 'agent-rate');
  const survey = await addSurvey(tx, own.conversationId, own.caseId);
  const agent = await tx.agent.create({
    data: { tenantId: TENANT_A, email: `csat-agent-${Date.now()}@example.test`, name: '王小明', passwordHash: 'x', role: 'AGENT' },
  });

  assert.equal(await recordCsatScore(tx, io, own.caseId, 4, undefined, { tenantId: TENANT_A, agentId: agent.id }), true);

  const rated = await tx.caseEvent.findFirstOrThrow({ where: { caseId: own.caseId, eventType: 'csat_rated' } });
  assert.equal(rated.actorType, 'agent');
  assert.equal(rated.actorId, agent.id);
  assert.deepEqual(rated.payload, { score: 4, source: 'agent' });
  const after = await tx.message.findUniqueOrThrow({ where: { id: survey.id } });
  assert.equal((after.metadata as Record<string, unknown>).csatRatedBy, 'agent');
});

/**
 * 客人只能替已解決的工單評分（issue #520，change csat-rate-only-resolved-520）：
 * 工單重開或已結案後，客人點舊問卷不記分、不結案、不送感謝訊息。
 */
async function assertCustomerRatingRejected(tx: TenantDb, target: { caseId: string; conversationId: string }, status: string) {
  const kase = await tx.case.findUniqueOrThrow({ where: { id: target.caseId } });
  assert.equal(kase.status, status, '工單狀態不變');
  assert.equal(kase.csatScore, null, '沒有寫入分數');
  assert.equal(kase.csatRatedBy, null);
  const conversation = await tx.conversation.findUniqueOrThrow({ where: { id: target.conversationId } });
  assert.notEqual(conversation.status, 'CLOSED', '對話沒有被關閉');
  assert.equal(await tx.message.count({ where: { conversationId: target.conversationId } }), 0, '對話沒有感謝訊息');
  assert.equal(await tx.caseEvent.count({ where: { caseId: target.caseId } }), 0, '時間軸沒有評分或結案紀錄');
}

scenario('工單重開後客人點舊問卷', async (tx) => {
  const own = await createCase(tx, TENANT_A, 'reopened');
  await tx.case.update({ where: { id: own.caseId }, data: { status: 'IN_PROGRESS', csatSentAt: new Date() } });
  const recorded = await recordCsatScore(tx, io, own.caseId, 2, undefined, { tenantId: TENANT_A, contactId: own.contactId });
  assert.equal(recorded, false);
  await assertCustomerRatingRejected(tx, own, 'IN_PROGRESS');
});

scenario('逾時結案後客人點舊問卷', async (tx) => {
  const own = await createCase(tx, TENANT_A, 'timed-out');
  await tx.case.update({ where: { id: own.caseId }, data: { status: 'CLOSED', csatSentAt: new Date(), closedAt: new Date() } });
  const recorded = await recordCsatScore(tx, io, own.caseId, 5, undefined, { tenantId: TENANT_A, contactId: own.contactId });
  assert.equal(recorded, false);
  await assertCustomerRatingRejected(tx, own, 'CLOSED');
});

scenario('客服代評不限工單狀態', async (tx) => {
  const own = await createCase(tx, TENANT_A, 'agent-in-progress');
  await tx.case.update({ where: { id: own.caseId }, data: { status: 'IN_PROGRESS' } });
  const agent = await tx.agent.create({
    data: { tenantId: TENANT_A, email: `csat-agent-${own.caseId}@example.test`, name: 'csat-agent', passwordHash: 'x' },
  });
  const recorded = await recordCsatScore(tx, io, own.caseId, 4, undefined, { tenantId: TENANT_A, agentId: agent.id });
  assert.equal(recorded, true);
  const kase = await tx.case.findUniqueOrThrow({ where: { id: own.caseId } });
  assert.equal(kase.csatScore, 4);
  assert.equal(kase.csatRatedBy, 'agent');
});
