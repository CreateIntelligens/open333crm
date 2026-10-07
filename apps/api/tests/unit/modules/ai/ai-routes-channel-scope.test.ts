import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { beforeEach, test, vi } from 'vitest';
import { AppError } from '#src/shared/utils/response.js';

// AUDIT RBAC-04（AI 部分）：以 conversationId 讀對話的 AI 路由要先檢查渠道可見範圍。
// 規格 channel-scoped-visibility「單筆讀取與操作的存取檢查」：不可見渠道的對話回 404，不回傳內容。

const VISIBLE_ID = '11111111-1111-4111-8111-111111111111';
const HIDDEN_ID = '22222222-2222-4222-8222-222222222222';

const guardCalls: Array<{ conversationId: string; level: string | undefined }> = [];
const serviceCalls: string[] = [];

const RUN_HIDDEN = '33333333-3333-4333-8333-333333333333';
const RUN_VISIBLE = '44444444-4444-4444-8444-444444444444';
const RUN_NO_CONV = '55555555-5555-4555-8555-555555555555';
const runs = new Map<string, { id: string; conversationId: string | null; finalText: string }>([
  [RUN_HIDDEN, { id: RUN_HIDDEN, conversationId: HIDDEN_ID, finalText: 'secret' }],
  [RUN_VISIBLE, { id: RUN_VISIBLE, conversationId: VISIBLE_ID, finalText: 'ok' }],
  [RUN_NO_CONV, { id: RUN_NO_CONV, conversationId: null, finalText: 'manual' }],
]);

vi.mock('#src/services/channel-visibility.js', () => ({
  assertConversationChannelVisible: async (_req: unknown, conversationId: string, level?: string) => {
    guardCalls.push({ conversationId, level });
    if (conversationId === HIDDEN_ID) throw new AppError('找不到此對話', 'NOT_FOUND', 404);
  },
}));

vi.mock('#src/modules/ai/ai.service.js', () => ({
  suggestReply: async (_p: unknown, tenantId: string, id: string) => { serviceCalls.push(`suggest:${tenantId}:${id}`); return { suggestion: 'hi' }; },
  summarizeConversation: async (_p: unknown, tenantId: string, id: string) => { serviceCalls.push(`summarize:${tenantId}:${id}`); return { summary: 's' }; },
}));

vi.mock('#src/modules/ai/agent/agent.service.js', () => ({
  runAgentReply: async (_p: unknown, input: { conversationId?: string }) => {
    serviceCalls.push(`agent:${input.conversationId ?? 'none'}`);
    return { handled: true, text: 'ok' };
  },
}));

vi.mock('#src/guards/rbac.guard.js', () => ({ requirePermission: () => async () => {} }));

vi.mock('#src/config/env.js', () => ({
  getConfig: () => ({ AGENTIC_LLM_ENABLED: true, AGENT_WIKI_AUTO_PUBLISH: false }),
}));

async function buildApp() {
  const { default: aiRoutes } = await import('#src/modules/ai/ai.routes.js');
  const app = Fastify();
  app.decorate('authenticate', async (request: any) => {
    request.agent = { id: 'agent-1', tenantId: 'tenant-1' };
    request.tenantPrisma = { agentRun: { findFirst: async ({ where }: any) => runs.get(where.id) ?? null } };
  });
  app.decorateRequest('tenantPrisma', null);
  app.setErrorHandler((err: any, _req, reply) => {
    reply.status(err.statusCode ?? 500).send({ code: err.code, message: err.message });
  });
  await app.register(aiRoutes);
  return app;
}

beforeEach(() => {
  guardCalls.length = 0;
  serviceCalls.length = 0;
});

for (const [path, svc] of [['/suggest-reply', 'suggest'], ['/summarize', 'summarize']] as const) {
  test(`${path}：不可見渠道的對話回 404，不呼叫 AI`, async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: path, payload: { conversationId: HIDDEN_ID } });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(serviceCalls, []);
    assert.deepEqual(guardCalls, [{ conversationId: HIDDEN_ID, level: 'read_only' }]);
  });

  test(`${path}：可見渠道的對話照常回傳`, async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: path, payload: { conversationId: VISIBLE_ID } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(serviceCalls, [`${svc}:tenant-1:${VISIBLE_ID}`]);
  });
}

test('/agent/run：帶不可見渠道的 conversationId 回 404，不執行 Agent', async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST', url: '/agent/run', payload: { userMessage: 'hello', conversationId: HIDDEN_ID },
  });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(serviceCalls, []);
});

test('/agent/run：沒帶 conversationId 時不檢查渠道', async () => {
  const app = await buildApp();
  const res = await app.inject({ method: 'POST', url: '/agent/run', payload: { userMessage: 'hello' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(guardCalls, []);
  assert.deepEqual(serviceCalls, ['agent:none']);
});

test('/agent/runs/:id：關聯不可見渠道對話的執行紀錄回 404，不回傳內容', async () => {
  const app = await buildApp();
  const res = await app.inject({ method: 'GET', url: `/agent/runs/${RUN_HIDDEN}` });
  assert.equal(res.statusCode, 404);
  assert.ok(!res.body.includes('secret'));
  assert.deepEqual(guardCalls, [{ conversationId: HIDDEN_ID, level: 'read_only' }]);
});

test('/agent/runs/:id：關聯可見對話的執行紀錄照常回傳', async () => {
  const app = await buildApp();
  const res = await app.inject({ method: 'GET', url: `/agent/runs/${RUN_VISIBLE}` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().data.finalText, 'ok');
});

test('/agent/runs/:id：沒有關聯對話的執行紀錄不檢查渠道', async () => {
  const app = await buildApp();
  const res = await app.inject({ method: 'GET', url: `/agent/runs/${RUN_NO_CONV}` });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(guardCalls, []);
});
