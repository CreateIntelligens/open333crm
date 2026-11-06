/**
 * 知識庫的 flow（change migrate-knowledge-tenant-ctx）。
 *
 * 寫入文章的 flow 在 commit 之後開始向量化（design D2）。需要外部呼叫的讀取在交易外（D6）。
 */
import type { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { flowOf, inTenant } from '../../lib/tenant-ctx.js';
import { tenantScopedClient } from '../../lib/tenant-db.js';
import {
  bulkReembed,
  checkOllamaHealth,
  generateEmbedding,
  searchSimilarArticles,
} from '../embedding/embedding.service.js';
import { getKnownModelKeys, refreshModelKeys } from '../ai/model-registry.service.js';
import { assertUploadContent } from '../upload/upload-validation.js';
import { UPLOAD_POLICIES } from '../upload/upload-content-detector.js';
import { AppError } from '../../shared/utils/response.js';
import { removeFilesAfterCommit, removeFilesNow, startEmbedAfterCommit, type KnowledgeEffects } from './knowledge-effects.js';
import {
  archivePartnerDoc,
  decidePartnerWrite,
  findPartnerDoc,
  writePartnerArticle,
  type PartnerDocInput,
  type PartnerIngestResult,
  type UploadedAttachment,
} from './partner-ingest.service.js';
import {
  archiveArticle,
  assertArticleExists,
  countPublishedArticles,
  createArticle,
  deleteArticle,
  getArticle,
  listArticles,
  listCategories,
  listSources,
  publishArticle,
  updateArticle,
  type ArticleInput,
} from './knowledge.service.js';
import {
  getFeedbackCounts,
  listFeedback,
  recordKbFeedback,
  resolveFeedback,
  type RecordFeedbackInput,
} from './kb-feedback.service.js';

export interface KnowledgeDeps {
  prisma: PrismaClient;
  effects: KnowledgeEffects;
}

export interface KnowledgeActor {
  tenantId: string;
  agentId: string;
}

// ── 查詢 ────────────────────────────────────────────────────────────────

export const listArticlesFlow = flowOf(listArticles);
export const getArticleFlow = flowOf(getArticle);
export const listCategoriesFlow = flowOf(listCategories);
export const listSourcesFlow = flowOf(listSources);
export const archiveArticleFlow = flowOf(archiveArticle);

export const listFeedbackFlow = flowOf(listFeedback);
export const getFeedbackCountsFlow = flowOf(getFeedbackCounts);
export const resolveFeedbackFlow = flowOf(resolveFeedback);

/** webhook 收訊記錄回報（design D7）。webhook 傳入 prismaAdmin，寫法同 addTagToTargetFlow() */
export const recordKbFeedbackFlow = flowOf((ctx, input: RecordFeedbackInput) => recordKbFeedback(ctx, input));

/** 型號白名單：ai/model-registry.service.ts 只讀資料庫，傳 scope.tx（design D6） */
export function listKnownModelsFlow(deps: { prisma: PrismaClient }, tenantId: string) {
  return inTenant(deps.prisma, tenantId, (scope) => getKnownModelKeys(scope.tx, tenantId, Date.now()));
}

export function refreshKnownModelsFlow(deps: { prisma: PrismaClient }, tenantId: string) {
  return inTenant(deps.prisma, tenantId, (scope) => refreshModelKeys(scope.tx, tenantId, Date.now()));
}

// ── 寫入文章 ────────────────────────────────────────────────────────────

export function createArticleFlow(deps: KnowledgeDeps, actor: KnowledgeActor, data: ArticleInput) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const article = await createArticle(scope, actor.agentId, data);
    startEmbedAfterCommit(scope, deps.effects.embed, article.id);
    return article;
  });
}

export function updateArticleFlow(deps: KnowledgeDeps, tenantId: string, id: string, data: Partial<ArticleInput>) {
  return inTenant(deps.prisma, tenantId, async (scope) => {
    const { article, needsEmbedding } = await updateArticle(scope, id, data);
    if (needsEmbedding) startEmbedAfterCommit(scope, deps.effects.embed, id);
    return article;
  });
}

export function deleteArticleFlow(deps: KnowledgeDeps, tenantId: string, id: string) {
  return inTenant(deps.prisma, tenantId, async (scope) => {
    const { deleted, removedKeys } = await deleteArticle(scope, id);
    removeFilesAfterCommit(scope, deps.effects.storage.remove, removedKeys);
    return { deleted };
  });
}

export function publishArticleFlow(deps: KnowledgeDeps, tenantId: string, id: string) {
  return inTenant(deps.prisma, tenantId, async (scope) => {
    const { article, needsEmbedding } = await publishArticle(scope, id);
    if (needsEmbedding) startEmbedAfterCommit(scope, deps.effects.embed, id);
    return article;
  });
}

/**
 * 批次匯入：每篇各自一個交易，一篇失敗不影響其他篇（design D5）。
 * 同一個交易內接住錯誤再繼續寫不行：PostgreSQL 在第一個錯誤之後拒絕這個交易的所有查詢。
 */
export async function importArticlesFlow(
  deps: KnowledgeDeps,
  actor: KnowledgeActor,
  articles: Array<ArticleInput & { status?: string }>,
): Promise<{ imported: number; failed: number; errors: string[] }> {
  let imported = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const data of articles) {
    try {
      await inTenant(deps.prisma, actor.tenantId, async (scope) => {
        const status = data.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT';
        const article = await createArticle(scope, actor.agentId, { ...data, status });
        startEmbedAfterCommit(scope, deps.effects.embed, article.id);
      });
      imported++;
    } catch (err) {
      failed++;
      errors.push(`"${data.title}": ${(err as Error).message}`);
    }
  }

  return { imported, failed, errors };
}

