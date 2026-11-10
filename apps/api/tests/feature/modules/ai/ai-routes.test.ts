/**
 * `ai` 模組的路由（change migrate-ai-llm-tenant-ctx，design D7）：用量紀錄寫完才回傳、LLM 失敗或月額度已滿時的降級、
 * 遮罩政策只讀本租戶。spec ai-usage-recording「呼叫端收到回覆時紀錄已寫入」，主規格 ai-assist 的降級行為。
 *
 * 路由走 app_tenant 連線（RLS）。Chat provider 與向量化服務換成假的 fetch（fake-chat.ts、fake-ollama.ts）。
 * 每次執行建立專用租戶，結束時整個刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { createRedisClient } from '@open333crm/core';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import aiRoutes from '#src/modules/ai/ai.routes.js';
import { fakeOllama, markedVector } from '#tests/support/fake-ollama.js';
import { fakeChat } from '#tests/support/fake-chat.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const redis = createRedisClient(process.env.REDIS_URL!, 'command');
const MARK = `ci-ai-routes-${Date.now()}`;

const tenantIds: string[] = [];
const apps: Array<{ close(): Promise<unknown> }> = [];
const ollama = fakeOllama();
const chat = fakeChat();

async function makeTenant(label: string, data: { limitOverrides?: object } = {}) {
  const id = (await owner.tenant.create({ data: { name: `${MARK}-${label}`, ...data } })).id;
  tenantIds.push(id);
  return id;
}

/** 有 channel.view_all 的成員：渠道可見範圍不在這個測試範圍 */
async function buildApp(tenantId: string) {
  const role = await owner.role.create({
    data: {
      tenantId,
      slug: `${MARK}-admin-${apps.length}`,
      name: 'admin',
      permissions: { create: ['channel.view_all', 'inbox.view'].map((permissionCode) => ({ permissionCode })) },
    },
  });
  const agent = await owner.agent.create({
    data: { tenantId, roleId: role.id, name: 'admin', email: `${MARK}-${apps.length}@example.test`, passwordHash: 'x' },
  });
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', tenantDb);
  app.decorate('prismaAdmin', owner);
  app.decorate('redis', redis);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agent.id, tenantId, role: 'ADMIN', roleId: role.id } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, tenantId);
  });
  await app.register(aiRoutes, { prefix: '/api/v1/ai' });
  await app.ready();
  apps.push(app);
  return app;
}
type App = Awaited<ReturnType<typeof buildApp>>;

async function call(app: App, method: 'GET' | 'POST', url: string, payload?: unknown) {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) });
  return { status: res.statusCode, body: res.json() as { data: any; error?: { code: string; message: string } } };
}

/** 一則顧客訊息的對話 */
async function makeConversation(tenantId: string, text: string) {
  const channel = await owner.channel.create({
    data: { tenantId, channelType: 'WEBCHAT', displayName: `${MARK}-ch`, credentialsEncrypted: 'x' },
  });
  const contact = await owner.contact.create({ data: { tenantId, displayName: '王小明' } });
  const conversation = await owner.conversation.create({
    data: { tenantId, contactId: contact.id, channelId: channel.id, channelType: 'WEBCHAT' },
  });
  await owner.message.create({
    data: { conversationId: conversation.id, senderType: 'CONTACT', contentType: 'text', content: { text } },
  });
  return conversation.id;
}

async function makeArticle(tenantId: string, createdById: string, content: string) {
  const article = await owner.kmArticle.create({
    data: { tenantId, title: '營業時間', content, summary: '', category: 'faq', status: 'PUBLISHED', createdById },
  });
  await owner.$executeRawUnsafe(
    `UPDATE km_articles SET embedding = $1::vector, "embeddingModel" = 'seed' WHERE id = $2::uuid`,
    `[${markedVector(1).join(',')}]`,
    article.id,
  );
}

beforeEach(() => {
  ollama.reset();
  chat.reset();
});

