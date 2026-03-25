/**
 * Embedding service — generates embeddings via Ollama BGE-M3
 * and performs vector similarity search using pgvector.
 */

import type { PrismaClient } from '@prisma/client';
import { getConfig } from '../../config/env.js';

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

export async function generateEmbedding(text: string): Promise<number[]> {
  const config = getConfig();
  const url = `${config.OLLAMA_BASE_URL}/api/embed`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.OLLAMA_EMBED_MODEL,
      input: text,
    }),
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
}

// ─── Article Text Preparation ───────────────────────────────────────────────

export function prepareArticleText(article: {
  title: string;
  category: string;
  tags: string[];
  summary: string;
  content: string;
}): string {
  const parts = [
    `標題: ${article.title}`,
    `分類: ${article.category}`,
    article.tags.length > 0 ? `標籤: ${article.tags.join(', ')}` : '',
    `摘要: ${article.summary}`,
    `內容: ${article.content}`,
  ].filter(Boolean);

  const combined = parts.join('\n');
  // BGE-M3 supports up to 8192 tokens; truncate to ~4000 chars for safety
  return combined.slice(0, 4000);
}

// ─── Similarity Search ──────────────────────────────────────────────────────

export async function searchSimilarArticles(
  prisma: PrismaClient,
  queryEmbedding: number[],
  tenantId: string,
  options: SearchOptions = {},
): Promise<ArticleSearchResult[]> {
  const { topK = 5, threshold = 0.3 } = options;

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
  prisma: PrismaClient,
  articleId: string,
): Promise<void> {
  const article = await prisma.kmArticle.findUnique({
    where: { id: articleId },
    select: { title: true, category: true, tags: true, summary: true, content: true },
  });

  if (!article) {
    throw new Error(`Article ${articleId} not found`);
  }

  const text = prepareArticleText(article);
  const embedding = await generateEmbedding(text);
  const vectorStr = `[${embedding.join(',')}]`;
  const config = getConfig();

  await prisma.$executeRawUnsafe(
    `UPDATE km_articles SET embedding = $1::vector, "embeddingModel" = $2 WHERE id = $3::uuid`,
    vectorStr,
    config.OLLAMA_EMBED_MODEL,
    articleId,
  );
}

// ─── Bulk Re-embed ──────────────────────────────────────────────────────────

export async function bulkReembed(
  prisma: PrismaClient,
  tenantId: string,
): Promise<{ total: number; succeeded: number; failed: number }> {
  const articles = await prisma.kmArticle.findMany({
    where: { tenantId, status: 'PUBLISHED' },
    select: { id: true, title: true, category: true, tags: true, summary: true, content: true },
  });

  let succeeded = 0;
  let failed = 0;
  const config = getConfig();

  for (const article of articles) {
    try {
      const text = prepareArticleText(article);
      const embedding = await generateEmbedding(text);
      const vectorStr = `[${embedding.join(',')}]`;

      await prisma.$executeRawUnsafe(
        `UPDATE km_articles SET embedding = $1::vector, "embeddingModel" = $2 WHERE id = $3::uuid`,
        vectorStr,
        config.OLLAMA_EMBED_MODEL,
        article.id,
      );
      succeeded++;
    } catch (err) {
      console.error(`[Embedding] Failed to embed article ${article.id}:`, err);
      failed++;
    }
  }

  return { total: articles.length, succeeded, failed };
}

// ─── Health Check ───────────────────────────────────────────────────────────

export async function checkOllamaHealth(): Promise<{
  ok: boolean;
  model?: string;
  error?: string;
}> {
  const config = getConfig();

  try {
    const response = await fetch(`${config.OLLAMA_BASE_URL}/api/tags`);
    if (!response.ok) {
      return { ok: false, error: `Ollama returned ${response.status}` };
    }

    const data = (await response.json()) as {
      models?: { name: string }[];
    };

    const models = data.models || [];
    const found = models.find(
      (m) => m.name === config.OLLAMA_EMBED_MODEL || m.name.startsWith(`${config.OLLAMA_EMBED_MODEL}:`),
    );

    if (!found) {
      return {
        ok: false,
        error: `Model "${config.OLLAMA_EMBED_MODEL}" not found. Available: ${models.map((m) => m.name).join(', ') || 'none'}`,
      };
    }

    return { ok: true, model: found.name };
  } catch (err) {
    return { ok: false, error: `Cannot reach Ollama: ${(err as Error).message}` };
  }
}
