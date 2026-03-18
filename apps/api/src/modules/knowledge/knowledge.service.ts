import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';
import {
  embedArticle,
  generateEmbedding,
  searchSimilarArticles,
  bulkReembed as bulkReembedArticles,
  checkOllamaHealth,
} from '../embedding/embedding.service.js';

// --- Article CRUD ---

export async function listArticles(
  prisma: PrismaClient,
  tenantId: string,
  filters: {
    status?: string;
    category?: string;
    q?: string;
    page?: number;
    limit?: number;
  } = {},
) {
  const { status, category, q, page = 1, limit = 50 } = filters;

  const where: Record<string, unknown> = { tenantId };
  if (status) where.status = status;
  if (category) where.category = category;
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { summary: { contains: q, mode: 'insensitive' } },
      { content: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [articles, total] = await Promise.all([
    prisma.kmArticle.findMany({
      where: where as any,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        tenantId: true,
        title: true,
        summary: true,
        category: true,
        tags: true,
        status: true,
        viewCount: true,
        helpfulCount: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.kmArticle.count({ where: where as any }),
  ]);

  // Supplement with embedding status via raw SQL
  if (articles.length > 0) {
    const ids = articles.map((a) => a.id);
    const embeddingStatus = await prisma.$queryRawUnsafe<{ id: string; has_embedding: boolean }[]>(
      `SELECT id, (embedding IS NOT NULL) AS has_embedding FROM km_articles WHERE id = ANY($1::text[]::uuid[])`,
      ids,
    );
    const statusMap = new Map(embeddingStatus.map((r) => [r.id, r.has_embedding]));
    const enriched = articles.map((a) => ({
      ...a,
      hasEmbedding: statusMap.get(a.id) ?? false,
    }));
    return { articles: enriched, total, page, limit };
  }

  return { articles, total, page, limit };
}

export async function getArticle(prisma: PrismaClient, id: string, tenantId: string) {
  const article = await prisma.kmArticle.findFirst({
    where: { id, tenantId },
  });

  if (!article) {
    throw new AppError('Article not found', 'NOT_FOUND', 404);
  }

  // Increment view count
  await prisma.kmArticle.update({
    where: { id },
    data: { viewCount: { increment: 1 } },
  });

  return { ...article, viewCount: article.viewCount + 1 };
}

export async function createArticle(
  prisma: PrismaClient,
  tenantId: string,
  agentId: string,
  data: {
    title: string;
    content: string;
    summary?: string;
    category?: string;
    tags?: string[];
  },
) {
  const article = await prisma.kmArticle.create({
    data: {
      tenantId,
      createdById: agentId,
      title: data.title,
      content: data.content,
      summary: data.summary || '',
      category: data.category || '一般',
      tags: data.tags || [],
      status: 'DRAFT',
    },
  });

  // Fire-and-forget embedding generation
  embedArticle(prisma, article.id).catch((err) => {
    console.error(`[Knowledge] Failed to embed new article ${article.id}:`, err);
  });

  return article;
}

export async function updateArticle(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
  data: {
    title?: string;
    content?: string;
    summary?: string;
    category?: string;
    tags?: string[];
  },
) {
  const article = await prisma.kmArticle.findFirst({
    where: { id, tenantId },
  });

  if (!article) {
    throw new AppError('Article not found', 'NOT_FOUND', 404);
  }

  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.content !== undefined) updateData.content = data.content;
  if (data.summary !== undefined) updateData.summary = data.summary;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.tags !== undefined) updateData.tags = data.tags;

  const updated = await prisma.kmArticle.update({
    where: { id },
    data: updateData,
  });

  // Re-embed if title, content, or summary changed
  if (data.title !== undefined || data.content !== undefined || data.summary !== undefined) {
    embedArticle(prisma, id).catch((err) => {
      console.error(`[Knowledge] Failed to re-embed article ${id}:`, err);
    });
  }

  return updated;
}

export async function deleteArticle(prisma: PrismaClient, id: string, tenantId: string) {
  const article = await prisma.kmArticle.findFirst({
    where: { id, tenantId },
  });

  if (!article) {
    throw new AppError('Article not found', 'NOT_FOUND', 404);
  }

  await prisma.kmArticle.delete({ where: { id } });

  return { deleted: true };
}

export async function publishArticle(prisma: PrismaClient, id: string, tenantId: string) {
  const article = await prisma.kmArticle.findFirst({
    where: { id, tenantId },
  });

  if (!article) {
    throw new AppError('Article not found', 'NOT_FOUND', 404);
  }

  if (article.status === 'PUBLISHED') {
    throw new AppError('Article is already published', 'INVALID_STATE', 400);
  }

  // Ensure embedding exists before publishing; generate if missing
  const [embCheck] = await prisma.$queryRawUnsafe<{ has: boolean }[]>(
    `SELECT (embedding IS NOT NULL) AS has FROM km_articles WHERE id = $1::uuid`,
    id,
  );
  if (!embCheck?.has) {
    try {
      await embedArticle(prisma, id);
    } catch (err) {
      console.error(`[Knowledge] Could not generate embedding for publish (${id}):`, err);
      // Continue publishing even if embedding fails — not a blocker for POC
    }
  }

  const updated = await prisma.kmArticle.update({
    where: { id },
    data: { status: 'PUBLISHED' },
  });

  return updated;
}

export async function archiveArticle(prisma: PrismaClient, id: string, tenantId: string) {
  const article = await prisma.kmArticle.findFirst({
    where: { id, tenantId },
  });

  if (!article) {
    throw new AppError('Article not found', 'NOT_FOUND', 404);
  }

  if (article.status === 'ARCHIVED') {
    throw new AppError('Article is already archived', 'INVALID_STATE', 400);
  }

  const updated = await prisma.kmArticle.update({
    where: { id },
    data: { status: 'ARCHIVED' },
  });

  return updated;
}

export async function listCategories(prisma: PrismaClient, tenantId: string) {
  const results = await prisma.kmArticle.findMany({
    where: { tenantId },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });

  return results.map((r) => r.category);
}

// ─── Semantic Search ────────────────────────────────────────────────────────

export async function semanticSearch(
  prisma: PrismaClient,
  tenantId: string,
  query: string,
  options: { topK?: number; threshold?: number } = {},
) {
  const queryEmbedding = await generateEmbedding(query);
  const results = await searchSimilarArticles(prisma, queryEmbedding, tenantId, options);
  return results;
}

// ─── Batch Import ───────────────────────────────────────────────────────────

export async function batchImportArticles(
  prisma: PrismaClient,
  tenantId: string,
  agentId: string,
  articles: {
    title: string;
    content: string;
    summary?: string;
    category?: string;
    tags?: string[];
    status?: string;
  }[],
): Promise<{ imported: number; failed: number; errors: string[] }> {
  let imported = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const data of articles) {
    try {
      const article = await prisma.kmArticle.create({
        data: {
          tenantId,
          createdById: agentId,
          title: data.title,
          content: data.content,
          summary: data.summary || '',
          category: data.category || '一般',
          tags: data.tags || [],
          status: (data.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT') as any,
        },
      });

      // Fire-and-forget embedding
      embedArticle(prisma, article.id).catch((err) => {
        console.error(`[Knowledge] Import embed failed for ${article.id}:`, err);
      });

      imported++;
    } catch (err) {
      failed++;
      errors.push(`"${data.title}": ${(err as Error).message}`);
    }
  }

  return { imported, failed, errors };
}

// ─── Re-exports for routes ──────────────────────────────────────────────────

export { bulkReembedArticles as bulkReembed };
export { checkOllamaHealth, embedArticle };