afterAll(async () => {
  ollama.restore();
  await Promise.all(apps.map((app) => app.close()));
  for (const tenantId of tenantIds) {
    await owner.aiUsage.deleteMany({ where: { tenantId } });
    await owner.outbox.deleteMany({ where: { tenantId } });
    await owner.message.deleteMany({ where: { conversation: { tenantId } } });
    await owner.conversation.deleteMany({ where: { tenantId } });
    await owner.contact.deleteMany({ where: { tenantId } });
    await owner.channel.deleteMany({ where: { tenantId } });
    await owner.kmArticle.deleteMany({ where: { tenantId } });
    await owner.platformSetting.deleteMany({ where: { key: `ai.privacy.${tenantId}` } });
    await owner.agent.deleteMany({ where: { tenantId } });
    await owner.role.deleteMany({ where: { tenantId } });
    await owner.tenant.delete({ where: { id: tenantId } });
  }
  await redis.quit();
  await Promise.all([owner.$disconnect(), tenantDb.$disconnect()]);
});

describe('每次 LLM 呼叫寫入 AiUsage 記錄', () => {
  test('呼叫端收到回覆時紀錄已寫入', async () => {
    const t = await makeTenant('usage-before-reply');
    const res = await call(await buildApp(t), 'POST', '/api/v1/ai/rewrite', { text: '你好', action: 'polish' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const usages = await owner.aiUsage.findMany({ where: { tenantId: t } });
    assert.equal(usages.length, 1, '回應送出時已有這次呼叫的 AiUsage');
    assert.equal(usages[0].feature, 'ai-rewrite');
    assert.equal(usages[0].success, true);
    assert.equal(usages[0].totalTokens, 15);
  });
});

describe('LLM 失敗或月額度已滿時降級', () => {
  test('建議回覆在月額度已滿時每篇建議都改用文章內容', async () => {
    const t = await makeTenant('suggest-quota', { limitOverrides: { monthlyTokens: 100 } });
    const app = await buildApp(t);
    const agent = await owner.agent.findFirstOrThrow({ where: { tenantId: t } });
    await makeArticle(t, agent.id, '我們每天 9 點開門');
    const conversationId = await makeConversation(t, '幾點開門？');
    await owner.aiUsage.create({
      data: { tenantId: t, provider: 'ollama', model: 'qwen2.5:3b', keySource: 'platform', success: true, totalTokens: 100 },
    });
    await redis.del(`aiquota:${t}:${new Date().toISOString().slice(0, 7)}`);

    const res = await call(app, 'POST', '/api/v1/ai/suggest-reply', { conversationId });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.suggestions.length, 1, JSON.stringify(res.body.data));
    assert.equal(res.body.data.suggestions[0].text, '我們每天 9 點開門');
    assert.equal(chat.state.chatCalls.length, 0, '月額度已滿時不呼叫 LLM');
  });

  test('摘要在 LLM 失敗時回固定格式的摘要', async () => {
    const t = await makeTenant('summarize-fallback');
    const app = await buildApp(t);
    const conversationId = await makeConversation(t, '我要退貨');
    chat.state.chatStatus = 500;
    const res = await call(app, 'POST', '/api/v1/ai/summarize', { conversationId });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(res.body.data.summary, /^王小明 的對話共 1 則訊息/);
  });

  test('分類與情緒分析在 LLM 失敗時回關鍵字的結果', async () => {
    const t = await makeTenant('keyword-fallback');
    const app = await buildApp(t);
    chat.state.chatStatus = 500;
    const classify = await call(app, 'POST', '/api/v1/ai/classify', { text: '我要退貨' });
    assert.equal(classify.status, 200, JSON.stringify(classify.body));
    assert.deepEqual(classify.body.data, { category: '退換貨', confidence: 0.5 });
    const sentiment = await call(app, 'POST', '/api/v1/ai/analyze-sentiment', { text: '服務太差' });
    assert.equal(sentiment.status, 200, JSON.stringify(sentiment.body));
    assert.deepEqual(sentiment.body.data, { sentiment: 'negative', score: -0.6, confidence: 0.5 });
  });
});

describe('遮罩政策的狀態', () => {
  test('只讀本租戶的政策', async () => {
    const a = await makeTenant('privacy-a');
    const b = await makeTenant('privacy-b');
    await owner.platformSetting.create({ data: { key: `ai.privacy.${a}`, value: { enabled: true } } });
    const resA = await call(await buildApp(a), 'GET', '/api/v1/ai/privacy/status');
    const resB = await call(await buildApp(b), 'GET', '/api/v1/ai/privacy/status');
    assert.equal(resA.status, 200, JSON.stringify(resA.body));
    assert.deepEqual(resA.body.data, { enabled: true });
    assert.deepEqual(resB.body.data, { enabled: false });
  });
});
