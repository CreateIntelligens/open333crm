/**
 * 知識庫的副作用（change migrate-knowledge-tenant-ctx，design D1、D2、D3）。
 *
 * 向量化與儲存服務以參數注入 flow：路由傳入實際的實作，測試傳入記錄呼叫的假函式。
 */
import type { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import type { TenantScope } from '../../lib/tenant-ctx.js';
import { tenantScopedClient } from '../../lib/tenant-db.js';
import { embedArticle } from '../embedding/embedding.service.js';
import { deleteFile, uploadFile } from '../storage/storage.service.js';

export type EmbedArticle = (tenantId: string, articleId: string) => Promise<void>;
export type UploadFile = typeof uploadFile;
export type RemoveFile = (key: string) => Promise<void>;

export interface KnowledgeEffects {
  embed: EmbedArticle;
  storage: { upload: UploadFile; remove: RemoveFile };
}

/**
 * 實際的實作。embedArticle() 還沒搬（收舊的 client 型別），而且要在交易外呼叫向量化服務，所以以 tenantScopedClient() 呼叫
 * （同 coupon-claim.flow.ts 呼叫 deliverToChannel()）。embedding 模組搬遷時，這裡改成三段，flow 不變。
 */
export function createKnowledgeEffects(prisma: PrismaClient): KnowledgeEffects {
  return {
    embed: (tenantId, articleId) => embedArticle(tenantScopedClient(prisma, tenantId), articleId),
    storage: { upload: uploadFile, remove: deleteFile },
  };
}

/**
 * commit 之後開始向量化，最多一次；rollback 時不開始（spec km-ingestion）。
 *
 * 不等向量化完成：afterCommit 等這個函式結束，flow 才 return，等向量化服務會讓回應跟著變慢。
 * 處理程序在向量化完成之前結束時，文章沒有新的向量，由管理員重新向量化補上。
 */
export function startEmbedAfterCommit(scope: TenantScope, embed: EmbedArticle, articleId: string): void {
  scope.afterCommit('knowledge.embed', () => {
    embed(scope.tenantId, articleId).catch((err: unknown) => {
      logger.error(`[Knowledge] 文章向量化失敗（article ${articleId}）`, err);
    });
  });
}

/**
 * commit 之後從儲存服務刪除檔案，每個最多一次；rollback 時不刪（spec km-ingestion）。
 * 不等刪除完成：檔案是否刪除，呼叫端看不到。刪除失敗只記 log，檔案留在儲存服務。
 */
export function removeFilesAfterCommit(scope: TenantScope, remove: RemoveFile, keys: string[]): void {
  if (keys.length === 0) return;
  scope.afterCommit('knowledge.remove-files', () => {
    for (const key of keys) {
      remove(key).catch((err: unknown) => {
        logger.error(`[Knowledge] 刪除附件檔案失敗（key ${key}）`, err);
      });
    }
  });
}
