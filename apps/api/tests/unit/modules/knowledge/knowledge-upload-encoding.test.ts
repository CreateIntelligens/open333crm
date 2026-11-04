/**
 * 知識庫上傳路由對 CSV 編碼的處理（issue #421，AUDIT KB-03，
 * spec km-ingestion「CSV import decodes UTF-8 and Big5 text」「CSV import rejects text that cannot be decoded」）。
 * 解析器用真的；寫入文章的 service 換成記錄呼叫的假函式，用來確認亂碼檔整批不寫入。
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { afterAll, beforeAll, beforeEach, test, vi } from 'vitest';

const imported: { title: string; content: string; status?: string }[][] = [];
const created: { title: string; content: string }[] = [];

vi.mock('#src/modules/knowledge/knowledge.service.js', () => ({
  listArticles: async () => ({ articles: [], total: 0, page: 1, limit: 50 }),
  listSources: async () => [],
  getArticle: async () => ({ id: 'article-1' }),
  createArticle: async (_db: unknown, _tenantId: string, _agentId: string, input: { title: string; content: string }) => {
    created.push(input);
    return { id: 'article-1' };
  },
  updateArticle: async () => ({}),
  deleteArticle: async () => ({}),
  publishArticle: async () => ({}),
  archiveArticle: async () => ({}),
  listCategories: async () => [],
  semanticSearch: async () => [],
  batchImportArticles: async (_db: unknown, _tenantId: string, _agentId: string, articles: { title: string; content: string }[]) => {
    imported.push(articles);
    return { imported: articles.length, failed: 0, errors: [] };
  },
  bulkReembed: async () => ({}),
  checkOllamaHealth: async () => ({}),
  embedArticle: async () => ({}),
}));
vi.mock('#src/modules/upload/upload-validation.js', () => ({
  assertUploadContent: async (input: { clientMime: string }) => ({ accepted: true, detectedMime: input.clientMime, reason: 'test' }),
}));
vi.mock('#src/guards/rbac.guard.js', () => ({
  requirePermission: () => async () => {},
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
const BOUNDARY = '----open333-test-boundary';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.decorate('authenticate', async (request: FastifyRequest) => {
    (request as any).agent = { id: 'agent-1', tenantId: TENANT_A, role: 'ADMIN' };
    (request as any).tenantPrisma = {};
  });
  app.decorate('authenticateJwtOrPartnerKey', async () => {});
  app.decorate('prisma', {} as never);
  app.decorate('prismaAdmin', {} as never);
  app.decorateRequest('agent', null);
  app.decorateRequest('tenantPrisma', null);
  await app.register(multipart);
  await app.register(errorHandlerPlugin);
  await app.register(knowledgeRoutes, { prefix: '/api/v1/knowledge' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  imported.length = 0;
  created.length = 0;
});

function multipartBody(filename: string, content: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\n` +
        'Content-Type: text/csv\r\n\r\n',
    ),
    content,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
}

function upload(filename: string, content: Buffer) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/knowledge/upload',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: multipartBody(filename, content),
  });
}

test('UTF-8 CSV without BOM is split into published QA articles with readable Chinese', async () => {
  const res = await upload('faq.csv', Buffer.from('問題,答案\n退貨要幾天,七天內可退貨\n', 'utf-8'));
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(imported, [[{ title: '退貨要幾天', content: '七天內可退貨', status: 'PUBLISHED' }]]);
  assert.equal(created.length, 0);
});

test('CSV that cannot be decoded is rejected and nothing is written', async () => {
  const garbled = Buffer.concat([
    Buffer.from('question,answer\n', 'utf-8'),
    Buffer.from([0x81, 0x30, 0x2c, 0x81, 0x31, 0x0a]),
  ]);
  const res = await upload('faq.csv', garbled);
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { data: { uploaded: number; failed: number; results: { success: boolean; error?: string; code?: string }[] } };
  assert.equal(body.data.uploaded, 0);
  assert.equal(body.data.failed, 1);
  assert.equal(body.data.results[0].success, false);
  assert.equal(body.data.results[0].code, 'CSV_ENCODING_UNREADABLE');
  assert.match(body.data.results[0].error ?? '', /UTF-8/);
  assert.equal(imported.length, 0);
  assert.equal(created.length, 0);
});
