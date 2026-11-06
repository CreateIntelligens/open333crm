/**
 * 知識庫的路由（change migrate-knowledge-tenant-ctx，spec km-ingestion）。
 *
 * 搬遷前寫成，搬遷前後都要通過。搬遷前失敗的項目見 tasks.md 第 1 節。
 */
import assert from 'node:assert/strict';
import { afterAll, describe, test } from 'vitest';
import { call, createKnowledgeFixture } from './knowledge-test-app.js';

const fx = await createKnowledgeFixture('routes');
afterAll(() => fx.cleanup());

const { app: appA, rec } = await fx.buildApp(fx.A, 'manager');
const base = '/api/v1/knowledge';
const MISSING_ID = '00000000-0000-4000-8000-00000000abcd';

describe('知識庫管理只作用在本租戶的資料', () => {
  test('列出文章', async () => {
    const a1 = await fx.articleOf(fx.A, 'list-a1');
    const a2 = await fx.articleOf(fx.A, 'list-a2');
    await fx.articleOf(fx.B, 'list-b');

    const res = await call(appA, 'GET', `${base}?limit=100&q=${encodeURIComponent(`${fx.mark}-list`)}`);
    assert.equal(res.status, 200);
    const ids = (res.body.data as Array<{ id: string }>).map((a) => a.id).sort();
    assert.deepEqual(ids, [a1.id, a2.id].sort());
    assert.equal(res.body.meta.total, 2);
  });

  test('讀取另一個租戶的文章', async () => {
    const b = await fx.articleOf(fx.B, 'read-b');
    const res = await call(appA, 'GET', `${base}/${b.id}`);
    assert.equal(res.status, 404);
    const after = await fx.owner.kmArticle.findUniqueOrThrow({ where: { id: b.id } });
    assert.equal(after.viewCount, 0);
  });

  test('修改另一個租戶的文章', async () => {
    const b = await fx.articleOf(fx.B, 'write-b');
    const requests: Array<['POST' | 'PATCH' | 'DELETE', string, unknown?]> = [
      ['PATCH', `${base}/${b.id}`, { title: `${fx.mark}-改名` }],
      ['POST', `${base}/${b.id}/publish`],
      ['POST', `${base}/${b.id}/archive`],
      ['DELETE', `${base}/${b.id}`],
    ];
    for (const [method, path, payload] of requests) {
      const res = await call(appA, method, path, payload);
      assert.equal(res.status, 404, `${method} ${path}`);
    }
    const after = await fx.owner.kmArticle.findUniqueOrThrow({ where: { id: b.id } });
    assert.equal(after.title, b.title);
    assert.equal(after.status, 'DRAFT');
  });

  test('重新向量化不存在或另一個租戶的文章', async () => {
    const b = await fx.articleOf(fx.B, 'embed-b');
    const before = rec.embedded.length;
    for (const id of [MISSING_ID, b.id]) {
      const res = await call(appA, 'POST', `${base}/${id}/embed`);
      assert.equal(res.status, 404, id);
      assert.equal(res.body.error?.code, 'NOT_FOUND', id);
    }
    assert.equal(rec.embedded.length, before, '沒有呼叫向量化服務');
  });

  test('處理另一個租戶的回報', async () => {
    const b = await fx.articleOf(fx.B, 'feedback-b');
    const feedback = await fx.feedbackOf(fx.B, b.id);
    const res = await call(appA, 'PATCH', `${base}/feedback/${feedback.id}/resolve`);
    assert.equal(res.status, 404);
    const after = await fx.owner.kbArticleFeedback.findUniqueOrThrow({ where: { id: feedback.id } });
    assert.equal(after.status, 'open');
  });
});

/** 斷言路由的 schema 擋下這個參數：值送到資料庫時 Prisma 也可能回 400，但沒有 details.issues */
function assertSchemaRejected(res: Awaited<ReturnType<typeof call>>, field: string, label: string) {
  assert.equal(res.status, 400, label);
  assert.equal(res.body.error?.code, 'VALIDATION_ERROR', label);
  const issues = (res.body.error?.details?.issues ?? []) as Array<{ path: string }>;
  assert.ok(issues.some((i) => i.path === field), `${label}：details.issues 沒有 ${field}`);
}

describe('知識庫路由驗證查詢參數與路徑參數', () => {
  test('文章 id 格式錯誤', async () => {
    const requests: Array<['GET' | 'POST' | 'PATCH' | 'DELETE', string, unknown?]> = [
      ['GET', `${base}/not-a-uuid`],
      ['PATCH', `${base}/not-a-uuid`, { title: 'x' }],
      ['DELETE', `${base}/not-a-uuid`],
      ['POST', `${base}/not-a-uuid/publish`],
      ['POST', `${base}/not-a-uuid/archive`],
      ['POST', `${base}/not-a-uuid/embed`],
      ['PATCH', `${base}/feedback/not-a-uuid/resolve`],
    ];
    for (const [method, path, payload] of requests) {
      assertSchemaRejected(await call(appA, method, path, payload), 'id', `${method} ${path}`);
    }
  });

  test('分頁參數超出範圍', async () => {
    assertSchemaRejected(await call(appA, 'GET', `${base}?page=0`), 'page', 'page=0');
    assertSchemaRejected(await call(appA, 'GET', `${base}?limit=101`), 'limit', 'limit=101');
  });

  test('沒有給每頁筆數', async () => {
    const res = await call(appA, 'GET', base);
    assert.equal(res.status, 200);
    assert.equal(res.body.meta.limit, 50);
  });

  test('回報的篩選值不合法', async () => {
    assertSchemaRejected(await call(appA, 'GET', `${base}/feedback?status=closed`), 'status', 'status=closed');
    assertSchemaRejected(await call(appA, 'GET', `${base}/feedback?articleId=not-a-uuid`), 'articleId', 'articleId');
  });
});

