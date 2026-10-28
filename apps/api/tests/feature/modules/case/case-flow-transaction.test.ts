/**
 * case 的 flow 對真實 PostgreSQL 的行為（#337 階段 3）：
 * - 建立工單與 case.created 事件一起 commit（主規格 event-delivery「事件與資料一起 commit」）。
 * - 刪除工單與稽核一起 commit；稽核寫入失敗時刪除也 rollback（主規格 tenant-audit-log「交易內的稽核與主操作一起 commit」）。
 * - 推播在 commit 之後送出，rollback 時不送出（主規格 tenant-transaction-context）。
 *
 * flow 以 app_tenant 連線開交易（RLS 生效）；建立與清理資料用 owner 連線。
 * 事件寫進真實的 outbox，快路徑不送進 Redis。本檔建立的資料以 MARK 標記，於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { createOutboxPublisher, type EventPublisher } from '#src/events/outbox-publisher.js';
import type { RequestActor } from '#src/lib/request-actor.js';
import { createCaseFlow, deleteCaseFlow } from '#src/modules/case/case.flow.js';
import { TENANT_A } from '#tests/setup/feature-config.js';
import { recordingIo, type PushRecord } from '#tests/support/tenant-run.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `ci-case-flow-${Date.now().toString(36)}`;

const pushes: PushRecord[] = [];
/** 寫進真實的 outbox；快路徑不送進 Redis */
const events: EventPublisher = { write: createOutboxPublisher(prisma).write, dispatch: async () => {} };
const deps = { prisma, io: recordingIo(pushes), events };

const agent = await owner.agent.create({
  data: { tenantId: T, email: `${MARK}@example.test`, name: MARK, passwordHash: 'x', role: 'AGENT' },
});
const channel = await owner.channel.create({
  data: { tenantId: T, channelType: 'WEBCHAT', isActive: true, displayName: MARK, credentialsEncrypted: 'x' },
});
const contact = await owner.contact.create({ data: { tenantId: T, displayName: MARK } });
await owner.channelIdentity.create({
  data: { contactId: contact.id, channelId: channel.id, channelType: 'WEBCHAT', uid: MARK },
});

const actor: RequestActor = { tenantId: T, agentId: agent.id, roleId: null, ip: '127.0.0.1' };
/** 不存在的成員：稽核的 actorId 違反外鍵，用來讓稽核寫入失敗 */
const ghost: RequestActor = { ...actor, agentId: randomUUID() };

const createdCaseIds: string[] = [];
async function createCase() {
  const created = await createCaseFlow(deps, actor, { contactId: contact.id, channelId: channel.id, title: MARK });
  createdCaseIds.push(created.id);
  return created;
}

beforeEach(() => {
  pushes.length = 0;
});

afterAll(async () => {
  await owner.tenantAuditLog.deleteMany({ where: { targetId: { in: createdCaseIds } } });
  for (const caseId of createdCaseIds) {
    await owner.outbox.deleteMany({ where: { payload: { path: ['caseId'], equals: caseId } } });
  }
  await owner.caseEvent.deleteMany({ where: { caseId: { in: createdCaseIds } } });
  await owner.case.deleteMany({ where: { id: { in: createdCaseIds } } });
  await owner.channelIdentity.deleteMany({ where: { channelId: channel.id } });
  await owner.contact.deleteMany({ where: { id: contact.id } });
  await owner.channel.deleteMany({ where: { id: channel.id } });
  await owner.agent.deleteMany({ where: { id: agent.id } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

test('建立工單：工單與 case.created 事件一起 commit，commit 之後推播', async () => {
  const created = await createCase();

  const row = await owner.case.findUnique({ where: { id: created.id } });
  assert.equal(row?.tenantId, T);
  const outbox = await owner.outbox.findMany({ where: { name: 'case.created', payload: { path: ['caseId'], equals: created.id } } });
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].tenantId, T);
  assert.deepEqual(
    pushes.map((p) => [p.room, p.event]),
    [[`tenant:${T}`, 'case.created']],
  );
});

test('刪除工單：刪除與稽核一起 commit', async () => {
  const created = await createCase();
  pushes.length = 0;

  assert.deepEqual(await deleteCaseFlow(deps, actor, created.id), { id: created.id });

  assert.equal(await owner.case.findUnique({ where: { id: created.id } }), null);
  const audits = await owner.tenantAuditLog.findMany({ where: { action: 'case.delete', targetId: created.id } });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].tenantId, T);
  assert.equal(audits[0].actorId, agent.id);
  assert.deepEqual(pushes.map((p) => p.event), ['case.deleted']);
});

test('刪除工單時稽核寫入失敗：工單沒有被刪除，也不推播', async () => {
  const created = await createCase();
  pushes.length = 0;

  await assert.rejects(() => deleteCaseFlow(deps, ghost, created.id));

  assert.ok(await owner.case.findUnique({ where: { id: created.id } }), '稽核失敗時刪除要一起 rollback');
  assert.equal(await owner.tenantAuditLog.count({ where: { targetId: created.id } }), 0);
  assert.equal(pushes.length, 0);
});
