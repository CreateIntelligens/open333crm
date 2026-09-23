/**
 * Embedding service — generates embeddings via Ollama BGE-M3
 * and performs vector similarity search using pgvector.
 *
 * Configuration is now per-tenant (TenantSettings.embeddingBaseUrl/Model).
 * Callers must pass tenantId so we can load the right Ollama target/model.
 */

import type { TenantDb } from '../../lib/tenant-db.js';
import { logger } from '@open333crm/core';
import { getEmbeddingSettings } from '../settings/embedding-settings.service.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ArticleSearchResult {
  id: string;
  title: string;
  summary: string;
  content: string;
  category: string;
  tags: string[];
  similarity: number;
}

interface SearchOptions {
  topK?: number;
  threshold?: number;
}

// ─── Embedding Generation ───────────────────────────────────────────────────

/**
 * 單次 embed 請求的逾時（毫秒）。
 *
 * 為什麼需要：原本的 fetch 沒有任何 timeout。Ollama 閒置一段時間會把
 * bge-m3 卸載，下一個請求要等模型重載（實測約 30~40 秒），期間每個請求
 * 都卡滿 Caddy 的 60s gateway timeout → 使用者連吃 3~5 次 504，每次等 60 秒。
 *
 * 設 25 秒：比 gateway 的 60s 短很多，讓我們能在「被 Caddy 切斷」之前
 * 自己收手並重試，把控制權留在應用層。
 */
const EMBED_TIMEOUT_MS = 25_000;

/**
 * 冷啟動重試次數。第一次逾時多半是模型正在載入，
 * 重試時模型通常已經在記憶體裡，會很快回來。
 *
 * 只重試 1 次是被 gateway 預算決定的，不是隨便選的：
 *   最壞總耗時 = 25s × 2 次 + 1s 重試間隔 = 51s
 * Caddy 的 gateway timeout 是 60s，扣掉 DB 查詢與序列化的餘裕（約 5s），
 * 可用預算約 55s。重試 2 次會變成 77s，反而又回到「被 Caddy 切斷」的老問題。
 */
const EMBED_COLD_START_RETRIES = 1;

