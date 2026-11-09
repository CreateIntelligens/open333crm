/**
 * 共用的轉接真人步驟對真實 PostgreSQL 與 app_tenant（RLS）的行為（issue #419，change fix-kb-clarify-handoff-419：
 * bot-handoff-config「知識庫追問用完或 AI 失敗時轉接真人」）。
 *
 * 以 admin 連線建立渠道、聯絡人與 BOT_HANDLED 對話，afterAll 刪除；outbox 用真的 writeOutbox，
 * commit 後的快路徑換成不做事的實作（不連 Redis）。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { writeOutbox } from '@open333crm/core';
import { inTenant } from '#src/lib/tenant-ctx.js';
import type { EventPublisher } from '#src/events/outbox-publisher.js';
import { handOffConversation } from '#src/modules/automation/handoff.flow.js';

const TENANT_URL = process.env.DATABASE_URL_TENANT;
const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const TENANT_A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const TENANT_B = process.env.RLS_TEST_TENANT_B;

if (!TENANT_URL || !ADMIN_URL || !TENANT_B) {
  throw new Error('handoff-flow 需要 DATABASE_URL_TENANT / DATABASE_URL_ADMIN / RLS_TEST_TENANT_B，由 tests/setup/feature.env.ts 提供');
}

const tenantDb = new PrismaClient({ datasources: { db: { url: TENANT_URL } } });
const adminDb = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
const stamp = randomUUID().slice(0, 8);
const events: EventPublisher = { write: (tx, input) => writeOutbox(tx, input), dispatch: async () => {} };
const emitted: Array<{ rooms: string[]; name: string }> = [];
const io = {
  to: (rooms: string | string[]) => ({
    emit: (name: string) => emitted.push({ rooms: Array.isArray(rooms) ? rooms : [rooms], name }),
  }),
} as never;

let channelId = '';
let contactId = '';

beforeAll(async () => {
  const channel = await adminDb.channel.create({
    data: { tenantId: TENANT_A, channelType: 'LINE', displayName: `轉接測試-${stamp}`, credentialsEncrypted: 'x', isActive: true },
  });
  channelId = channel.id;
  const contact = await adminDb.contact.create({ data: { tenantId: TENANT_A, displayName: `轉接測試-${stamp}` } });
  contactId = contact.id;
});

afterAll(async () => {
  const conversations = await adminDb.conversation.findMany({ where: { tenantId: TENANT_A, channelId }, select: { id: true } });
  const ids = conversations.map((c) => c.id);
  await adminDb.outbox.deleteMany({ where: { tenantId: TENANT_A, name: 'conversation.handoff', payload: { path: ['marker'], equals: stamp } } });
  await adminDb.message.deleteMany({ where: { conversationId: { in: ids } } });
  await adminDb.conversation.deleteMany({ where: { id: { in: ids } } });
  await adminDb.contact.deleteMany({ where: { id: contactId } });
  await adminDb.channel.deleteMany({ where: { id: channelId } });
  await tenantDb.$disconnect();
  await adminDb.$disconnect();
});

async function botConversation() {
  return adminDb.conversation.create({
    data: { tenantId: TENANT_A, contactId, channelId, channelType: 'LINE', status: 'BOT_HANDLED' },
  });
}

function input(conversationId: string) {
  return {
    conversationId,
    channelId,
    reason: '知識庫找不到可回答的內容，追問次數已達上限（2/2）',
    now: new Date(),
    systemContent: { text: '自動轉接人工客服：知識庫找不到可回答的內容' },
    systemMetadata: { type: 'auto_handoff', source: 'kb_auto_reply' },
  };
}

// 測試資料的 outbox 列帶 marker，afterAll 只刪自己的
const markedEvents: EventPublisher = {
  write: (tx, row) => events.write(tx, { ...row, payload: { ...(row.payload as object), marker: stamp } } as never),
  dispatch: async () => {},
};

test('追問次數用完：對話轉真人、寫入轉真人原因與系統訊息、發出 conversation.handoff', async () => {
  const conv = await botConversation();
  emitted.length = 0;
  const result = await inTenant(tenantDb, TENANT_A, (scope) => handOffConversation(scope, { io, events: markedEvents }, input(conv.id)));
  assert.ok(result);

  const after = await adminDb.conversation.findUniqueOrThrow({ where: { id: conv.id } });
  assert.equal(after.status, 'AGENT_HANDLED');
  assert.match(after.handoffReason ?? '', /追問次數已達上限/);
  const system = await adminDb.message.findMany({ where: { conversationId: conv.id, senderType: 'SYSTEM' } });
  assert.equal(system.length, 1);
  const outbox = await adminDb.outbox.findMany({ where: { tenantId: TENANT_A, name: 'conversation.handoff', payload: { path: ['conversationId'], equals: conv.id } } });
  assert.equal(outbox.length, 1);
  // commit 之後才推播，送到渠道房間
  assert.deepEqual(emitted.map((e) => e.name).sort(), ['conversation.updated', 'message.new']);
  assert.ok(emitted.every((e) => e.rooms.includes(`tenant:${TENANT_A}:channel:${channelId}`) && !e.rooms.includes(`tenant:${TENANT_A}`)));
});

test('同一則訊息處理兩次：只轉接一次', async () => {
  const conv = await botConversation();
  await inTenant(tenantDb, TENANT_A, (scope) => handOffConversation(scope, { io, events: markedEvents }, input(conv.id)));
  const second = await inTenant(tenantDb, TENANT_A, (scope) => handOffConversation(scope, { io, events: markedEvents }, input(conv.id)));
  assert.equal(second, null);
  assert.equal(await adminDb.message.count({ where: { conversationId: conv.id, senderType: 'SYSTEM' } }), 1);
  assert.equal(
    await adminDb.outbox.count({ where: { tenantId: TENANT_A, name: 'conversation.handoff', payload: { path: ['conversationId'], equals: conv.id } } }),
    1,
  );
});

test('別的租戶的對話：不轉接，不寫入任何資料', async () => {
  const conv = await botConversation();
  const result = await inTenant(tenantDb, TENANT_B, (scope) => handOffConversation(scope, { io, events: markedEvents }, input(conv.id)));
  assert.equal(result, null);
  const after = await adminDb.conversation.findUniqueOrThrow({ where: { id: conv.id } });
  assert.equal(after.status, 'BOT_HANDLED');
  assert.equal(await adminDb.message.count({ where: { conversationId: conv.id } }), 0);
});
