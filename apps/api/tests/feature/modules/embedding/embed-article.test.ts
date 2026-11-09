/**
 * 文章向量化（change migrate-embedding-tenant-ctx，spec km-ingestion「Automated Vectorization and Indexing」
 * 「向量化期間文章被修改時不寫入向量」）。
 *
 * 從 knowledge 的向量化效果函式進入，走 app_tenant 連線（RLS）。向量化服務換成假的 fetch，
 * 「向量化期間」的修改在假服務回傳之前以 owner 連線寫入。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createKnowledgeEffects } from '#src/modules/knowledge/knowledge-effects.js';
import { createKnowledgeFixture } from '../knowledge/knowledge-test-app.js';
import { fakeOllama, markedVector, vectorMarker } from '#tests/support/fake-ollama.js';

const fx = await createKnowledgeFixture('embed-article');
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const ollama = fakeOllama();
const { embed } = createKnowledgeEffects(tenantDb);

afterAll(async () => {
  ollama.restore();
  await tenantDb.$disconnect();
  await fx.cleanup();
});
beforeEach(() => ollama.reset());

async function stored(articleId: string) {
  const rows = await fx.owner.$queryRawUnsafe<Array<{ embedding: string | null; embeddingModel: string | null }>>(
    `SELECT embedding::text AS embedding, "embeddingModel" FROM km_articles WHERE id = $1::uuid`,
    articleId,
  );
  return { marker: vectorMarker(rows[0].embedding), model: rows[0].embeddingModel };
}

async function setVector(articleId: string, marker: number, model: string) {
  await fx.owner.$executeRawUnsafe(
    `UPDATE km_articles SET embedding = $1::vector, "embeddingModel" = $2 WHERE id = $3::uuid`,
    `[${markedVector(marker).join(',')}]`,
    model,
    articleId,
  );
}

async function setModel(tenantId: string, model: string) {
  await fx.owner.tenantSettings.upsert({
    where: { tenantId },
    create: { tenantId, embeddingModel: model },
    update: { embeddingModel: model },
  });
}

describe('Automated Vectorization and Indexing', () => {
  test('Successful vectorization', async () => {
    await setModel(fx.A, 'bge-m3-custom');
    const a = await fx.articleOf(fx.A, 'success', { status: 'PUBLISHED' });
    ollama.state.vector = markedVector(4);

    await embed(fx.A, a.id);

    assert.deepEqual(await stored(a.id), { marker: 4, model: 'bge-m3-custom' });
    assert.equal(ollama.state.embedCalls.length, 1);
    assert.equal(ollama.state.embedCalls[0].model, 'bge-m3-custom');
    assert.match(ollama.state.embedCalls[0].input, /標題: .*success/);
  });

  test('向量化服務失敗時不改向量', async () => {
    const a = await fx.articleOf(fx.A, 'service-fails', { status: 'PUBLISHED' });
    await setVector(a.id, 2, 'old-model');
    ollama.state.embedStatus = 500;

    await assert.rejects(embed(fx.A, a.id));

    assert.deepEqual(await stored(a.id), { marker: 2, model: 'old-model' });
  });

  test('向量化期間換模型時，記下產生向量的模型', async () => {
    await setModel(fx.A, 'bge-m3');
    const a = await fx.articleOf(fx.A, 'model-switch', { status: 'PUBLISHED' });
    ollama.state.beforeEmbedReturns = () => setModel(fx.A, 'bge-m3-custom');

    await embed(fx.A, a.id);

    assert.equal(ollama.state.embedCalls[0].model, 'bge-m3');
    assert.equal((await stored(a.id)).model, 'bge-m3');
  });
});

describe('向量化期間文章被修改時不寫入向量', () => {
  test('向量化期間文章被修改', async () => {
    const a = await fx.articleOf(fx.A, 'changed', { status: 'PUBLISHED' });
    ollama.state.vector = markedVector(1);
    ollama.state.beforeEmbedReturns = async () => {
      ollama.state.beforeEmbedReturns = null;
      await fx.owner.kmArticle.update({ where: { id: a.id }, data: { content: '第二版內容' } });
    };

    await embed(fx.A, a.id).catch(() => {});
    assert.equal((await stored(a.id)).marker, null, '第一版的向量沒有寫入');

    // 第二版寫入之後開始的向量化
    ollama.state.vector = markedVector(2);
    await embed(fx.A, a.id);
    assert.equal((await stored(a.id)).marker, 2, '文章的向量是第二版的向量');
    assert.match(ollama.state.embedCalls[1].input, /第二版內容/);
  });

  test('向量化期間文章沒有被修改', async () => {
    const a = await fx.articleOf(fx.A, 'unchanged', { status: 'PUBLISHED' });
    const neighbour = await fx.articleOf(fx.A, 'unchanged-neighbour', { status: 'PUBLISHED' });
    ollama.state.vector = markedVector(6);
    // 同一個租戶的另一篇文章被修改，不影響這一篇
    ollama.state.beforeEmbedReturns = async () => {
      await fx.owner.kmArticle.update({ where: { id: neighbour.id }, data: { content: '別篇的新內容' } });
    };

    await embed(fx.A, a.id);

    assert.equal((await stored(a.id)).marker, 6);
  });
});

describe('向量化期間只有不影響向量化文字的欄位改變', () => {
  test('向量化期間有人瀏覽文章', async () => {
    const a = await fx.articleOf(fx.A, 'viewed', { status: 'PUBLISHED' });
    ollama.state.vector = markedVector(9);
    // 同 getArticle()：以 Prisma 的 update 累加瀏覽次數，@updatedAt 跟著改變
    ollama.state.beforeEmbedReturns = async () => {
      await fx.owner.kmArticle.update({ where: { id: a.id }, data: { viewCount: { increment: 1 } } });
    };

    assert.equal(await embed(fx.A, a.id), 'written');

    assert.equal((await stored(a.id)).marker, 9);
  });

  test('向量化期間文章被封存', async () => {
    const a = await fx.articleOf(fx.A, 'archived', { status: 'PUBLISHED' });
    ollama.state.vector = markedVector(12);
    ollama.state.beforeEmbedReturns = async () => {
      await fx.owner.kmArticle.update({ where: { id: a.id }, data: { status: 'ARCHIVED' } });
    };

    assert.equal(await embed(fx.A, a.id), 'written');

    // 封存的文章有向量也不會被檢索到（knowledge-embedding-routes.test.ts「ARCHIVED article is not returned by semantic search」）
    assert.equal((await stored(a.id)).marker, 12);
  });

  test('向量化期間文章被發布', async () => {
    // 已有舊向量的草稿改了內容，向量化還沒完成就被發布：發布看到已有向量，不會再開始向量化
    const a = await fx.articleOf(fx.A, 'published-during', { status: 'DRAFT' });
    await setVector(a.id, 2, 'bge-m3');
    ollama.state.vector = markedVector(11);
    ollama.state.beforeEmbedReturns = async () => {
      await fx.owner.kmArticle.update({ where: { id: a.id }, data: { status: 'PUBLISHED' } });
    };

    assert.equal(await embed(fx.A, a.id), 'written');

    assert.equal((await stored(a.id)).marker, 11, '文章的向量是這次的結果，不是舊向量');
  });
});

describe('只寫入本租戶的文章', () => {
  test('另一個租戶的文章不向量化', async () => {
    const other = await fx.articleOf(fx.B, 'other-tenant', { status: 'PUBLISHED' });

    await embed(fx.A, other.id).catch(() => {});

    assert.equal((await stored(other.id)).marker, null);
    assert.equal(ollama.state.embedCalls.length, 0, '沒有呼叫向量化服務');
  });
});
