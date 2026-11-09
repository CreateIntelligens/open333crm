/**
 * 知識庫路由的向量化與語意搜尋，以實際的向量化實作執行（change migrate-embedding-tenant-ctx）。
 *
 * 向量化服務換成假的 fetch（tests/support/fake-ollama.ts）。其他知識庫路由的測試見 knowledge-routes.test.ts，
 * 那裡的向量化是記錄呼叫的假函式。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, test } from 'vitest';
import { call, createKnowledgeFixture } from './knowledge-test-app.js';
import { fakeOllama, markedVector, vectorMarker } from '#tests/support/fake-ollama.js';

const fx = await createKnowledgeFixture('embedding-routes');
const ollama = fakeOllama();
afterAll(async () => {
  ollama.restore();
  await fx.cleanup();
});
beforeEach(() => ollama.reset());

const { app: appA } = await fx.buildApp(fx.A, 'manager', undefined, { realEffects: true });
const base = '/api/v1/knowledge';

async function storedVector(articleId: string) {
  const rows = await fx.owner.$queryRawUnsafe<Array<{ embedding: string | null; embeddingModel: string | null }>>(
    `SELECT embedding::text AS embedding, "embeddingModel" FROM km_articles WHERE id = $1::uuid`,
    articleId,
  );
  return { marker: vectorMarker(rows[0].embedding), model: rows[0].embeddingModel };
}

async function setVector(articleId: string, marker: number) {
  await fx.owner.$executeRawUnsafe(
    `UPDATE km_articles SET embedding = $1::vector, "embeddingModel" = 'seed' WHERE id = $2::uuid`,
    `[${markedVector(marker).join(',')}]`,
    articleId,
  );
}

async function waitFor(check: () => Promise<boolean>, what: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`等待逾時：${what}`);
}

describe('語意搜尋', () => {
  test('回傳本租戶已發布、相似度達門檻的文章', async () => {
    const hit = await fx.articleOf(fx.A, 'search-hit', { status: 'PUBLISHED' });
    const draft = await fx.articleOf(fx.A, 'search-draft');
    const other = await fx.articleOf(fx.B, 'search-other-tenant', { status: 'PUBLISHED' });
    for (const a of [hit, draft, other]) await setVector(a.id, 7);
    ollama.state.vector = markedVector(7);

    const res = await call(appA, 'POST', `${base}/search`, { query: '退貨流程' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.map((r: { id: string }) => r.id), [hit.id]);
    assert.ok(res.body.data[0].similarity > 0.99);
    assert.deepEqual(ollama.state.embedCalls.map((c) => c.input), ['退貨流程']);
  });
});

describe('Archived Articles Excluded from Retrieval', () => {
  test('ARCHIVED article is not returned by semantic search', async () => {
    const published = await fx.articleOf(fx.A, 'search-published', { status: 'PUBLISHED' });
    const archived = await fx.articleOf(fx.A, 'search-archived', { status: 'ARCHIVED' });
    for (const a of [published, archived]) await setVector(a.id, 8);
    ollama.state.vector = markedVector(8);

    const res = await call(appA, 'POST', `${base}/search`, { query: '封存的文章' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const ids = res.body.data.map((r: { id: string }) => r.id);
    assert.ok(ids.includes(published.id));
    assert.equal(ids.includes(archived.id), false);
  });


  test('ARCHIVED article is skipped by bulk re-embed', async () => {
    const published = await fx.articleOf(fx.A, 'bulk-published', { status: 'PUBLISHED' });
    const archived = await fx.articleOf(fx.A, 'bulk-archived', { status: 'ARCHIVED' });
    ollama.state.vector = markedVector(3);

    const res = await call(appA, 'POST', `${base}/bulk-embed`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await waitFor(async () => (await storedVector(published.id)).marker === 3, '已發布的文章寫入向量');
    assert.equal((await storedVector(archived.id)).marker, null, '封存的文章沒有向量');
  });
});

describe('單篇重新向量化的回應', () => {
  test('重新向量化成功', async () => {
    const a = await fx.articleOf(fx.A, 'reembed-ok', { status: 'PUBLISHED' });
    ollama.state.vector = markedVector(5);
    const res = await call(appA, 'POST', `${base}/${a.id}/embed`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data, { embedded: true });
    assert.equal((await storedVector(a.id)).marker, 5);
  });

  test('重新向量化期間文章被修改', async () => {
    const a = await fx.articleOf(fx.A, 'reembed-changed', { status: 'PUBLISHED' });
    ollama.state.beforeEmbedReturns = async () => {
      await fx.owner.kmArticle.update({ where: { id: a.id }, data: { content: '另一位成員改過的內容' } });
    };
    const res = await call(appA, 'POST', `${base}/${a.id}/embed`);
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.error?.code, 'ARTICLE_CHANGED');
    assert.equal((await storedVector(a.id)).marker, null, '這次的向量沒有寫入');
  });
});
