/**
 * 工單首次回應時間（AUDIT SLA-01，issue #197）：客服第一次在工單關聯的對話送出訊息時寫入 Case.firstResponseAt。
 * 原本沒有任何寫入端，套了 SLA 的工單時間一到必定判定「首次回應逾時」，且每 24 小時重發一次假警報。
 *
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import { sendMessage } from '#src/modules/conversation/conversation.service.js';

loadEnvConfig();
const prisma = new PrismaClient();
const T = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const stamp = Date.now();
const io = { to: () => ({ emit: () => {} }) } as never;
const db = tenantScopedClient(prisma, T);

const agent = await prisma.agent.create({
  data: { tenantId: T, email: `ci-first-response-${stamp}@example.test`, name: 'CI 客服', passwordHash: 'x', role: 'AGENT' },
});
// 停用的渠道：sendMessage 照常寫入訊息，只是不對外送出，測試不需要假的平台 API
const channel = await prisma.channel.create({
  data: { tenantId: T, channelType: 'WEBCHAT', displayName: `CI 首次回應 ${stamp}`, isActive: false, credentialsEncrypted: encryptCredentials({}) },
});
const contact = await prisma.contact.create({ data: { tenantId: T, displayName: `CI 首次回應顧客 ${stamp}` } });

async function caseWithConversation(createdAt = new Date()) {
  const c = await prisma.case.create({
    data: { tenantId: T, contactId: contact.id, channelId: channel.id, title: `CI 首次回應 ${stamp}`, slaPolicy: 'CI', createdAt },
  });
  const conv = await prisma.conversation.create({
    data: { tenantId: T, contactId: contact.id, channelId: channel.id, channelType: 'WEBCHAT', caseId: c.id },
  });
  return { c, conv };
}
const firstResponseOf = async (id: string) => (await prisma.case.findUnique({ where: { id }, select: { firstResponseAt: true } }))?.firstResponseAt;

test('客服在工單關聯的對話第一次送出訊息：寫入首次回應時間', async () => {
  const { c, conv } = await caseWithConversation();
  assert.equal(await firstResponseOf(c.id), null);
  await sendMessage(db, io, conv.id, agent.id, T, { contentType: 'text', content: { text: '您好' } });
  const at = await firstResponseOf(c.id);
  assert.ok(at, '應寫入首次回應時間');
  assert.ok(at!.getTime() >= c.createdAt.getTime());
});

test('之後再送訊息：首次回應時間不變', async () => {
  const { c, conv } = await caseWithConversation();
  await sendMessage(db, io, conv.id, agent.id, T, { contentType: 'text', content: { text: '第一則' } });
  const first = await firstResponseOf(c.id);
  await new Promise((r) => setTimeout(r, 20));
  await sendMessage(db, io, conv.id, agent.id, T, { contentType: 'text', content: { text: '第二則' } });
  assert.equal((await firstResponseOf(c.id))?.getTime(), first?.getTime());
});

test('沒有關聯工單的對話：送訊息不影響任何工單', async () => {
  const { c } = await caseWithConversation();
  const conv = await prisma.conversation.create({ data: { tenantId: T, contactId: contact.id, channelId: channel.id, channelType: 'WEBCHAT' } });
  await sendMessage(db, io, conv.id, agent.id, T, { contentType: 'text', content: { text: '一般對話' } });
  assert.equal(await firstResponseOf(c.id), null);
});

afterAll(async () => {
  const convs = await prisma.conversation.findMany({ where: { channelId: channel.id }, select: { id: true } });
  await prisma.message.deleteMany({ where: { conversationId: { in: convs.map((x) => x.id) } } });
  await prisma.conversation.deleteMany({ where: { channelId: channel.id } });
  await prisma.caseEvent.deleteMany({ where: { case: { channelId: channel.id } } });
  await prisma.case.deleteMany({ where: { channelId: channel.id } });
  await prisma.contact.deleteMany({ where: { id: contact.id } });
  await prisma.channel.deleteMany({ where: { id: channel.id } });
  await prisma.agent.deleteMany({ where: { id: agent.id } });
  await prisma.$disconnect();
});
