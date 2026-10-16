/**
 * 進站管線的一般訊息、CSAT 與 KB 回饋攔截（主規格 inbound-message-processing「一般進站訊息的保存與通知」
 * 「CSAT 回覆的攔截」「KB 回饋的攔截」，以及 core-inbox「Real-time WebSocket Broadcasting」）。
 * CSAT 的租戶與聯絡人條件另見 tests/feature/modules/csat/csat-record-scope.test.ts。
 *
 * 走真實的 processInboundMessage 與測試資料庫。對外送出訊息的 deliverToChannel 換成記錄呼叫的版本。
 * 租戶、成員、渠道、文章與工單都帶 stamp，afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, test, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const delivered = vi.hoisted(() => [] as Array<{ conversationId: string; payload: unknown }>);
vi.mock('#src/modules/conversation/conversation.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#src/modules/conversation/conversation.service.js')>()),
  deliverToChannel: async (_prisma: unknown, conversationId: string, payload: unknown) => {
    delivered.push({ conversationId, payload });
    return true;
  },
}));

import { loadEnvConfig } from '#src/config/env.js';
import { eventBus, type AppEvent } from '#src/events/event-bus.js';
import { processInboundMessage } from '#src/modules/webhook/webhook.service.js';

loadEnvConfig();

const prisma = new PrismaClient();
const stamp = Date.now();
const THANKS = '感謝您的回報，我們會持續改善 🙏';

const tenant = await prisma.tenant.create({ data: { name: `CI 進站管線測試 ${stamp}` } });
const otherTenant = await prisma.tenant.create({ data: { name: `CI 進站管線測試・其他租戶 ${stamp}` } });
const channel = await prisma.channel.create({
  data: { tenantId: tenant.id, channelType: 'WEBCHAT', displayName: `CI 進站管線測試 ${stamp}`, credentialsEncrypted: 'x' },
});
const mkArticle = async (tenantId: string) => {
  const author = await prisma.agent.create({
    data: { tenantId, email: `ci-inbound-${tenantId.slice(0, 8)}-${stamp}@example.test`, name: 'author', passwordHash: 'x', role: 'ADMIN' },
  });
  return prisma.kmArticle.create({
    data: { tenantId, title: 'FAQ', content: '內容', summary: '摘要', category: 'faq', createdById: author.id },
  });
};
const article = await mkArticle(tenant.id);
const otherArticle = await mkArticle(otherTenant.id);

afterAll(async () => {
  const tenantIds = [tenant.id, otherTenant.id];
  await prisma.kbArticleFeedback.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.kmArticle.deleteMany({ where: { tenantId: { in: tenantIds } } });
  const convs = await prisma.conversation.findMany({ where: { channelId: channel.id }, select: { id: true } });
  await prisma.message.deleteMany({ where: { conversationId: { in: convs.map((c) => c.id) } } });
  await prisma.conversation.deleteMany({ where: { channelId: channel.id } });
  await prisma.case.deleteMany({ where: { channelId: channel.id } });
  await prisma.channelIdentity.deleteMany({ where: { channelId: channel.id } });
  await prisma.contact.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.channel.delete({ where: { id: channel.id } });
  await prisma.agent.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenantSettings.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  delivered.length = 0;
});

let seq = 0;
async function receive(uid: string, text: string) {
  const sockets: Array<{ room: string; event: string }> = [];
  const io = { to: (room: string) => ({ emit: (event: string) => sockets.push({ room, event }) }) };
  const events: AppEvent[] = [];
  const handler = (event: AppEvent) => events.push(event);
  eventBus.subscribe('*', handler);
  try {
    const result = await processInboundMessage(prisma, io as never, {}, channel, tenant.id, {
      contactUid: uid,
      channelMsgId: `ci-inbound-${stamp}-${seq++}`,
      timestamp: new Date(),
      contentType: 'text',
      content: { text },
    });
    return { result, sockets, events };
  } finally {
    eventBus.unsubscribe('*', handler);
  }
}

/** 先讓訪客送一則一般訊息，建立聯絡人與對話，再放一則 Bot 的回覆，供 KB 回饋引用 */
async function conversationWithBotReply(uid: string) {
  const first = await receive(uid, '請問營業時間？');
  const conversationId = first.result!.conversation.id;
  const botMessage = await prisma.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'BOT',
      contentType: 'text',
      content: { text: '週一到週五 9:00～18:00' },
    },
  });
  return { conversationId, botMessageId: botMessage.id, contactId: first.result!.conversation.contactId };
}

