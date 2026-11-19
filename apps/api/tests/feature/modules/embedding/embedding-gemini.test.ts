/**
 * Gemini 向量化：金鑰、用量紀錄與月額度（spec embedding-settings「Gemini 向量化」
 * 「Gemini 向量化記錄用量並檢查月額度」、ai-usage-recording、token-quota）。
 *
 * 路由走真實的 requirePermission、app_tenant 連線（RLS）與 Redis 計數器。Gemini 換成假的 fetch。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, test } from 'vitest';
import { call, createKnowledgeFixture } from '../knowledge/knowledge-test-app.js';
import { fakeGemini } from '#tests/support/fake-gemini.js';
import { fakeOllama, markedVector } from '#tests/support/fake-ollama.js';
import { getConfig } from '#src/config/env.js';
import { encryptApiKey } from '#src/modules/ai/ai-key.service.js';

const fx = await createKnowledgeFixture('embedding-gemini');
const gemini = fakeGemini();
const ollama = fakeOllama();
const config = getConfig() as { GEMINI_API_KEY?: string };
const originalPlatformKey = config.GEMINI_API_KEY;

afterAll(async () => {
  config.GEMINI_API_KEY = originalPlatformKey;
  // 兩個假 fetch 疊在一起：後建立的先還原
  ollama.restore();
  gemini.restore();
  await fx.cleanup();
});

const { app: appA } = await fx.buildApp(fx.A, 'manager', undefined, { realEffects: true });
const base = '/api/v1/knowledge';

/** 每個測試開始時：租戶 A 用 Gemini、沒有自備金鑰、沒有月額度上限、本月沒有用量 */
beforeEach(async () => {
  gemini.reset();
  ollama.reset();
  config.GEMINI_API_KEY = 'platform-key';
  await fx.owner.tenantSettings.upsert({
    where: { tenantId: fx.A },
    create: { tenantId: fx.A, embeddingProvider: 'gemini', embeddingModel: 'gemini-embedding-001' },
    update: { embeddingProvider: 'gemini', embeddingModel: 'gemini-embedding-001', geminiApiKeyEnc: null },
  });
  await fx.owner.tenant.update({ where: { id: fx.A }, data: { limitOverrides: {} } });
  await fx.owner.aiUsage.deleteMany({ where: { tenantId: fx.A } });
  const keys = await fx.redis.keys(`aiquota*:${fx.A}:*`);
  if (keys.length > 0) await fx.redis.del(...keys);
});

async function stored(articleId: string) {
  const rows = await fx.owner.$queryRawUnsafe<Array<{ model: string | null; hasVector: boolean }>>(
    `SELECT "embeddingModel" AS model, embedding IS NOT NULL AS "hasVector" FROM km_articles WHERE id = $1::uuid`,
    articleId,
  );
  return rows[0];
}

function usages() {
  return fx.owner.aiUsage.findMany({ where: { tenantId: fx.A }, orderBy: { createdAt: 'asc' } });
}

