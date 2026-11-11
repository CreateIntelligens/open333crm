/**
 * 向量化設定的路由與健康檢查（change migrate-embedding-tenant-ctx，spec embedding-settings）。
 *
 * 路由走真實的 requirePermission 與 app_tenant 連線（RLS）。向量化服務換成假的 fetch（tests/support/fake-ollama.ts）。
 * 每次執行建立專用租戶，結束時整個刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import settingsRoutes from '#src/modules/settings/settings.routes.js';
import knowledgeRoutes from '#src/modules/knowledge/knowledge.routes.js';
import { fakeOllama } from '#tests/support/fake-ollama.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-embedding-settings-${Date.now()}`;
const MISSING = '00000000-0000-4000-8000-000000000000';
const DEFAULTS = { baseUrl: 'http://localhost:11434', model: 'bge-m3', topK: 5, threshold: 0.3 };

const tenantIds: string[] = [];
const apps: Array<{ close(): Promise<unknown> }> = [];
const ollama = fakeOllama();

async function makeTenant(label: string) {
  const id = (await owner.tenant.create({ data: { name: `${MARK}-${label}` } })).id;
  tenantIds.push(id);
  return id;
}

/** 有 settings.manage 與 knowledge.view 的成員。`ghost` 時成員不存在：稽核的 actorId 違反外鍵，用來讓稽核寫入失敗 */
async function buildApp(tenantId: string, opts: { ghost?: boolean } = {}) {
  const role = await owner.role.create({
    data: {
      tenantId,
      slug: `${MARK}-admin-${apps.length}`,
      name: 'admin',
      permissions: { create: ['settings.manage', 'knowledge.view'].map((permissionCode) => ({ permissionCode })) },
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
  const authenticate = async (request: FastifyRequest) => {
    request.agent = { id: agentId, tenantId, role: 'ADMIN', roleId: role.id } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, tenantId);
  };
  app.decorate('authenticate', authenticate);
  app.decorate('authenticateJwtOrPartnerKey', authenticate);
  await app.register(settingsRoutes, { prefix: '/api/v1/settings' });
  await app.register(knowledgeRoutes, { prefix: '/api/v1/knowledge' });
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
  return owner.tenantSettings.findUnique({
    where: { tenantId },
    select: { embeddingBaseUrl: true, embeddingModel: true, embeddingTopK: true, embeddingThreshold: true },
  });
}

function saveRow(tenantId: string, data: { embeddingModel?: string; embeddingTopK?: number }) {
  return owner.tenantSettings.create({ data: { tenantId, ...data } });
}

const S = '/api/v1/settings/embedding';

beforeEach(() => ollama.reset());

afterAll(async () => {
  ollama.restore();
  await Promise.all(apps.map((app) => app.close()));
  for (const tenantId of tenantIds) {
    await owner.tenantAuditLog.deleteMany({ where: { tenantId } });
    await owner.tenantSettings.deleteMany({ where: { tenantId } });
    await owner.agent.deleteMany({ where: { tenantId } });
    await owner.role.deleteMany({ where: { tenantId } });
    await owner.tenant.delete({ where: { id: tenantId } });
  }
  await Promise.all([owner.$disconnect(), tenantDb.$disconnect()]);
});

describe('讀取向量化設定不寫入資料庫', () => {
  test('沒有設定列時回預設值', async () => {
    const t = await makeTenant('read-default');
    const res = await call(await buildApp(t), 'GET', S);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.settings, DEFAULTS);
    assert.equal(await storedRow(t), null, '讀取不建立設定列');
  });

  test('有設定列時回已存的值', async () => {
    const t = await makeTenant('read-stored');
    await saveRow(t, { embeddingModel: 'bge-m3-custom', embeddingTopK: 8 });
    const res = await call(await buildApp(t), 'GET', S);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.settings.model, 'bge-m3-custom');
    assert.equal(res.body.data.settings.topK, 8);
  });

  test('只讀到本租戶的設定', async () => {
    const a = await makeTenant('read-scope-a');
    const b = await makeTenant('read-scope-b');
    await saveRow(a, { embeddingModel: 'bge-m3-custom', embeddingTopK: 8 });
    const res = await call(await buildApp(b), 'GET', S);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.settings, DEFAULTS);
  });
});

describe('修改向量化設定', () => {
  test('沒有設定列時建立', async () => {
    const t = await makeTenant('put-create');
    const res = await call(await buildApp(t), 'PUT', S, { topK: 8 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.settings, { ...DEFAULTS, topK: 8 });
    assert.equal(res.body.data.modelChanged, false);
    assert.deepEqual(await storedRow(t), {
      embeddingBaseUrl: DEFAULTS.baseUrl,
      embeddingModel: DEFAULTS.model,
      embeddingTopK: 8,
      embeddingThreshold: DEFAULTS.threshold,
    });
    const audits = await owner.tenantAuditLog.findMany({ where: { tenantId: t, action: 'settings.update' } });
    assert.equal(audits.length, 1);
    assert.equal((audits[0].payload as { section?: string }).section, 'embedding');
  });

  test('換模型', async () => {
    const t = await makeTenant('put-model');
    await saveRow(t, { embeddingModel: 'bge-m3' });
    const res = await call(await buildApp(t), 'PUT', S, { model: 'bge-m3-custom' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.modelChanged, true);
    assert.equal(res.body.data.previousModel, 'bge-m3');
    assert.equal(res.body.data.settings.model, 'bge-m3-custom');
  });

  test('稽核寫入失敗時設定不變', async () => {
    const t = await makeTenant('put-audit-fails');
    await saveRow(t, { embeddingTopK: 3 });
    const res = await call(await buildApp(t, { ghost: true }), 'PUT', S, { topK: 8 });
    // error handler 把 Prisma 的外鍵錯誤轉成 400 DATABASE_ERROR
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error?.code, 'DATABASE_ERROR');
    assert.equal((await storedRow(t))?.embeddingTopK, 3, '設定沒有寫入');
  });
});

describe('向量化服務的健康檢查', () => {
  const STATUS = '/api/v1/knowledge/embedding-status';

  test('服務正常而且有這個模型', async () => {
    const app = await buildApp(await makeTenant('health-ok'));
    ollama.state.models = [{ name: 'nomic-embed-text:latest' }, { name: 'bge-m3:latest' }];
    const health = await call(app, 'POST', `${S}/health`);
    assert.equal(health.status, 200, JSON.stringify(health.body));
    assert.equal(health.body.data.ok, true);
    assert.equal(health.body.data.modelInstalled, true);
    const status = await call(app, 'GET', STATUS);
    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.deepEqual(status.body.data, { ok: true, model: 'bge-m3:latest' });
  });

  test('服務沒有這個模型', async () => {
    const app = await buildApp(await makeTenant('health-missing'));
    ollama.state.models = [{ name: 'nomic-embed-text:latest' }];
    for (const res of [await call(app, 'POST', `${S}/health`), await call(app, 'GET', STATUS)]) {
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.ok, false);
      assert.match(res.body.data.error, /nomic-embed-text:latest/);
    }
  });

  test('服務連不到', async () => {
    const app = await buildApp(await makeTenant('health-down'));
    ollama.state.tagsError = new TypeError('fetch failed');
    for (const res of [await call(app, 'POST', `${S}/health`), await call(app, 'GET', STATUS)]) {
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.ok, false);
      assert.match(res.body.data.error, /Cannot reach Ollama/);
    }
  });
});