test('一般進站訊息', async () => {
  const uid = `visitor-normal-${stamp}`;
  const { result, sockets, events } = await receive(uid, 'hello');
  assert.equal(result?.duplicate, false);

  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: result!.conversation.id } });
  assert.equal(conversation.unreadCount, 1);
  assert.ok(conversation.lastMessageAt, '對話的 lastMessageAt 有值');
  const messages = await prisma.message.findMany({ where: { conversationId: conversation.id } });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.direction, 'INBOUND');

  for (const event of ['message.new', 'conversation.updated']) {
    for (const room of [`conversation:${conversation.id}`, `tenant:${tenant.id}`]) {
      assert.ok(sockets.some((s) => s.event === event && s.room === room), `${event} 推送到 ${room}`);
    }
  }
  const received = events.filter((e) => e.name === 'message.received');
  assert.equal(received.length, 1);
  assert.equal((received[0]!.payload as { messageId: string }).messageId, messages[0]!.id);
});

test('KB 回饋寫入收訊租戶的文章', async () => {
  const { conversationId, botMessageId, contactId } = await conversationWithBotReply(`visitor-kb-good-${stamp}`);
  const { events } = await receive(`visitor-kb-good-${stamp}`, `kb_feedback:good:${article.id}:${botMessageId}`);

  const feedback = await prisma.kbArticleFeedback.findMany({ where: { articleId: article.id, messageId: botMessageId } });
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0]!.rating, 'good');
  assert.equal(feedback[0]!.contactId, contactId);
  assert.deepEqual(delivered, [{ conversationId, payload: THANKS }]);
  assert.equal(events.some((e) => e.name === 'message.received'), false);
});

test('KB 回饋引用其他租戶的文章', async () => {
  const { conversationId, botMessageId } = await conversationWithBotReply(`visitor-kb-other-${stamp}`);
  const { events } = await receive(`visitor-kb-other-${stamp}`, `kb_feedback:bad:${otherArticle.id}:${botMessageId}`);

  assert.equal(await prisma.kbArticleFeedback.count({ where: { articleId: otherArticle.id } }), 0);
  assert.deepEqual(delivered, [{ conversationId, payload: THANKS }]);
  assert.equal(events.some((e) => e.name === 'message.received'), false);
});

test('KB 回饋沒有對應的文章', async () => {
  const { conversationId, botMessageId } = await conversationWithBotReply(`visitor-kb-none-${stamp}`);
  const { events } = await receive(`visitor-kb-none-${stamp}`, `kb_feedback:bad:none:${botMessageId}`);

  assert.equal(await prisma.kbArticleFeedback.count({ where: { messageId: botMessageId } }), 0);
  assert.deepEqual(delivered, [{ conversationId, payload: THANKS }]);
  assert.equal(events.some((e) => e.name === 'message.received'), false);
});

test('同租戶、同聯絡人的工單寫入評分', async () => {
  const uid = `visitor-csat-${stamp}`;
  const first = await receive(uid, '我要申訴');
  const conversation = first.result!.conversation;
  const kase = await prisma.case.create({
    data: { tenantId: tenant.id, contactId: conversation.contactId, channelId: channel.id, title: `CI CSAT ${stamp}`, status: 'RESOLVED' },
  });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { caseId: kase.id } });

  const { events } = await receive(uid, `csat:5:${kase.id}`);

  const after = await prisma.case.findUniqueOrThrow({ where: { id: kase.id } });
  assert.equal(after.csatScore, 5);
  assert.equal(events.some((e) => e.name === 'message.received'), false);
});
