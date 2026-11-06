/**
 * 合作方推送（change migrate-knowledge-tenant-ctx，spec km-ingestion）。
 *
 * 儲存服務以注入的假函式取代（design D1），內容偵測用真的。
 */
import assert from 'node:assert/strict';
import { afterAll, describe, test } from 'vitest';
import { PDF, createKnowledgeFixture, partnerForm } from './knowledge-test-app.js';

const fx = await createKnowledgeFixture('partner');
afterAll(() => fx.cleanup());

const { app, rec } = await fx.buildApp(fx.A, 'partner');
const url = '/api/v1/knowledge/partner-ingest';
let seq = 0;
const docId = (label: string) => `${label}-${Date.now()}-${++seq}`;

async function ingest(fields: Record<string, string>, files: Array<{ filename: string; content: Buffer }> = []) {
  const form = partnerForm({ AI_Q: '問題', AI_A: '答案', Source: 'test', ...fields }, files);
  const res = await app.inject({ method: 'POST', url, headers: form.headers, payload: form.payload });
  return { status: res.statusCode, body: res.json() as { data: any; error?: { code: string } } };
}

const attachmentsOf = (articleId: string) =>
  fx.owner.kmArticleAttachment.findMany({ where: { articleId }, orderBy: { filename: 'asc' } });

describe('合作方推送的附件在交易外上傳', () => {
  test('一個附件上傳失敗', async () => {
    rec.uploadImpl = (async (buffer, filename, mime, tenantId, directory, subPath) => {
      if (filename === 'b.pdf') throw new Error('storage unavailable');
      const key = `${tenantId}/${directory}/${subPath}/${filename}`;
      return { key, url: `https://storage.test/${key}` };
    }) as typeof rec.uploadImpl;
    try {
      const res = await ingest({ cmd: 'CREATE', DocID: docId('one-fails'), Ver: '1', IsAttached: 'true' }, [
        { filename: 'a.pdf', content: PDF },
        { filename: 'b.pdf', content: PDF },
      ]);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.status, 'created');
      assert.equal(res.body.data.attachmentsLinked, 1);
      assert.deepEqual((await attachmentsOf(res.body.data.articleId)).map((a) => a.filename), ['a.pdf']);
    } finally {
      rec.uploadImpl = (async (_b, filename, _m, tenantId, directory, subPath) => {
        const key = `${tenantId}/${directory}/${subPath}/${crypto.randomUUID()}-${filename}`;
        return { key, url: `https://storage.test/${key}` };
      }) as typeof rec.uploadImpl;
    }
  });

  test('上傳期間另一個推送寫入較新的版本', async () => {
    const id = docId('race');
    const article = await fx.articleOf(fx.A, 'race', { status: 'PUBLISHED', externalDocId: id, externalVer: 1 });
    const original = rec.uploadImpl;
    rec.uploadImpl = (async (...args) => {
      // 上傳期間，另一個推送以 Ver 5 寫入完成
      await fx.owner.kmArticle.update({ where: { id: article.id }, data: { externalVer: 5, title: 'Ver 5 的標題' } });
      return original(...args);
    }) as typeof rec.uploadImpl;
    try {
      const res = await ingest({ cmd: 'UPDATE', DocID: id, Ver: '2', IsAttached: 'true' }, [{ filename: 'v2.pdf', content: PDF }]);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.status, 'skipped');
      const after = await fx.owner.kmArticle.findUniqueOrThrow({ where: { id: article.id } });
      assert.equal(after.externalVer, 5);
      assert.equal(after.title, 'Ver 5 的標題');
    } finally {
      rec.uploadImpl = original;
    }
  });

  test('寫入文章失敗', async () => {
    const id = docId('write-fails');
    const original = rec.uploadImpl;
    // PostgreSQL 的 text 不接受 \u0000：附件資料列在交易 2 寫入時失敗
    rec.uploadImpl = (async () => ({ key: `bad\u0000key-${id}`, url: 'https://storage.test/bad' })) as typeof rec.uploadImpl;
    const uploadedBefore = rec.uploaded.length;
    const removedBefore = rec.removed.length;
    const embeddedBefore = rec.embedded.length;
    try {
      const res = await ingest({ cmd: 'CREATE', DocID: id, Ver: '1', IsAttached: 'true' }, [{ filename: 'a.pdf', content: PDF }]);
      assert.equal(res.status, 500);
      assert.equal(res.body.error?.code, 'INGEST_FAILED');
      assert.equal(await fx.owner.kmArticle.count({ where: { tenantId: fx.A, externalDocId: id } }), 0);
      assert.equal(rec.uploaded.length, uploadedBefore + 1, '檔案已上傳，留在儲存服務');
      assert.equal(rec.removed.length, removedBefore, '沒有刪除檔案');
      assert.equal(rec.embedded.length, embeddedBefore, '沒有開始向量化');
    } finally {
      rec.uploadImpl = original;
    }
  });
});