// ── 向量化與搜尋（交易外，design D6） ─────────────────────────────────────

/** 強制重新向量化一篇文章：先確認文章屬於本租戶，再在交易外等向量化完成 */
export async function embedArticleNowFlow(deps: KnowledgeDeps, tenantId: string, id: string): Promise<void> {
  await inTenant(deps.prisma, tenantId, (scope) => assertArticleExists(scope, id));
  await deps.effects.embed(tenantId, id);
}

/** 重新向量化所有已發布文章：回傳篇數，向量化在背景進行、不等結果（行為同搬遷前） */
export async function bulkEmbedFlow(deps: { prisma: PrismaClient }, tenantId: string): Promise<number> {
  const total = await inTenant(deps.prisma, tenantId, (scope) => countPublishedArticles(scope));
  bulkReembed(tenantScopedClient(deps.prisma, tenantId), tenantId).catch((err: unknown) => {
    logger.error('[Knowledge] Background bulk re-embed failed', err);
  });
  return total;
}

export async function semanticSearchFlow(
  deps: { prisma: PrismaClient },
  tenantId: string,
  query: string,
  options: { topK?: number; threshold?: number },
) {
  const db = tenantScopedClient(deps.prisma, tenantId);
  const queryEmbedding = await generateEmbedding(db, tenantId, query);
  return searchSimilarArticles(db, queryEmbedding, tenantId, options);
}

export function embeddingStatusFlow(deps: { prisma: PrismaClient }, tenantId: string) {
  return checkOllamaHealth(tenantScopedClient(deps.prisma, tenantId), tenantId);
}

// ── 合作方推送（design D4） ──────────────────────────────────────────────

/**
 * 交易外逐一偵測內容並上傳附件。單一附件失敗只略過，文章照樣寫入（spec「一個附件上傳失敗」）。
 * 之後的交易失敗時，這些檔案留在儲存服務（孤兒檔案，使用者 2026-11-06 決定）。
 */
async function uploadPartnerAttachments(
  storage: KnowledgeEffects['storage'],
  tenantId: string,
  input: PartnerDocInput,
): Promise<UploadedAttachment[]> {
  if (!input.isAttached || input.attachments.length === 0) return [];
  const uploaded: UploadedAttachment[] = [];
  for (const att of input.attachments) {
    try {
      const detected = await assertUploadContent(
        { buffer: att.buffer, filename: att.filename, clientMime: att.mimeType },
        UPLOAD_POLICIES.partnerAttachment,
      );
      const mimeType = detected.detectedMime ?? att.mimeType;
      const { key, url } = await storage.upload(att.buffer, att.filename, mimeType, tenantId, 'media', `kb/${input.docId}`);
      uploaded.push({ filename: att.filename, storageKey: key, url, mimeType, sizeBytes: att.buffer.length });
    } catch (err) {
      logger.error(
        `[PartnerIngest] Failed to upload attachment "${att.filename}" for DocID ${input.docId}: ${(err as Error).message}`,
      );
    }
  }
  return uploaded;
}

/**
 * 交易 1 判斷結果 → 交易外上傳附件 → 交易 2 寫入文章與附件的資料列，commit 之後開始向量化。
 */
export async function ingestPartnerDocFlow(
  deps: KnowledgeDeps,
  actor: KnowledgeActor,
  input: PartnerDocInput,
): Promise<PartnerIngestResult> {
  if (!input.docId) throw new AppError('請提供文件識別碼', 'BAD_REQUEST', 400);

  const decided = await inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const existing = await findPartnerDoc(scope, input.docId);
    if (input.cmd === 'DELETE') return archivePartnerDoc(scope, input, existing);
    return decidePartnerWrite(input, existing);
  });
  if (decided) return decided;

  const attachments = await uploadPartnerAttachments(deps.effects.storage, actor.tenantId, input);
  const uploadedKeys = attachments.map((a) => a.storageKey);

  // 寫入都做完、只差 commit 時才設為 true。之後 commit 回錯誤時資料庫可能已經寫入，不能刪檔
  let commitPending = false;
  let written: { result: PartnerIngestResult; wrote: boolean };
  try {
    written = await inTenant(deps.prisma, actor.tenantId, async (scope) => {
      // 上傳期間另一個推送可能已經寫入：鎖住文章再讀一次，以同一個函式重新判斷，結果不同時以這次為準
      // （spec「上傳期間另一個推送寫入較新的版本」「兩個推送同時寫入同一篇文章」）
      const existing = await findPartnerDoc(scope, input.docId, { lock: true });
      const skipped = decidePartnerWrite(input, existing);
      if (skipped) return { result: skipped, wrote: false };
      const { result, removedKeys } = await writePartnerArticle(scope, actor.agentId, input, existing, attachments);
      removeFilesAfterCommit(scope, deps.effects.storage.remove, removedKeys);
      startEmbedAfterCommit(scope, deps.effects.embed, result.articleId);
      commitPending = true;
      return { result, wrote: true };
    });
  } catch (err) {
    if (commitPending) {
      logger.error(
        `[PartnerIngest] DocID ${input.docId} 寫入的交易 commit 結果不明，保留這次上傳的檔案（${uploadedKeys.join(', ')}）`,
        err,
      );
    } else {
      // 交易在寫入途中丟錯而 rollback，確定沒有寫入（spec「合作方推送沒有寫入時刪除這次上傳的檔案」）
      removeFilesNow(deps.effects.storage.remove, uploadedKeys);
    }
    throw err;
  }

  if (!written.wrote) removeFilesNow(deps.effects.storage.remove, uploadedKeys);
  return written.result;
}
