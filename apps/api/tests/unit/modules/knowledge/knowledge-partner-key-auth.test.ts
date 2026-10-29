/**
 * 知識庫路由的認證方式（issue #394，spec rbac「Partner API 金鑰只通過白名單權限碼」）。
 * 只有合作方推送路由接受 Partner API 金鑰；其他知識庫路由一律要成員 JWT，
 * 不論網址的查詢字串或路徑參數寫了什麼。
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { afterAll, beforeAll, beforeEach, test, vi } from 'vitest';

vi.mock('#src/modules/knowledge/knowledge.service.js', () => ({
  listArticles: async () => ({ articles: [], total: 0, page: 1, limit: 50 }),
  listSources: async () => [],
  getArticle: async () => ({ id: 'article-1' }),
  createArticle: async () => ({}),
  updateArticle: async () => ({}),
  deleteArticle: async () => ({}),
  publishArticle: async () => ({}),
  archiveArticle: async () => ({}),
  listCategories: async () => [],
  semanticSearch: async () => [],
  batchImportArticles: async () => ({}),
  bulkReembed: async () => ({}),
  checkOllamaHealth: async () => ({}),
  embedArticle: async () => ({}),
}));
vi.mock('#src/modules/knowledge/file-parser.service.js', () => ({
  parseFileToMarkdown: async () => '',
  parseSpreadsheetToQaRows: async () => [],
}));
vi.mock('#src/modules/knowledge/partner-ingest.service.js', () => ({
  ingestPartnerDoc: async () => ({}),
  parseCmd: () => 'CREATE',
}));
vi.mock('#src/modules/knowledge/kb-feedback.service.js', () => ({
  listFeedback: async () => ({ items: [], total: 0 }),
  getFeedbackCounts: async () => ({}),
  resolveFeedback: async () => ({}),
}));
vi.mock('#src/modules/ai/model-registry.service.js', () => ({
  refreshModelKeys: async () => [],
  getKnownModelKeys: async () => [],
}));

import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import knowledgeRoutes from '#src/modules/knowledge/knowledge.routes.js';

const TENANT_A = 'a0000000-0000-0000-0000-000000000001';
const PARTNER_KEY = { authorization: 'Bearer pk_test_partner_key' };

/** 呼叫了哪一種認證 */
const calls: string[] = [];

/** 成員 JWT 認證：測試裡沒有 JWT，一律 401 */
async function authenticate(_request: FastifyRequest, reply: FastifyReply) {
  calls.push('jwt');
  return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: '請先登入' } });
}

/** JWT 或 Partner API 金鑰：帶 pk_ 金鑰時通過，掛上合作方身分 */
async function authenticateJwtOrPartnerKey(request: FastifyRequest, reply: FastifyReply) {
  calls.push('partner');
  if (request.headers.authorization?.startsWith('Bearer pk_')) {
    (request as any).agent = { id: 'creator', tenantId: TENANT_A, role: 'SUPERVISOR', isPartnerKey: true, apiKeyId: 'key-1' };
    return;
  }
  return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: '請先登入' } });
}

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.decorate('authenticate', authenticate);
  app.decorate('authenticateJwtOrPartnerKey', authenticateJwtOrPartnerKey);
  app.decorate('prisma', {} as never);
  app.decorate('prismaAdmin', {} as never);
  app.decorateRequest('agent', null);
  app.decorateRequest('tenantPrisma', null);
  await app.register(errorHandlerPlugin);
  await app.register(knowledgeRoutes, { prefix: '/api/v1/knowledge' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  calls.length = 0;
});

test('Partner API key cannot list articles by adding partner-ingest to the query string', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/knowledge?x=/partner-ingest', headers: PARTNER_KEY });
  assert.equal(res.statusCode, 401, res.body);
  assert.deepEqual(calls, ['jwt']);
});

test('Partner API key cannot read an article whose id is partner-ingest', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/knowledge/partner-ingest', headers: PARTNER_KEY });
  assert.equal(res.statusCode, 401, res.body);
  assert.deepEqual(calls, ['jwt']);
});

test('Partner API key cannot search the knowledge base', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/knowledge/search?redirect=/partner-ingest',
    headers: PARTNER_KEY,
    payload: { query: 'x' },
  });
  assert.equal(res.statusCode, 401, res.body);
  assert.deepEqual(calls, ['jwt']);
});

test('Partner API key is accepted on the partner ingest route', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/v1/knowledge/partner-ingest', headers: PARTNER_KEY });
  assert.notEqual(res.statusCode, 401, res.body);
  assert.notEqual(res.statusCode, 403, res.body);
  assert.deepEqual(calls, ['partner']);
});
