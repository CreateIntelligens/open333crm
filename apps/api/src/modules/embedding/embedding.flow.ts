/**
 * 向量化的 flow（change migrate-embedding-tenant-ctx，design D2、D3、D5）。
 *
 * 每次向量化都是「交易 → 交易外呼叫向量化服務 → 交易」：交易內只讀寫資料庫，
 * 向量化服務最久要 51 秒，不能佔住交易（AGENTS.md 結構規則 2）。
 */
import type { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { inTenant } from '../../lib/tenant-ctx.js';
import { GEMINI_EMBED_MAX_CHARS, embedText, modelNotInstalledError, probeEmbeddingService, type EmbeddingTarget } from './embedding-client.js';
import {
  listPublishedArticleIds,
  readArticleForEmbedding,
  readEmbeddingInputs,
  searchSimilarArticles,
  writeArticleEmbedding,
  type ArticleSearchResult,
  readEmbeddingProbeTarget,
  type EmbeddingInputs,
} from './embedding.service.js';
import { assertMonthlyQuota, recordLlmUsage, type LlmDeps } from '../ai/llm.flow.js';

/**
 * 向量化 flow 的依賴。Gemini 向量化要檢查月額度、寫用量紀錄，所以和 LLM 呼叫用同一組依賴。
 * - prisma：inTenant() 的基礎連線（app_tenant）。
 * - redis：月額度計數器。
 * - events：用量跨過門檻時寫 outbox。
 */
export type EmbeddingDeps = LlmDeps;

/**
 * 交易外向量化一段文字（spec embedding-settings「Gemini 向量化」「Gemini 向量化記錄用量並檢查月額度」）。
 *
 * - Ollama：直接呼叫，不檢查月額度、不寫用量。
 * - Gemini：先檢查月額度（平台金鑰才檢查），呼叫後寫一筆 `feature: 'embedding'` 的用量。
 *   Gemini 的回應沒有 token 數，以送出的字數估算（中文 1 字約 1 token，估算偏高，不會少算）。
 */
export async function embedWithUsage(
  deps: EmbeddingDeps,
  tenantId: string,
  inputs: EmbeddingInputs,
  text: string,
  purpose: EmbeddingTarget['purpose'],
): Promise<number[]> {
  const { settings, policy, apiKey, keySource, monthlyTokens } = inputs;
  const target: EmbeddingTarget = { ...settings, apiKey, purpose };
  if (settings.provider !== 'gemini') return embedText(target, policy, text);

  const account = { tenantId, keySource, monthlyTokens };
  await assertMonthlyQuota(deps, account);
  const usageBase = { provider: 'gemini', model: settings.model, meta: { feature: 'embedding' as const } };
  let vector: number[];
  try {
    vector = await embedText(target, policy, text);
  } catch (err) {
    await recordLlmUsage(deps, account, { ...usageBase, success: false, errorCode: (err as Error).message?.slice(0, 200) });
    throw err;
  }
  const promptTokens = Math.min(text.length, GEMINI_EMBED_MAX_CHARS);
  await recordLlmUsage(deps, account, {
    ...usageBase,
    usage: { promptTokens, cachedTokens: 0, candidatesTokens: 0, thoughtsTokens: 0 },
    success: true,
  });
  return vector;
}

export type EmbedArticleResult = 'written' | 'skipped' | 'not_found';

/**
 * 向量化一篇文章。向量化服務失敗時丟出錯誤，文章的向量不變。
 *
 * - `not_found`：交易 1 讀不到文章（不存在、屬於另一個租戶，或已被刪除）。
 * - `skipped`：向量化期間文章的向量化文字改變，或文章被刪除，這次的向量不寫入
 *   （spec km-ingestion「向量化期間文章被修改時不寫入向量」）。較新的寫入會自己開始向量化。
 */
export async function embedArticleFlow(
  deps: EmbeddingDeps,
  tenantId: string,
  articleId: string,
): Promise<EmbedArticleResult> {
  // 交易 1：模型名稱用這裡讀到的設定，與實際產生向量的模型相同
  const read = await inTenant(deps.prisma, tenantId, async (scope) => {
    const text = await readArticleForEmbedding(scope, articleId);
    if (text === null) return null;
    return { text, inputs: await readEmbeddingInputs(scope) };
  });
  if (!read) return 'not_found';

  const { text, inputs } = read;
  const { settings } = inputs;
  const vector = await embedWithUsage(deps, tenantId, inputs, text, 'document');

  const written = await inTenant(deps.prisma, tenantId, (scope) =>
    writeArticleEmbedding(scope, articleId, { vector, model: settings.model, sourceText: text }),
  );
  if (!written) {
    logger.warn(`[Embedding] 向量化期間文章被修改或刪除，不寫入這次的向量（article ${articleId}）`);
    return 'skipped';
  }
  return 'written';
}

/**
 * 重新向量化所有已發布的文章，逐篇處理。一篇失敗只記 log，繼續下一篇（design D3）。
 * 每篇各自讀設定與政策：處理期間設定被修改時，之後的文章用新的設定。
 */
export async function reembedPublishedArticlesFlow(
  deps: EmbeddingDeps,
  tenantId: string,
): Promise<{ total: number; succeeded: number; skipped: number; failed: number }> {
  const ids = await inTenant(deps.prisma, tenantId, (scope) => listPublishedArticleIds(scope));
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const result = await embedArticleFlow(deps, tenantId, id);
      if (result === 'written') succeeded++;
      else skipped++;
    } catch (err) {
      logger.error(`[Embedding] Failed to embed article ${id}:`, err);
      failed++;
    }
  }
  return { total: ids.length, succeeded, skipped, failed };
}

/** 交易內讀設定與政策 → 交易外向量化查詢文字 → 交易內搜尋。沒給 `topK`、`threshold` 時用租戶的設定 */
export async function searchArticlesByTextFlow(
  deps: EmbeddingDeps,
  tenantId: string,
  query: string,
  options: { topK?: number; threshold?: number } = {},
): Promise<ArticleSearchResult[]> {
  const inputs = await inTenant(deps.prisma, tenantId, (scope) => readEmbeddingInputs(scope));
  const { settings } = inputs;
  const vector = await embedWithUsage(deps, tenantId, inputs, query, 'query');
  return inTenant(deps.prisma, tenantId, (scope) =>
    searchSimilarArticles(scope, vector, {
      model: settings.model,
      topK: options.topK ?? settings.topK,
      threshold: options.threshold ?? settings.threshold,
    }),
  );
}

/** `GET /knowledge/embedding-status`：回應格式維持 `{ ok, model?, error? }` */
export async function embeddingStatusFlow(
  deps: { prisma: PrismaClient },
  tenantId: string,
): Promise<{ ok: boolean; model?: string; error?: string }> {
  const settings = await inTenant(deps.prisma, tenantId, (scope) => readEmbeddingProbeTarget(scope));
  const probe = await probeEmbeddingService(settings);
  if (!probe.reachable) return { ok: false, error: probe.error };
  if (!probe.installed) return { ok: false, error: modelNotInstalledError(settings.model, probe.models) };
  return { ok: true, model: probe.installed.name };
}