describe('Gemini 向量化', () => {
  test('文章以 Gemini 向量化', async () => {
    const a = await fx.articleOf(fx.A, 'gemini-doc', { status: 'PUBLISHED' });
    const res = await call(appA, 'POST', `${base}/${a.id}/embed`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(gemini.state.embedCalls.length, 1);
    assert.equal(gemini.state.embedCalls[0].taskType, 'RETRIEVAL_DOCUMENT');
    assert.equal(gemini.state.embedCalls[0].outputDimensionality, 1024);
    assert.equal(ollama.state.embedCalls.length, 0, '沒有呼叫 Ollama');
    assert.deepEqual(await stored(a.id), { model: 'gemini-embedding-001', hasVector: true });
  });

  test('搜尋以 Gemini 向量化查詢文字', async () => {
    const res = await call(appA, 'POST', `${base}/search`, { query: '怎麼設定關鍵字回覆' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(gemini.state.embedCalls[0].taskType, 'RETRIEVAL_QUERY');
    assert.equal(gemini.state.embedCalls[0].text, '怎麼設定關鍵字回覆');
  });

  test('使用租戶的自備金鑰', async () => {
    await fx.owner.tenantSettings.update({
      where: { tenantId: fx.A },
      data: { geminiApiKeyEnc: encryptApiKey('tenant-key') },
    });
    const res = await call(appA, 'POST', `${base}/search`, { query: '退貨' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(gemini.state.embedCalls[0].apiKey, 'tenant-key');
  });

  test('Gemini 回錯誤時文章的向量不變', async () => {
    const a = await fx.articleOf(fx.A, 'gemini-error', { status: 'PUBLISHED' });
    await fx.owner.$executeRawUnsafe(
      `UPDATE km_articles SET embedding = $1::vector, "embeddingModel" = 'gemini-embedding-001' WHERE id = $2::uuid`,
      `[${markedVector(4).join(',')}]`,
      a.id,
    );
    gemini.state.embedStatus = 400;
    const res = await call(appA, 'POST', `${base}/${a.id}/embed`);
    assert.notEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await stored(a.id), { model: 'gemini-embedding-001', hasVector: true });
  });
});

describe('Gemini 向量化記錄用量並檢查月額度', () => {
  test('Gemini 向量化寫入用量', async () => {
    const res = await call(appA, 'POST', `${base}/search`, { query: '字'.repeat(120) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const rows = await usages();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].feature, 'embedding');
    assert.equal(rows[0].provider, 'gemini');
    assert.equal(rows[0].model, 'gemini-embedding-001');
    assert.equal(rows[0].promptTokens, 120);
    assert.equal(rows[0].keySource, 'platform');
    assert.equal(rows[0].success, true);
  });

  test('Gemini 向量化的用量標記', async () => {
    const a = await fx.articleOf(fx.A, 'gemini-usage-doc', { status: 'PUBLISHED' });
    const res = await call(appA, 'POST', `${base}/${a.id}/embed`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const rows = await usages();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].feature, 'embedding');
  });

  test('額度已滿時不呼叫 Gemini', async () => {
    await fx.owner.tenant.update({ where: { id: fx.A }, data: { limitOverrides: { monthlyTokens: 100 } } });
    await fx.owner.aiUsage.create({
      data: {
        tenantId: fx.A,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        feature: 'kb-autoreply',
        promptTokens: 100,
        totalTokens: 100,
        success: true,
        keySource: 'platform',
      },
    });
    const res = await call(appA, 'POST', `${base}/search`, { query: '退貨' });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.error?.code, 'PLAN_LIMIT_EXCEEDED');
    assert.equal(gemini.state.embedCalls.length, 0, '沒有呼叫 Gemini');
  });

  test('Gemini 向量化達到上限', async () => {
    await fx.owner.tenant.update({ where: { id: fx.A }, data: { limitOverrides: { monthlyTokens: 100 } } });
    await fx.owner.aiUsage.create({
      data: {
        tenantId: fx.A,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        feature: 'kb-autoreply',
        promptTokens: 100,
        totalTokens: 100,
        success: true,
        keySource: 'platform',
      },
    });
    const a = await fx.articleOf(fx.A, 'gemini-quota-doc', { status: 'PUBLISHED' });
    const res = await call(appA, 'POST', `${base}/${a.id}/embed`);
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.error?.code, 'PLAN_LIMIT_EXCEEDED');
    assert.equal(gemini.state.embedCalls.length, 0, '沒有呼叫 Gemini');
  });

  test('Ollama 向量化不寫用量', async () => {
    await fx.owner.tenantSettings.update({
      where: { tenantId: fx.A },
      data: { embeddingProvider: 'ollama', embeddingModel: 'bge-m3' },
    });
    const a = await fx.articleOf(fx.A, 'ollama-doc', { status: 'PUBLISHED' });
    const res = await call(appA, 'POST', `${base}/${a.id}/embed`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(ollama.state.embedCalls.length, 1);
    assert.equal((await usages()).length, 0);
  });
});