/** 單次呼叫 Ollama embed，帶逾時 */
async function embedOnce(
  url: string,
  model: string,
  text: string,
  timeoutMs: number,
): Promise<number[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: text }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Ollama embed failed (${response.status}): ${errBody}`);
    }

    const data = (await response.json()) as { embeddings: number[][] };
    if (!data.embeddings || !data.embeddings[0]) {
      throw new Error('Ollama returned empty embeddings');
    }
    return data.embeddings[0];
  } finally {
    clearTimeout(timer);
  }
}

export async function generateEmbedding(
  prisma: TenantDb,
  tenantId: string,
  text: string,
): Promise<number[]> {
  const settings = await getEmbeddingSettings(prisma, tenantId);
  const url = `${settings.baseUrl}/api/embed`;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= EMBED_COLD_START_RETRIES; attempt++) {
    try {
      return await embedOnce(url, settings.model, text, EMBED_TIMEOUT_MS);
    } catch (err) {
      lastErr = err;
      const aborted = err instanceof Error && err.name === 'AbortError';
      if (!aborted || attempt === EMBED_COLD_START_RETRIES) break;
      // 逾時多半是模型冷啟動中——重試前讓它多載一會兒
      logger.warn(
        `[Embedding] embed 逾時（第 ${attempt + 1} 次，${EMBED_TIMEOUT_MS}ms），模型可能正在載入，重試中`,
      );
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }

  if (lastErr instanceof Error && lastErr.name === 'AbortError') {
    // 轉成可讀訊息：使用者看到的不該是 "AbortError"
    throw new Error(
      `向量化服務逾時（${EMBED_TIMEOUT_MS / 1000} 秒 × ${EMBED_COLD_START_RETRIES + 1} 次）。` +
        'AI 模型可能正在載入，請稍候再試；若持續發生請至「知識庫 → Embedding 設定」檢查服務狀態。',
    );
  }
  throw lastErr;
}

// ─── Article Text Preparation ───────────────────────────────────────────────

export function prepareArticleText(article: {
  title: string;
  category: string;
  tags: string[];
  summary: string;
  content: string;
  spec?: unknown;
  attachments?: { filename: string }[];
}): string {
  const parts = [
    `標題: ${article.title}`,
    `分類: ${article.category}`,
    article.tags.length > 0 ? `標籤: ${article.tags.join(', ')}` : '',
    article.spec ? `規格: ${JSON.stringify(article.spec)}` : '',
    `摘要: ${article.summary}`,
    `內容: ${article.content}`,
    article.attachments && article.attachments.length > 0
      ? `附件: ${article.attachments.map((a) => a.filename).join(', ')}`
      : '',
  ].filter(Boolean);

  const combined = parts.join('\n');
  // BGE-M3 supports up to 8192 tokens; truncate to ~4000 chars for safety
  return combined.slice(0, 4000);
}

// ─── Similarity Search ──────────────────────────────────────────────────────

export async function searchSimilarArticles(
  prisma: TenantDb,
  queryEmbedding: number[],
  tenantId: string,
  options: SearchOptions = {},
): Promise<ArticleSearchResult[]> {
  const settings = await getEmbeddingSettings(prisma, tenantId);
  const { topK = settings.topK, threshold = settings.threshold } = options;

  const vectorStr = `[${queryEmbedding.join(',')}]`;

  const results = await prisma.$queryRawUnsafe<
    {
      id: string;
      title: string;
      summary: string;
      content: string;
      category: string;
      tags: string[];
      similarity: number;
    }[]
  >(
    `SELECT id, title, summary, content, category, tags,
            1 - (embedding <=> $1::vector) AS similarity
     FROM km_articles
     WHERE "tenantId" = $2::uuid
       AND status = 'PUBLISHED'
       AND embedding IS NOT NULL
       AND 1 - (embedding <=> $1::vector) >= $3
     ORDER BY similarity DESC
     LIMIT $4`,
    vectorStr,
    tenantId,
    threshold,
    topK,
  );

  return results;
}

// ─── Embed Single Article ───────────────────────────────────────────────────

export async function embedArticle(
  prisma: TenantDb,
  articleId: string,
): Promise<void> {
  const article = await prisma.kmArticle.findUnique({
    where: { id: articleId },
    select: {
      tenantId: true,
      title: true,
      category: true,
      tags: true,
      summary: true,
      content: true,
      spec: true,
      attachments: { select: { filename: true } },
    },
  });

  if (!article) {
    throw new Error(`Article ${articleId} not found`);
  }

  const text = prepareArticleText(article);
  const embedding = await generateEmbedding(prisma, article.tenantId, text);
  const vectorStr = `[${embedding.join(',')}]`;
  const settings = await getEmbeddingSettings(prisma, article.tenantId);

  await prisma.$executeRawUnsafe(
    `UPDATE km_articles SET embedding = $1::vector, "embeddingModel" = $2 WHERE id = $3::uuid`,
    vectorStr,
    settings.model,
    articleId,
  );
}

// ─── Bulk Re-embed ──────────────────────────────────────────────────────────

export async function bulkReembed(
  prisma: TenantDb,
  tenantId: string,
): Promise<{ total: number; succeeded: number; failed: number }> {
  const articles = await prisma.kmArticle.findMany({
    where: { tenantId, status: 'PUBLISHED' },
    select: {
      id: true,
      title: true,
      category: true,
      tags: true,
      summary: true,
      content: true,
      spec: true,
      attachments: { select: { filename: true } },
    },
  });

  let succeeded = 0;
  let failed = 0;
  const settings = await getEmbeddingSettings(prisma, tenantId);

  for (const article of articles) {
    try {
      const text = prepareArticleText(article);
      const embedding = await generateEmbedding(prisma, tenantId, text);
      const vectorStr = `[${embedding.join(',')}]`;

      await prisma.$executeRawUnsafe(
        `UPDATE km_articles SET embedding = $1::vector, "embeddingModel" = $2 WHERE id = $3::uuid`,
        vectorStr,
        settings.model,
        article.id,
      );
      succeeded++;
    } catch (err) {
      logger.error(`[Embedding] Failed to embed article ${article.id}:`, err);
      failed++;
    }
  }

  return { total: articles.length, succeeded, failed };
}

// ─── Health Check ───────────────────────────────────────────────────────────

export async function checkOllamaHealth(
  prisma: TenantDb,
  tenantId: string,
): Promise<{
  ok: boolean;
  model?: string;
  error?: string;
}> {
  const settings = await getEmbeddingSettings(prisma, tenantId);

  try {
    const response = await fetch(`${settings.baseUrl}/api/tags`);
    if (!response.ok) {
      return { ok: false, error: `Ollama returned ${response.status}` };
    }

    const data = (await response.json()) as {
      models?: { name: string }[];
    };

    const models = data.models || [];
    const found = models.find(
      (m) => m.name === settings.model || m.name.startsWith(`${settings.model}:`),
    );

    if (!found) {
      return {
        ok: false,
        error: `Model "${settings.model}" not found. Available: ${models.map((m) => m.name).join(', ') || 'none'}`,
      };
    }

    return { ok: true, model: found.name };
  } catch (err) {
    return { ok: false, error: `Cannot reach Ollama: ${(err as Error).message}` };
  }
}
