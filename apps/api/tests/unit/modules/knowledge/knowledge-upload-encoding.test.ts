/**
 * 知識庫上傳路由對 CSV 編碼的處理（issue #421，AUDIT KB-03，
 * spec km-ingestion「CSV import decodes UTF-8 and Big5 text」「CSV import rejects text that cannot be decoded」）。
 * 解析器用真的；寫入文章的 flow 換成記錄呼叫的假函式，用來確認亂碼檔整批不寫入。
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { afterAll, beforeAll, beforeEach, test, vi } from 'vitest';

const imported: { title: string; content: string; status?: string }[][] = [];
const created: { title: string; content: string }[] = [];

vi.mock('#src/modules/knowledge/knowledge.flow.js', () => ({
  createArticleFlow: async (_deps: unknown, _actor: unknown, input: { title: string; content: string }) => {
    created.push(input);
    return { id: 'article-1' };
  },
  importArticlesFlow: async (_deps: unknown, _actor: unknown, articles: { title: string; content: string }[]) => {
    imported.push(articles);
    return { imported: articles.length, failed: 0, errors: [] };
  },
}));
// 內容類型偵測（Magika）認不出不是 UTF-8 的文字：2026-11-04 UAT 上傳 Big5 CSV 回
// 「File content type rejected: file content type is unknown」（issue #470 前的英文訊息）。假函式照這個行為，原本一律通過的
// 假函式讓 #421 的測試沒發現 Big5 根本走不到解碼（AGENTS.md「A mock does only what the real code can do」）
vi.mock('#src/modules/upload/upload-validation.js', async () => {
  const { AppError } = await import('#src/shared/utils/response.js');
  return {
    assertUploadContent: async (input: { buffer: Buffer; clientMime: string }) => {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(input.buffer);
      } catch {
        // 訊息與真的 assertUploadContent 一致（issue #470 改成中文，英文原因在 details.reason）
        throw new AppError(
          '無法辨識檔案內容，請確認檔案沒有損壞，且是允許的格式（PDF、Word（DOCX）、Excel（XLSX）、CSV、HTML、Markdown、純文字（TXT））',
          'INVALID_FILE_TYPE',
          400,
          { reason: 'file content type is unknown' },
        );
      }
      return { accepted: true, detectedMime: input.clientMime, reason: 'test' };
    },
  };
});
vi.mock('#src/guards/rbac.guard.js', () => ({
  requirePermission: () => async () => {},
}));
vi.mock('#src/modules/knowledge/partner-ingest.service.js', () => ({
  parseCmd: () => 'CREATE',
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

test('Big5 CSV from Taiwan Excel passes content detection and is split into readable QA articles', async () => {
  // 「問題,答案\n退貨要幾天,七天內可退貨\n」的 Big5 位元組
  const big5 = Buffer.from('b0ddc3442cb5aaaed70ab068b366ad6eb458a4d12ca443a4d1a4baa569b068b3660a', 'hex');
  const res = await upload('faq.csv', big5);
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { data: { uploaded: number; failed: number; results: { success: boolean; error?: string }[] } };
  assert.equal(body.data.failed, 0, JSON.stringify(body.data.results));
  assert.deepEqual(imported, [[{ title: '退貨要幾天', content: '七天內可退貨', status: 'PUBLISHED' }]]);
});
