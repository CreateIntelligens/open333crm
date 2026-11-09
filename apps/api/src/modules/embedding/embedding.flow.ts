/**
 * 向量化的 flow（change migrate-embedding-tenant-ctx，design D2、D3、D5）。
 *
 * 每次向量化都是「交易 → 交易外呼叫向量化服務 → 交易」：交易內只讀寫資料庫，
 * 向量化服務最久要 51 秒，不能佔住交易（AGENTS.md 結構規則 2）。
 */
import type { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { inTenant } from '../../lib/tenant-ctx.js';
import { embedText, modelNotInstalledError, probeEmbeddingService } from './embedding-client.js';
import {
  listPublishedArticleIds,
  readArticleForEmbedding,
  readEmbeddingInputs,
  searchSimilarArticles,
  writeArticleEmbedding,
  type ArticleSearchResult,
} from './embedding.service.js';
import { getEmbeddingSettings } from '../settings/embedding-settings.service.js';

export type EmbedArticleResult = 'written' | 'skipped' | 'not_found';

/**
 * 向量化一篇文章。向量化服務失敗時丟出錯誤，文章的向量不變。
 *
 * - `not_found`：交易 1 讀不到文章（不存在、屬於另一個租戶，或已被刪除）。
 * - `skipped`：向量化期間文章被修改、封存或刪除，這次的向量不寫入
 *   （spec km-ingestion「向量化期間文章被修改時不寫入向量」）。較新的寫入會自己開始向量化。
 */
export async function embedArticleFlow(
  deps: { prisma: PrismaClient },
  tenantId: string,
  articleId: string,
): Promise<EmbedArticleResult> {
  // 交易 1：模型名稱用這裡讀到的設定，與實際產生向量的模型相同
  const read = await inTenant(deps.prisma, tenantId, async (scope) => {
    const article = await readArticleForEmbedding(scope, articleId);
    if (!article) return null;
    return { article, ...(await readEmbeddingInputs(scope)) };
  });
  if (!read) return 'not_found';

  const { article, settings, policy } = read;
  const vector = await embedText(settings, policy, article.text);

  const written = await inTenant(deps.prisma, tenantId, (scope) =>
    writeArticleEmbedding(scope, articleId, { vector, model: settings.model, readUpdatedAt: article.updatedAt }),
  );
  if (!written) {
    logger.warn(`[Embedding] 向量化期間文章被修改、封存或刪除，不寫入這次的向量（article ${articleId}）`);
    return 'skipped';
  }
  return 'written';
}

/**
 * 重新向量化所有已發布的文章，逐篇處理。一篇失敗只記 log，繼續下一篇（design D3）。
 * 每篇各自讀設定與政策：處理期間設定被修改時，之後的文章用新的設定。
 */
export async function reembedPublishedArticlesFlow(
  deps: { prisma: PrismaClient },
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
  deps: { prisma: PrismaClient },
  tenantId: string,
  query: string,
  options: { topK?: number; threshold?: number } = {},
): Promise<ArticleSearchResult[]> {
  const { settings, policy } = await inTenant(deps.prisma, tenantId, (scope) => readEmbeddingInputs(scope));
  const vector = await embedText(settings, policy, query);
  return inTenant(deps.prisma, tenantId, (scope) =>
    searchSimilarArticles(scope, vector, {
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
  const settings = await inTenant(deps.prisma, tenantId, (scope) => getEmbeddingSettings(scope));
  const probe = await probeEmbeddingService(settings.baseUrl, settings.model);
  if (!probe.reachable) return { ok: false, error: probe.error };
  if (!probe.installed) return { ok: false, error: modelNotInstalledError(settings.model, probe.models) };
  return { ok: true, model: probe.installed.name };
}
