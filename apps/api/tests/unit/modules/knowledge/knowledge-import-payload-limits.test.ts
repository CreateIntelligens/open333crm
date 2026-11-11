/**
 * 知識庫 JSON 匯入調高 JSON 內容上限（change limit-request-array-size，spec request-payload-limits
 * 「路由可以調高自己的上限」）。前端把 JSON 檔外層的文章陣列整份送出，不限筆數，
 * 所以 `/knowledge/import` 的上限高於全域預設（陣列 10,000、總數 100,000）。
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterAll, beforeAll, beforeEach, test, vi } from 'vitest';

const importedCounts: number[] = [];

vi.mock('#src/modules/knowledge/knowledge.flow.js', () => ({
  importArticlesFlow: async (_deps: unknown, _actor: unknown, articles: unknown[]) => {
    importedCounts.push(articles.length);
    return { imported: articles.length, failed: 0, errors: [] };
  },
}));
vi.mock('#src/guards/rbac.guard.js', () => ({
  requirePermission: () => async () => {},
}));
vi.mock('#src/modules/knowledge/partner-ingest.service.js', () => ({
  parseCmd: () => 'CREATE',
}));

import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import jsonPayloadGuardPlugin from '#src/plugins/json-payload-guard.plugin.js';
import { DEFAULT_JSON_PAYLOAD_LIMITS } from '#src/shared/utils/json-payload-limits.js';
import knowledgeRoutes from '#src/modules/knowledge/knowledge.routes.js';

const TENANT_A = 'a0000000-0000-0000-0000-000000000001';
let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ bodyLimit: 30 * 1024 * 1024 });
  app.decorate('authenticate', async (request: FastifyRequest) => {
    (request as any).agent = { id: 'agent-1', tenantId: TENANT_A, role: 'ADMIN' };
    (request as any).tenantPrisma = {};
  });
  app.decorate('authenticateJwtOrPartnerKey', async () => {});
  app.decorate('prisma', {} as never);
  app.decorate('prismaAdmin', {} as never);
  app.decorateRequest('agent', null);
  app.decorateRequest('tenantPrisma', null);
  await app.register(errorHandlerPlugin);
  await app.register(jsonPayloadGuardPlugin, { limits: DEFAULT_JSON_PAYLOAD_LIMITS });
  await app.register(knowledgeRoutes, { prefix: '/api/v1/knowledge' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  importedCounts.length = 0;
});

function articles(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    title: `問題 ${i}`,
    content: `答案 ${i}`,
    summary: '摘要',
    category: '常見問題',
    tags: ['退貨', '運費'],
    status: 'PUBLISHED',
  }));
}

test('知識庫匯入接受超過一萬篇文章', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/v1/knowledge/import', payload: { articles: articles(12_000) } });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(importedCounts, [12_000]);
});

test('知識庫匯入超過調高後的上限仍被拒絕', async () => {
  const payload = JSON.stringify({ articles: Array.from({ length: 50_001 }, () => 0) });
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/knowledge/import',
    headers: { 'content-type': 'application/json' },
    payload,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'PAYLOAD_ARRAY_TOO_LARGE');
  assert.deepEqual(res.json().error.details, { path: 'articles', limit: 50_000 });
  assert.equal(importedCounts.length, 0);
});

test('其他知識庫路由仍用全域上限', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/knowledge',
    payload: { title: 't', content: 'c', tags: Array.from({ length: 10_001 }, () => 'x') },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'PAYLOAD_ARRAY_TOO_LARGE');
});
