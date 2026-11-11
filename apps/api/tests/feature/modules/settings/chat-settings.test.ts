/**
 * Chat 設定與 Gemini 金鑰的路由（change migrate-ai-llm-tenant-ctx，spec chat-settings）。
 *
 * 路由走真實的 requirePermission 與 app_tenant 連線（RLS）。Chat provider 換成假的 fetch（tests/support/fake-chat.ts），
 * Ollama 的 `/api/tags` 由 tests/support/fake-ollama.ts 回應。每次執行建立專用租戶，結束時整個刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { createRedisClient } from '@open333crm/core';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import settingsRoutes from '#src/modules/settings/settings.routes.js';
import aiRoutes from '#src/modules/ai/ai.routes.js';
import { fakeOllama } from '#tests/support/fake-ollama.js';
import { fakeChat } from '#tests/support/fake-chat.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const redis = createRedisClient(process.env.REDIS_URL!, 'command');
const MARK = `ci-chat-settings-${Date.now()}`;
const MISSING = '00000000-0000-4000-8000-000000000000';
const DEFAULTS = {
  provider: 'ollama',
  model: 'qwen2.5:3b',
  baseUrl: 'http://localhost:11434',
  temperature: 0.2,
  maxTokens: 500,
  chatSystemPrompt: '',
  summarizeSystemPrompt: '',
  clarifySystemPrompt: '',
  modelGuideSystemPrompt: '',
  clarifyThreshold: 0.5,
  clarifyMaxAttempts: 2,
};
const TENANT_KEY = 'AIzaSyExample1234';

const tenantIds: string[] = [];
const apps: Array<{ close(): Promise<unknown> }> = [];
const ollama = fakeOllama();
const chat = fakeChat();

async function makeTenant(label: string) {
  const id = (await owner.tenant.create({ data: { name: `${MARK}-${label}` } })).id;
  tenantIds.push(id);
  return id;
}

/** 有 settings.manage 的成員。`ghost` 時成員不存在：稽核的 actorId 違反外鍵，用來讓稽核寫入失敗 */
async function buildApp(tenantId: string, opts: { ghost?: boolean } = {}) {
  const role = await owner.role.create({
    data: {
      tenantId,
      slug: `${MARK}-admin-${apps.length}`,
      name: 'admin',
      permissions: { create: ['settings.manage'].map((permissionCode) => ({ permissionCode })) },
    },
  });
  const agent = await owner.agent.create({
    data: { tenantId, roleId: role.id, name: 'admin', email: `${MARK}-${apps.length}@example.test`, passwordHash: 'x' },
  });
  const agentId = opts.ghost ? MISSING : agent.id;
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', tenantDb);
  app.decorate('prismaAdmin', owner);
  app.decorate('redis', redis);
  const authenticate = async (request: FastifyRequest) => {
    request.agent = { id: agentId, tenantId, role: 'ADMIN', roleId: role.id } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, tenantId);
  };
  app.decorate('authenticate', authenticate);
  app.decorate('authenticateJwtOrPartnerKey', authenticate);
  await app.register(settingsRoutes, { prefix: '/api/v1/settings' });
  await app.register(aiRoutes, { prefix: '/api/v1/ai' });
  await app.ready();
  apps.push(app);
  return app;
}
type App = Awaited<ReturnType<typeof buildApp>>;

async function call(app: App, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) });
  return { status: res.statusCode, body: res.json() as { data: any; error?: { code: string; message: string } } };
}

function storedRow(tenantId: string) {
  return owner.tenantSettings.findUnique({ where: { tenantId } });
}

function audits(tenantId: string) {
  return owner.tenantAuditLog.findMany({ where: { tenantId, action: 'settings.update' } });
}

const S = '/api/v1/settings/chat';
const KEY = '/api/v1/settings/gemini-key';

beforeEach(() => {
  ollama.reset();
  chat.reset();
});

afterAll(async () => {
  ollama.restore();
  await Promise.all(apps.map((app) => app.close()));
  for (const tenantId of tenantIds) {
    await owner.tenantAuditLog.deleteMany({ where: { tenantId } });
    await owner.aiUsage.deleteMany({ where: { tenantId } });
    await owner.tenantSettings.deleteMany({ where: { tenantId } });
    await owner.agent.deleteMany({ where: { tenantId } });
    await owner.role.deleteMany({ where: { tenantId } });
    await owner.tenant.delete({ where: { id: tenantId } });
  }
  await redis.quit();
  await Promise.all([owner.$disconnect(), tenantDb.$disconnect()]);
});

