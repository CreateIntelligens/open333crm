/**
 * 回填 migration 20261119120000_add_embedding_provider（change add-gemini-embedding-provider，design D4）。
 *
 * 有向量、但 embeddingModel 是空值或空字串的文章，補上租戶目前的模型；沒有設定列時補 bge-m3。
 * 補完後，搜尋的「只比對目前模型」條件不會丟掉這些向量。
 * 測試讀出 migration.sql 的回填語句，在 owner（superuser）交易內對自建資料執行並斷言，最後回滾：
 * 語句是全域的，不能留下對其他測試資料的寫入。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, test } from 'vitest';
import { repoRoot } from '#tests/support/paths.js';
import { markedVector } from '#tests/support/fake-ollama.js';

const owner = new PrismaClient();
const MARK = `ci-embedding-model-backfill-${Date.now()}`;
const SYSTEM = '00000000-0000-4000-8000-000000000000';

afterAll(async () => {
  await owner.$disconnect();
});

const migrationPath = resolve(
  repoRoot,
  'packages/database/prisma/migrations/20261119120000_add_embedding_provider/migration.sql',
);

async function readBackfill(): Promise<string> {
  const sql = await readFile(migrationPath, 'utf8');
  const match = sql.match(/^-- @backfill\s*$([\s\S]*?)^-- @end\s*$/m);
  assert.ok(match, 'migration.sql 缺少 -- @backfill … -- @end 區段');
  return match[1]!.trim();
}

class Rollback extends Error {}

async function inRolledBackTransaction(fn: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await owner.$transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
}

async function article(tx: Prisma.TransactionClient, tenantId: string, label: string, model: string | null, withVector = true) {
  const a = await tx.kmArticle.create({
    data: { tenantId, title: `${MARK}-${label}`, content: 'x', summary: '', category: '一般', tags: [], status: 'PUBLISHED', createdById: SYSTEM },
  });
  await tx.$executeRawUnsafe(
    `UPDATE km_articles SET embedding = $1::vector, "embeddingModel" = $2 WHERE id = $3::uuid`,
    withVector ? `[${markedVector(1).join(',')}]` : null,
    model,
    a.id,
  );
  return a.id;
}

async function modelOf(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRawUnsafe<Array<{ m: string | null }>>(`SELECT "embeddingModel" AS m FROM km_articles WHERE id = $1::uuid`, id);
  return rows[0]!.m;
}

test('空值的模型名稱補成租戶目前的模型，沒有設定列時補 bge-m3', async () => {
  const backfill = await readBackfill();
  await inRolledBackTransaction(async (tx) => {
    const withSettings = await tx.tenant.create({ data: { name: `${MARK}-with-settings` } });
    await tx.tenantSettings.create({ data: { tenantId: withSettings.id, embeddingModel: 'bge-m3-custom' } });
    const noSettings = await tx.tenant.create({ data: { name: `${MARK}-no-settings` } });

    const nullModel = await article(tx, withSettings.id, 'null', null);
    const emptyModel = await article(tx, withSettings.id, 'empty', '');
    const kept = await article(tx, withSettings.id, 'kept', 'other-model');
    const noVector = await article(tx, withSettings.id, 'no-vector', null, false);
    const defaulted = await article(tx, noSettings.id, 'default', null);

    await tx.$executeRawUnsafe(backfill);

    assert.equal(await modelOf(tx, nullModel), 'bge-m3-custom');
    assert.equal(await modelOf(tx, emptyModel), 'bge-m3-custom');
    assert.equal(await modelOf(tx, kept), 'other-model', '已有模型名稱的不改');
    assert.equal(await modelOf(tx, noVector), null, '沒有向量的不補');
    assert.equal(await modelOf(tx, defaulted), 'bge-m3');
  });
});
