/**
 * 向量化與相似度搜尋的資料存取（change migrate-embedding-tenant-ctx）。
 *
 * 這裡的函式都收 TenantCtx，只讀寫資料庫。呼叫向量化服務的是 embedding-client.ts，
 * 由 flow 在兩個交易之間呼叫（embedding.flow.ts，design D2）。
 */
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { getEmbeddingSettings, type EmbeddingSettings } from '../settings/embedding-settings.service.js';
import { readAiPrivacyPolicy, type AiPrivacyPolicy } from '../platform/ai-privacy.service.js';

export interface ArticleSearchResult {
  id: string;
  title: string;
  summary: string;
  content: string;
  category: string;
  tags: string[];
  similarity: number;
}

// ─── 向量化的輸入 ───────────────────────────────────────────────────────────

/** 向量化前要讀的設定與遮罩政策。一次處理只讀一次 */
export async function readEmbeddingInputs(
  ctx: TenantCtx,
): Promise<{ settings: EmbeddingSettings; policy: AiPrivacyPolicy }> {
  const settings = await getEmbeddingSettings(ctx);
  const policy = await readAiPrivacyPolicy(ctx.tx, ctx.tenantId);
  return { settings, policy };
}

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

// ─── 文章的向量 ─────────────────────────────────────────────────────────────

/** 向量化一篇文章的輸入：組成的文字與文章的狀態。寫入前以這兩者判斷文章有沒有被改過（design D2） */
export interface ArticleEmbeddingSource {
  text: string;
  status: string;
}

/** 讀一篇文章的向量化輸入。文章不存在或屬於另一個租戶時回 null */
export async function readArticleForEmbedding(
  ctx: TenantCtx,
  articleId: string,
): Promise<ArticleEmbeddingSource | null> {
  const article = await ctx.tx.kmArticle.findFirst({
    where: { id: articleId, tenantId: ctx.tenantId },
    select: {
      title: true,
      category: true,
      tags: true,
      summary: true,
      content: true,
      spec: true,
      status: true,
      attachments: { select: { filename: true } },
    },
  });
  if (!article) return null;
  return { text: prepareArticleText(article), status: article.status };
}

/**
 * 只在文章的向量化文字與狀態仍和 `source` 相同時寫入向量與模型名稱（design D2）。回傳是否寫入。
 *
 * 先以 `FOR UPDATE` 鎖住文章再重組文字：比對與寫入之間，其他交易改不了這篇文章。
 * 不比對 `updatedAt`：瀏覽次數這類不進向量化文字的欄位也會更新 `updatedAt`。
 */
export async function writeArticleEmbedding(
  ctx: TenantCtx,
  articleId: string,
  input: { vector: number[]; model: string; source: ArticleEmbeddingSource },
): Promise<boolean> {
  const locked = await ctx.tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM km_articles WHERE id = $1::uuid AND "tenantId" = $2::uuid FOR UPDATE`,
    articleId,
    ctx.tenantId,
  );
  if (locked.length === 0) return false;

  const current = await readArticleForEmbedding(ctx, articleId);
  if (!current || current.text !== input.source.text || current.status !== input.source.status) return false;

  await ctx.tx.$executeRawUnsafe(
    `UPDATE km_articles SET embedding = $1::vector, "embeddingModel" = $2 WHERE id = $3::uuid AND "tenantId" = $4::uuid`,
    `[${input.vector.join(',')}]`,
    input.model,
    articleId,
    ctx.tenantId,
  );
  return true;
}

/** 已發布文章的 id，供批次重新向量化逐篇處理 */
export async function listPublishedArticleIds(ctx: TenantCtx): Promise<string[]> {
  const rows = await ctx.tx.kmArticle.findMany({
    where: { tenantId: ctx.tenantId, status: 'PUBLISHED' },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// ─── 相似度搜尋 ─────────────────────────────────────────────────────────────

/** 依向量找本租戶已發布、相似度達門檻的文章。`topK`、`threshold` 由呼叫端從設定帶入（design D5） */
export async function searchSimilarArticles(
  ctx: TenantCtx,
  queryEmbedding: number[],
  options: { topK: number; threshold: number },
): Promise<ArticleSearchResult[]> {
  return ctx.tx.$queryRawUnsafe<ArticleSearchResult[]>(
    `SELECT id, title, summary, content, category, tags,
            1 - (embedding <=> $1::vector) AS similarity
     FROM km_articles
     WHERE "tenantId" = $2::uuid
       AND status = 'PUBLISHED'
       AND embedding IS NOT NULL
       AND 1 - (embedding <=> $1::vector) >= $3
     ORDER BY similarity DESC
     LIMIT $4`,
    `[${queryEmbedding.join(',')}]`,
    ctx.tenantId,
    options.threshold,
    options.topK,
  );
}