describe('讀取 Chat 設定不寫入資料庫', () => {
  test('沒有設定列時回預設值', async () => {
    const t = await makeTenant('read-default');
    const res = await call(await buildApp(t), 'GET', S);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.settings, DEFAULTS);
    assert.equal(await storedRow(t), null, '讀取不建立設定列');
  });

  test('呼叫 LLM 不建立設定列', async () => {
    const t = await makeTenant('llm-no-row');
    const res = await call(await buildApp(t), 'POST', '/api/v1/ai/rewrite', { text: '你好', action: 'polish' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(chat.state.chatCalls, [{ model: DEFAULTS.model }], '以預設的模型呼叫 LLM');
    assert.equal(await storedRow(t), null, '呼叫 LLM 不建立設定列');
  });

  test('有設定列時回已存的值', async () => {
    const t = await makeTenant('read-stored');
    await owner.tenantSettings.create({ data: { tenantId: t, chatModel: 'gemini-2.5-flash', chatMaxTokens: 800 } });
    const res = await call(await buildApp(t), 'GET', S);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.settings.model, 'gemini-2.5-flash');
    assert.equal(res.body.data.settings.maxTokens, 800);
  });

  test('只讀到本租戶的設定', async () => {
    const a = await makeTenant('read-scope-a');
    const b = await makeTenant('read-scope-b');
    await owner.tenantSettings.create({ data: { tenantId: a, chatModel: 'gemini-2.5-flash', chatMaxTokens: 800 } });
    const res = await call(await buildApp(b), 'GET', S);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.settings, DEFAULTS);
  });
});

describe('修改 Chat 設定', () => {
  test('沒有設定列時建立', async () => {
    const t = await makeTenant('put-create');
    const res = await call(await buildApp(t), 'PUT', S, { maxTokens: 800 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.settings, { ...DEFAULTS, maxTokens: 800 });
    assert.equal(res.body.data.providerChanged, false);
    const row = await storedRow(t);
    assert.equal(row?.chatMaxTokens, 800);
    assert.equal(row?.chatTemperature, DEFAULTS.temperature);
    const logged = await audits(t);
    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0].payload, { section: 'chat', keys: ['maxTokens'] });
  });

  test('換 provider', async () => {
    const t = await makeTenant('put-provider');
    await owner.tenantSettings.create({ data: { tenantId: t, chatProvider: 'ollama' } });
    const res = await call(await buildApp(t), 'PUT', S, { provider: 'gemini' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.providerChanged, true);
    assert.equal(res.body.data.previousProvider, 'ollama');
  });

  test('稽核寫入失敗時設定不變', async () => {
    const t = await makeTenant('put-audit-fails');
    await owner.tenantSettings.create({ data: { tenantId: t, chatMaxTokens: 300 } });
    const res = await call(await buildApp(t, { ghost: true }), 'PUT', S, { maxTokens: 800 });
    // error handler 把 Prisma 的外鍵錯誤轉成 400 DATABASE_ERROR
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error?.code, 'DATABASE_ERROR');
    assert.equal((await storedRow(t))?.chatMaxTokens, 300, '設定沒有寫入');
  });
});

describe('設定與清除自備的 Gemini 金鑰', () => {
  test('設定金鑰', async () => {
    const t = await makeTenant('key-set');
    const res = await call(await buildApp(t), 'PUT', KEY, { apiKey: TENANT_KEY });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data, { configured: true, masked: 'AIza…1234' });
    const enc = (await storedRow(t))?.geminiApiKeyEnc;
    assert.ok(enc && !enc.includes(TENANT_KEY), '資料庫存的是密文');
    const logged = await audits(t);
    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0].payload, { section: 'gemini-key', operation: 'set' });
    assert.ok(!JSON.stringify(logged[0]).includes(TENANT_KEY), '稽核不含金鑰');
  });

  test('清除金鑰', async () => {
    const t = await makeTenant('key-clear');
    const app = await buildApp(t);
    await call(app, 'PUT', KEY, { apiKey: TENANT_KEY });
    const res = await call(app, 'PUT', KEY, { apiKey: null });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data, { configured: false, masked: null });
    const ops = (await audits(t)).map((a) => (a.payload as { operation: string }).operation).sort();
    assert.deepEqual(ops, ['clear', 'set']);
  });

  test('稽核寫入失敗時金鑰不變', async () => {
    const t = await makeTenant('key-audit-fails');
    const res = await call(await buildApp(t, { ghost: true }), 'PUT', KEY, { apiKey: TENANT_KEY });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    const status = await call(await buildApp(t), 'GET', KEY);
    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.equal(status.body.data.configured, false);
  });
});

describe('Chat 服務的健康檢查', () => {
  test('Gemini 以租戶的金鑰檢查', async () => {
    const t = await makeTenant('health-gemini');
    await owner.tenantSettings.create({ data: { tenantId: t, chatProvider: 'gemini', chatModel: 'gemini-2.5-flash' } });
    const app = await buildApp(t);
    await call(app, 'PUT', KEY, { apiKey: TENANT_KEY });
    chat.state.geminiKeys = [];
    const res = await call(app, 'POST', `${S}/health`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.ok, true, JSON.stringify(res.body.data));
    assert.deepEqual(chat.state.geminiKeys, [TENANT_KEY]);
  });

  test('服務連不到', async () => {
    const app = await buildApp(await makeTenant('health-down'));
    ollama.state.tagsError = new TypeError('fetch failed');
    for (const res of [await call(app, 'POST', `${S}/health`), await call(app, 'GET', S)]) {
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const health = res.body.data.health ?? res.body.data;
      assert.equal(health.ok, false);
      assert.equal(health.reachable, false);
    }
  });
});
