/**
 * 知識庫文章 — 收 TenantCtx（change migrate-knowledge-tenant-ctx，AGENTS.md 結構規則 2）。
 *
 * 不呼叫向量化服務：寫入之後要不要向量化，以回傳值告訴 flow，由 flow 在 commit 之後開始（design D2）。
 */
import type { Prisma } from '@prisma/client';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { AppError } from '../../shared/utils/response.js';
import { notFound } from '../../shared/messages/resource.js';
import { escapeLikeKeyword } from '../../shared/utils/like-pattern.js';

export interface ArticleInput {
  title: string;
  content: string;
  summary?: string;
  category?: string;
  tags?: string[];
}

export interface ArticleListFilters {
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  category?: string;
  source?: string;
  tag?: string;
  q?: string;
  page: number;
  limit: number;
}

async function findArticleOrThrow(ctx: TenantCtx, id: string) {
  const article = await ctx.tx.kmArticle.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!article) throw new AppError(notFound('article'), 'NOT_FOUND', 404);
  return article;
}

// --- Article CRUD ---

export async function listArticles(ctx: TenantCtx, filters: ArticleListFilters) {
  const { status, category, source, tag, q, page, limit } = filters;

  const where: Prisma.KmArticleWhereInput = { tenantId: ctx.tenantId };
  if (status) where.status = status;
  if (category) where.category = category;
  if (tag) where.tags = { has: tag };
  // source: '__manual__' 代表手動建立（externalSource 為空），其餘為精確比對
  if (source) where.externalSource = source === '__manual__' ? null : source;
  if (q) {
    // % 與 _ 當成一般文字（escapeLikeKeyword，#467）
    const keyword = escapeLikeKeyword(q);
    where.OR = [
      { title: { contains: keyword, mode: 'insensitive' } },
      { summary: { contains: keyword, mode: 'insensitive' } },
      { content: { contains: keyword, mode: 'insensitive' } },
      // tag 為陣列元素精確比對（輸入完整 tag 名稱才會命中）
      { tags: { has: q } },
    ];
  }

  const [articles, total] = await Promise.all([
    ctx.tx.kmArticle.findMany({
      where,
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
        externalDocId: true,
        externalVer: true,
        externalSource: true,
        _count: { select: { attachments: true } },
      },
    }),
    ctx.tx.kmArticle.count({ where }),
  ]);

  if (articles.length === 0) return { articles, total, page, limit };

  // embedding 是 Unsupported 欄位，Prisma 讀不到，以 SQL 補上有沒有向量
  const embeddingStatus = await ctx.tx.$queryRawUnsafe<{ id: string; has_embedding: boolean }[]>(
    `SELECT id, (embedding IS NOT NULL) AS has_embedding FROM km_articles WHERE id = ANY($1::text[]::uuid[]) AND "tenantId" = $2::uuid`,
    articles.map((a) => a.id),
    ctx.tenantId,
  );
  const statusMap = new Map(embeddingStatus.map((r) => [r.id, r.has_embedding]));
  return {
    articles: articles.map((a) => ({ ...a, hasEmbedding: statusMap.get(a.id) ?? false })),
    total,
    page,
    limit,
  };
}

export async function getArticle(ctx: TenantCtx, id: string) {
  const article = await ctx.tx.kmArticle.findFirst({
    where: { id, tenantId: ctx.tenantId },
    include: {
      attachments: {
        select: { id: true, filename: true, url: true, mimeType: true, sizeBytes: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!article) throw new AppError(notFound('article'), 'NOT_FOUND', 404);

  await ctx.tx.kmArticle.update({ where: { id }, data: { viewCount: { increment: 1 } } });
  return { ...article, viewCount: article.viewCount + 1 };
}

/** 建立一篇文章，沒給 status 時是 DRAFT。要不要直接發布由 flow 決定：只有批次匯入傳 PUBLISHED */
export async function createArticle(
  ctx: TenantCtx,
  agentId: string,
  data: ArticleInput & { status?: 'DRAFT' | 'PUBLISHED' },
) {
  return ctx.tx.kmArticle.create({
    data: {
      tenantId: ctx.tenantId,
      createdById: agentId,
      title: data.title,
      content: data.content,
      summary: data.summary || '',
      category: data.category || '一般',
      tags: data.tags || [],
      status: data.status ?? 'DRAFT',
    },
  });
}

/** 修改文章。標題、內容或摘要有改時 needsEmbedding 是 true */
export async function updateArticle(ctx: TenantCtx, id: string, data: Partial<ArticleInput>) {
  await findArticleOrThrow(ctx, id);

  const updateData: Prisma.KmArticleUpdateInput = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.content !== undefined) updateData.content = data.content;
  if (data.summary !== undefined) updateData.summary = data.summary;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.tags !== undefined) updateData.tags = data.tags;

  const article = await ctx.tx.kmArticle.update({ where: { id }, data: updateData });
  const needsEmbedding = data.title !== undefined || data.content !== undefined || data.summary !== undefined;
  return { article, needsEmbedding };
}

/** 刪除文章，附件資料列跟著 cascade 刪除。removedKeys 是這些附件的檔案，由 flow 在 commit 之後刪除 */
export async function deleteArticle(ctx: TenantCtx, id: string) {
  await findArticleOrThrow(ctx, id);
  const attachments = await ctx.tx.kmArticleAttachment.findMany({ where: { articleId: id }, select: { storageKey: true } });
  await ctx.tx.kmArticle.delete({ where: { id } });
  return { deleted: true as const, removedKeys: attachments.map((a) => a.storageKey) };
}

/** 發布文章。文章還沒有向量時 needsEmbedding 是 true */
export async function publishArticle(ctx: TenantCtx, id: string) {
  const current = await findArticleOrThrow(ctx, id);
  if (current.status === 'PUBLISHED') throw new AppError('此文章已發布', 'INVALID_STATE', 400);

  const article = await ctx.tx.kmArticle.update({ where: { id }, data: { status: 'PUBLISHED' } });
  const [embCheck] = await ctx.tx.$queryRawUnsafe<{ has: boolean }[]>(
    `SELECT (embedding IS NOT NULL) AS has FROM km_articles WHERE id = $1::uuid`,
    id,
  );
  return { article, needsEmbedding: !embCheck?.has };
}

export async function archiveArticle(ctx: TenantCtx, id: string) {
  const current = await findArticleOrThrow(ctx, id);
  if (current.status === 'ARCHIVED') throw new AppError('此文章已封存', 'INVALID_STATE', 400);
  return ctx.tx.kmArticle.update({ where: { id }, data: { status: 'ARCHIVED' } });
}

/** 重新向量化之前確認文章屬於本租戶（spec「重新向量化不存在或另一個租戶的文章」） */
export async function assertArticleExists(ctx: TenantCtx, id: string): Promise<void> {
  await findArticleOrThrow(ctx, id);
}

export async function countPublishedArticles(ctx: TenantCtx): Promise<number> {
  return ctx.tx.kmArticle.count({ where: { tenantId: ctx.tenantId, status: 'PUBLISHED' } });
}

export async function listCategories(ctx: TenantCtx) {
  const results = await ctx.tx.kmArticle.findMany({
    where: { tenantId: ctx.tenantId },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });
  return results.map((r) => r.category);
}

export async function listSources(ctx: TenantCtx) {
  const results = await ctx.tx.kmArticle.findMany({
    where: { tenantId: ctx.tenantId, externalSource: { not: null } },
    select: { externalSource: true },
    distinct: ['externalSource'],
    orderBy: { externalSource: 'asc' },
  });
  return results.map((r) => r.externalSource).filter(Boolean) as string[];
}
