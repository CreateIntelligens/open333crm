/**
 * 知識庫自動回覆的交易界線（change migrate-ai-kb-autoreply-tenant-ctx：bot-handoff-config
 * 「轉接後關鍵字規則照常回覆」「知識庫自動回覆不在交易內等待外部呼叫」）。
 *
 * 連線是 app_tenant（RLS）。provider 是 LLM 呼叫的最低邊界，換成假的；embedding 服務換成假的向量；
 * 送到渠道換成記錄。設定、知識庫搜尋、月額度、認領與交易都是真的。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, test, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createRedisClient } from '@open333crm/core';
import { loadEnvConfig } from '#src/config/env.js';
import { TENANT_A, TENANT_B } from '#tests/setup/feature-config.js';

const hooks = vi.hoisted(() => ({
  /** 每次呼叫 LLM 時，回覆之前執行 */
  beforeLlmReply: async () => {},
  llmCalls: 0,
  delivered: [] as string[],
}));

vi.mock('#src/modules/ai/providers/index.js', () => ({
  getChatProvider: () => ({
    id: 'gemini',
    generate: async () => {
      hooks.llmCalls += 1;
      await hooks.beforeLlmReply();
      return { text: '請問您想詢問哪一項服務呢？' };
    },
    generateToolTurn: async () => ({ text: '', toolCalls: [] }),
  }),
}));
vi.mock('#src/modules/embedding/embedding-client.js', async (orig) => ({
  ...(await orig<object>()),
  embedText: async () => new Array(1024).fill(0.01),
}));
vi.mock('#src/modules/conversation/conversation.service.js', async (orig) => ({
  ...(await orig<object>()),
  deliverToChannel: async (_db: unknown, conversationId: string) => {
    hooks.delivered.push(conversationId);
  },
}));

loadEnvConfig();
const { attemptKbAutoReplyFlow } = await import('#src/modules/ai/kb-autoreply.flow.js');
const { createBotReplyGuard } = await import('#src/modules/automation/bot-reply-guard.js');
const { createOutboxPublisher } = await import('#src/events/outbox-publisher.js');

const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const redis = createRedisClient(process.env.REDIS_URL!, 'command');
const STARTED = new Date();
const MARK = `ci-kb-flow-${STARTED.getTime()}`;
const channelIds: string[] = [];
const io = { to: () => ({ emit: () => {} }) } as never;

/** 建一段 BOT_HANDLED 對話與一則進站訊息 */
async function makeConversation(tenantId: string) {
  const channel = await owner.channel.create({
    data: { tenantId, channelType: 'LINE', displayName: MARK, credentialsEncrypted: 'x', settings: { botConfig: { botMode: 'llm' } } },
  });
  channelIds.push(channel.id);
  const contact = await owner.contact.create({ data: { tenantId, displayName: MARK } });
  const conversation = await owner.conversation.create({
    data: { tenantId, contactId: contact.id, channelId: channel.id, channelType: 'LINE', status: 'BOT_HANDLED' },
  });
  const inbound = await owner.message.create({
    data: { conversationId: conversation.id, direction: 'INBOUND', senderType: 'CONTACT', contentType: 'text', content: { text: '請問一下' } },
  });
  return { conversationId: conversation.id, inboundId: inbound.id };
}

async function runKb(tenantId: string, conversationId: string, inboundId: string) {
  const events = createOutboxPublisher(tenantDb);
  const replyGuard = createBotReplyGuard(tenantDb, owner, tenantId, inboundId);
  return attemptKbAutoReplyFlow(
    { prisma: tenantDb, llm: { prisma: tenantDb, redis, events }, io, replyGuard, events, deliverDb: owner },
    { tenantId, conversationId, messageText: '請問一下', delivery: {} },
  );
}

const botMessagesOf = (conversationId: string) =>
  owner.message.findMany({ where: { conversationId, senderType: 'BOT' } });

beforeEach(() => {
  hooks.beforeLlmReply = async () => {};
  hooks.llmCalls = 0;
  hooks.delivered = [];
});

afterAll(async () => {
  const conversations = await owner.conversation.findMany({ where: { channelId: { in: channelIds } }, select: { id: true } });
  const ids = conversations.map((c) => c.id);
  await owner.message.deleteMany({ where: { conversationId: { in: ids } } });
  await owner.sideEffectClaim.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] }, kind: 'bot_reply', createdAt: { gte: STARTED } } });
  await owner.conversation.deleteMany({ where: { id: { in: ids } } });
  await owner.contact.deleteMany({ where: { displayName: MARK } });
  await owner.channel.deleteMany({ where: { id: { in: channelIds } } });
  await owner.aiUsage.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] }, feature: 'kb-autoreply', createdAt: { gte: STARTED } } });
  redis.disconnect();
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

test('知識庫產生回覆期間客服接手：不寫入、不送出這則回覆', async () => {
  const { conversationId, inboundId } = await makeConversation(TENANT_A);
  hooks.beforeLlmReply = async () => {
    await owner.conversation.update({ where: { id: conversationId }, data: { status: 'AGENT_HANDLED' } });
  };

  await runKb(TENANT_A, conversationId, inboundId);

  assert.equal(hooks.llmCalls, 1, 'LLM 被呼叫了一次（接手發生在 LLM 回應之前）');
  assert.deepEqual(await botMessagesOf(conversationId), [], '對話沒有這次的機器人回覆');
  assert.deepEqual(hooks.delivered, [], '客人沒有收到回覆');
  const conversation = await owner.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  assert.equal(conversation.botRepliesCount, 0);
  assert.equal(conversation.status, 'AGENT_HANDLED');
});

test('對話屬於其他租戶：結果是略過（not_bot_handled），租戶 B 的對話沒有新的訊息', async () => {
  const { conversationId, inboundId } = await makeConversation(TENANT_B);

  const result = await runKb(TENANT_A, conversationId, inboundId);

  assert.deepEqual(result, { status: 'skipped', reason: 'not_bot_handled' });
  assert.equal(hooks.llmCalls, 0);
  assert.deepEqual(await botMessagesOf(conversationId), []);
});