describe('Partner Doc Mutation Command（拆成三段之後行為不變）', () => {
  test('CREATE on new DocID', async () => {
    const res = await ingest({ cmd: 'CREATE', DocID: docId('create'), Ver: '1' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'created');
    const stored = await fx.owner.kmArticle.findUniqueOrThrow({ where: { id: res.body.data.articleId } });
    assert.equal(stored.status, 'PUBLISHED');
  });

  test('CREATE on existing PUBLISHED DocID', async () => {
    const id = docId('conflict');
    const article = await fx.articleOf(fx.A, 'conflict', { status: 'PUBLISHED', externalDocId: id, externalVer: 1 });
    const res = await ingest({ cmd: 'CREATE', DocID: id, Ver: '2' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error?.code, 'DOCID_CONFLICT');
    const after = await fx.owner.kmArticle.findUniqueOrThrow({ where: { id: article.id } });
    assert.equal(after.externalVer, 1);
    assert.equal(after.title, article.title);
  });

  test('CREATE on existing ARCHIVED DocID (revive)', async () => {
    const id = docId('revive');
    const article = await fx.articleOf(fx.A, 'revive', { status: 'ARCHIVED', externalDocId: id, externalVer: 1 });
    const res = await ingest({ cmd: 'CREATE', DocID: id, Ver: '2', AI_Q: '復活的標題' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'revived');
    const after = await fx.owner.kmArticle.findUniqueOrThrow({ where: { id: article.id } });
    assert.equal(after.status, 'PUBLISHED');
    assert.equal(after.title, '復活的標題');
  });

  test('UPDATE missing DocID', async () => {
    const res = await ingest({ cmd: 'UPDATE', DocID: docId('missing'), Ver: '1' });
    assert.equal(res.status, 404);
    assert.equal(res.body.error?.code, 'DOCID_NOT_FOUND');
  });

  test('UPDATE with newer Ver', async () => {
    const id = docId('update');
    const article = await fx.articleOf(fx.A, 'update', { status: 'PUBLISHED', externalDocId: id, externalVer: 1 });
    const res = await ingest({ cmd: 'UPDATE', DocID: id, Ver: '2', AI_A: '新的答案', IsAttached: 'true' }, [{ filename: 'new.pdf', content: PDF }]);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'updated');
    const after = await fx.owner.kmArticle.findUniqueOrThrow({ where: { id: article.id } });
    assert.equal(after.content, '新的答案');
    assert.equal(after.externalVer, 2);
    assert.deepEqual((await attachmentsOf(article.id)).map((a) => a.filename), ['new.pdf']);
  });

  test('UPDATE with stale Ver', async () => {
    const id = docId('stale');
    const article = await fx.articleOf(fx.A, 'stale', { status: 'PUBLISHED', externalDocId: id, externalVer: 3 });
    const res = await ingest({ cmd: 'UPDATE', DocID: id, Ver: '3' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'skipped');
    assert.match(res.body.data.reason, /ver/);
    const after = await fx.owner.kmArticle.findUniqueOrThrow({ where: { id: article.id } });
    assert.equal(after.title, article.title);
  });

  test('DELETE soft-delete an existing PUBLISHED DocID', async () => {
    const id = docId('delete');
    const article = await fx.articleOf(fx.A, 'delete', { status: 'PUBLISHED', externalDocId: id, externalVer: 1 });
    // 向量的維度以資料庫的欄位為準：schema 寫 1024，migration 建的欄位不同（AUDIT DB-01）
    await fx.owner.$executeRawUnsafe(
      `UPDATE km_articles SET embedding = array_fill(0.1::real, ARRAY[(
         SELECT atttypmod FROM pg_attribute WHERE attrelid = 'km_articles'::regclass AND attname = 'embedding'
       )])::vector WHERE id = $1::uuid`,
      article.id,
    );
    await fx.owner.kmArticleAttachment.create({
      data: { articleId: article.id, filename: 'kept.pdf', storageKey: `${fx.A}/media/kb/${id}/kept.pdf`, url: 'u', mimeType: 'application/pdf', sizeBytes: 1 },
    });
    const removedBefore = rec.removed.length;

    const res = await ingest({ cmd: 'DELETE', DocID: id, Ver: '2' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'deleted');
    const after = await fx.owner.kmArticle.findUniqueOrThrow({ where: { id: article.id } });
    assert.equal(after.status, 'ARCHIVED');
    const [emb] = await fx.owner.$queryRawUnsafe<{ has: boolean }[]>(
      `SELECT (embedding IS NOT NULL) AS has FROM km_articles WHERE id = $1::uuid`,
      article.id,
    );
    assert.equal(emb.has, false);
    assert.deepEqual((await attachmentsOf(article.id)).map((a) => a.filename), ['kept.pdf']);
    assert.equal(rec.removed.length, removedBefore, '封存不刪附件的檔案');
  });

  test('DELETE idempotency for missing or already-archived DocID', async () => {
    const missing = await ingest({ cmd: 'DELETE', DocID: docId('gone'), Ver: '1' });
    assert.equal(missing.status, 200);
    assert.equal(missing.body.data.status, 'deleted');
    assert.match(missing.body.data.reason, /idempotent/);

    const id = docId('archived');
    await fx.articleOf(fx.A, 'archived', { status: 'ARCHIVED', externalDocId: id, externalVer: 1 });
    const archived = await ingest({ cmd: 'DELETE', DocID: id, Ver: '2' });
    assert.equal(archived.status, 200);
    assert.match(archived.body.data.reason, /idempotent/);
  });

  test('Invalid or missing cmd', async () => {
    for (const cmd of ['', 'PATCH']) {
      const id = docId('invalid');
      const res = await ingest({ cmd, DocID: id, Ver: '1' });
      assert.equal(res.status, 400, cmd);
      assert.equal(res.body.error?.code, 'INVALID_CMD', cmd);
      assert.equal(await fx.owner.kmArticle.count({ where: { tenantId: fx.A, externalDocId: id } }), 0);
    }
  });
});

describe('刪除附件資料列之後刪除 S3 上的檔案', () => {
  test('覆蓋文章時刪除舊附件的檔案', async () => {
    const id = docId('overwrite');
    const article = await fx.articleOf(fx.A, 'overwrite', { status: 'PUBLISHED', externalDocId: id, externalVer: 1 });
    const oldKey = `${fx.A}/media/kb/${id}/old-x.pdf`;
    await fx.owner.kmArticleAttachment.create({
      data: { articleId: article.id, filename: 'x.pdf', storageKey: oldKey, url: 'u', mimeType: 'application/pdf', sizeBytes: 1 },
    });
    const removedBefore = rec.removed.length;

    const res = await ingest({ cmd: 'UPDATE', DocID: id, Ver: '2', IsAttached: 'true' }, [{ filename: 'y.pdf', content: PDF }]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'updated');

    const attachments = await attachmentsOf(article.id);
    assert.deepEqual(attachments.map((a) => a.filename), ['y.pdf']);
    assert.deepEqual(rec.removed.slice(removedBefore), [oldKey]);
  });
});
