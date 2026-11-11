/**
 * tag 的 flow 對真實 PostgreSQL 的行為（#337 階段 3）：
 * - 貼聯絡人標籤時，貼標與 contact.tagged 事件一起 commit（主規格 event-delivery「事件與資料一起 commit」）。
 * - 貼標失敗時，貼標與事件都沒有寫入。
 * - 刪除標籤時，標籤與它的貼標一起刪除。
 *
 * flow 以 app_tenant 連線開交易（RLS 生效）；建立與清理資料用 owner 連線。
 * 事件寫進真實的 outbox，快路徑不送進 Redis。本檔建立的資料以 MARK 標記，於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { createOutboxPublisher, type EventPublisher } from '#src/events/outbox-publisher.js';
import { addTagToTargetFlow, deleteTagFlow } from '#src/modules/tag/tag.flow.js';
import { TENANT_A } from '#tests/setup/feature-config.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `ci-tag-flow-${Date.now().toString(36)}`;

/** 寫進真實的 outbox；快路徑不送進 Redis */
const events: EventPublisher = { write: createOutboxPublisher(prisma).write, dispatch: async () => {} };
const deps = { prisma, events };

const contact = await owner.contact.create({ data: { tenantId: T, displayName: MARK } });
const contactTag = await owner.tag.create({ data: { tenantId: T, name: `${MARK}-聯絡人`, scope: 'CONTACT' } });
const caseTag = await owner.tag.create({ data: { tenantId: T, name: `${MARK}-工單`, scope: 'CASE' } });

const outboxOf = () =>
  owner.outbox.findMany({ where: { name: 'contact.tagged', payload: { path: ['contactId'], equals: contact.id } } });

afterAll(async () => {
  await owner.outbox.deleteMany({ where: { payload: { path: ['contactId'], equals: contact.id } } });
  await owner.contactTag.deleteMany({ where: { contactId: contact.id } });
  await owner.tag.deleteMany({ where: { tenantId: T, name: { startsWith: MARK } } });
  await owner.contact.deleteMany({ where: { id: contact.id } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

test('貼聯絡人標籤：貼標與 contact.tagged 一起 commit', async () => {
  await addTagToTargetFlow(deps, T, { targetType: 'CONTACT', targetId: contact.id, tagId: contactTag.id, addedBy: 'system' });

  assert.ok(await owner.contactTag.findUnique({ where: { contactId_tagId: { contactId: contact.id, tagId: contactTag.id } } }));
  const rows = await outboxOf();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tenantId, T);
  assert.deepEqual(rows[0].payload, { contactId: contact.id, tagId: contactTag.id, tagName: contactTag.name, source: 'system' });
});

test('貼標失敗（標籤範圍不符）：貼標與事件都沒有寫入', async () => {
  const before = (await outboxOf()).length;

  await assert.rejects(
    () => addTagToTargetFlow(deps, T, { targetType: 'CONTACT', targetId: contact.id, tagId: caseTag.id }),
    (err: { code?: string }) => err.code === 'TAG_SCOPE_MISMATCH',
  );

  assert.equal(await owner.contactTag.count({ where: { contactId: contact.id, tagId: caseTag.id } }), 0);
  assert.equal((await outboxOf()).length, before);
});

test('刪除標籤：標籤與它的貼標一起刪除', async () => {
  const tag = await owner.tag.create({ data: { tenantId: T, name: `${MARK}-刪除`, scope: 'CONTACT' } });
  await owner.contactTag.create({ data: { contactId: contact.id, tagId: tag.id, addedBy: 'agent' } });

  assert.deepEqual(await deleteTagFlow(deps, T, tag.id), { deleted: true });

  assert.equal(await owner.tag.findUnique({ where: { id: tag.id } }), null);
  assert.equal(await owner.contactTag.count({ where: { tagId: tag.id } }), 0);
});