describe('批次匯入的每篇文章各自寫入', () => {
  test('一篇寫入失敗', async () => {
    // PostgreSQL 的 text 不接受 \u0000，第二篇在資料庫寫入時失敗
    const titles = [`${fx.mark}-batch-1`, `${fx.mark}-batch-2\u0000`, `${fx.mark}-batch-3`];
    const res = await call(appA, 'POST', `${base}/import`, {
      articles: titles.map((title) => ({ title, content: '內容' })),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.imported, 2);
    assert.equal(res.body.data.failed, 1);
    assert.equal(res.body.data.errors.length, 1);
    assert.ok((res.body.data.errors[0] as string).includes(`${fx.mark}-batch-2`));

    const stored = await fx.owner.kmArticle.findMany({ where: { tenantId: fx.A, title: { startsWith: `${fx.mark}-batch-` } } });
    assert.deepEqual(stored.map((a) => a.title).sort(), [titles[0], titles[2]]);
  });
});

describe('讀取知識庫需要檢視權限', () => {
  const READ_ROUTES: Array<['GET' | 'POST', string, unknown?]> = [
    ['GET', base],
    ['GET', `${base}/${MISSING_ID}`],
    ['GET', `${base}/sources`],
    ['GET', `${base}/categories`],
    ['POST', `${base}/search`, { query: '退貨' }],
    ['GET', `${base}/embedding-status`],
    ['GET', `${base}/models`],
    ['GET', `${base}/feedback/counts`],
    ['GET', `${base}/feedback`],
  ];

  test('角色沒有檢視權限', async () => {
    const { app } = await fx.buildApp(fx.A, 'inbox-only', ['inbox.view']);
    for (const [method, path, payload] of READ_ROUTES) {
      const res = await call(app, method, path, payload);
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.equal(res.body.error?.code, 'FORBIDDEN', `${method} ${path}`);
      assert.equal(res.body.error?.details?.requiredPermission, 'knowledge.view', `${method} ${path}`);
    }
  });

  test('角色有檢視權限', async () => {
    const { app } = await fx.buildApp(fx.A, 'view-only', ['knowledge.view']);
    const res = await call(app, 'GET', base);
    assert.equal(res.status, 200);
  });
});

describe('文章寫入在 commit 之後才開始向量化', () => {
  test('commit 之後開始向量化', async () => {
    let seen: Promise<unknown> | undefined;
    // 向量化開始時以 owner 連線（另一條連線）讀文章：commit 之前讀不到
    rec.embedImpl = async (_tenantId, articleId) => {
      seen = fx.owner.kmArticle.findUnique({ where: { id: articleId } });
      await seen;
    };
    try {
      const before = rec.embedded.length;
      const res = await call(appA, 'POST', base, { title: `${fx.mark}-embed-after-commit`, content: '內容' });
      assert.equal(res.status, 201);
      assert.deepEqual(rec.embedded.slice(before), [{ tenantId: fx.A, articleId: res.body.data.id }]);
      assert.ok(seen, '沒有開始向量化');
      assert.ok(await seen, '向量化開始時讀不到文章');
    } finally {
      rec.embedImpl = async () => {};
    }
  });

  test('向量化失敗不影響回應', async () => {
    rec.embedImpl = async () => {
      throw new Error('embedding service down');
    };
    try {
      const res = await call(appA, 'POST', base, { title: `${fx.mark}-embed-fails`, content: '內容' });
      assert.equal(res.status, 201);
      const stored = await fx.owner.kmArticle.findUnique({ where: { id: res.body.data.id } });
      assert.ok(stored);
    } finally {
      rec.embedImpl = async () => {};
    }
  });

  test('只改分類或標籤時不重新向量化', async () => {
    const a = await fx.articleOf(fx.A, 'meta-only');
    const before = rec.embedded.length;
    const res = await call(appA, 'PATCH', `${base}/${a.id}`, { category: '退換貨', tags: ['退貨'] });
    assert.equal(res.status, 200);
    assert.equal(rec.embedded.length, before);

    const changed = await call(appA, 'PATCH', `${base}/${a.id}`, { content: '新的內容' });
    assert.equal(changed.status, 200);
    assert.deepEqual(rec.embedded.slice(before), [{ tenantId: fx.A, articleId: a.id }]);
  });
});

describe('刪除附件資料列之後刪除 S3 上的檔案', () => {
  test('刪除文章時刪除附件的檔案', async () => {
    const a = await fx.articleOf(fx.A, 'delete-with-files');
    const keys = [`${fx.A}/media/kb/d/1.pdf`, `${fx.A}/media/kb/d/2.pdf`];
    for (const [i, storageKey] of keys.entries()) {
      await fx.owner.kmArticleAttachment.create({
        data: { articleId: a.id, filename: `${i}.pdf`, storageKey, url: 'u', mimeType: 'application/pdf', sizeBytes: 1 },
      });
    }
    const before = rec.removed.length;

    const res = await call(appA, 'DELETE', `${base}/${a.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.deleted, true);
    assert.equal(await fx.owner.kmArticle.count({ where: { id: a.id } }), 0);
    assert.deepEqual(rec.removed.slice(before).sort(), [...keys].sort());
  });
});
