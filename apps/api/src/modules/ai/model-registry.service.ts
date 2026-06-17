/**
 * Model Registry — 動態維護「知識庫已知型號白名單」（per-tenant）。
 *
 * 設計（B 方案）：
 * - 白名單不寫死，而是即時掃 km_articles 標題抽出所有型號主鍵（前綴+第1段）。
 *   客服新增 KB 文章 → 下次快取刷新時自動納入，無需改程式或更版。
 * - 記憶體快取 + TTL：避免每則訊息都掃全表；TTL 到期才重抽。
 * - 提供 invalidate() 手動清快取，供「立即刷新」API 使用（新增文章後不想等 TTL）。
 *
 * 注意：此快取為單一 API process 的記憶體快取。多 process 部署時，各 process
 * 的快取獨立過期；手動刷新只清當前 process。以 TTL 為主、手動刷新為輔即可。
 */

import type { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { detectModels } from './model-matcher.js';

/** 白名單快取存活時間（毫秒）。預設 10 分鐘。 */
const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  /** 型號比對主鍵集合（如 TAC-11A、TAC-11KN…） */
  keys: Set<string>;
  /** 抽取自多少篇文章標題（log / 診斷用） */
  sourceCount: number;
  /** 此快取的到期時間戳（epoch ms） */
  expiresAt: number;
}

/** tenantId → 快取。 */
const cache = new Map<string, CacheEntry>();

/**
 * 取得指定租戶的型號白名單（主鍵集合）。
 * 快取有效則直接回；過期或不存在則重抽。
 *
 * @param now 目前時間戳（epoch ms）。由呼叫端傳入以利測試（沙箱禁用 Date.now）。
 */
export async function getKnownModelKeys(
  prisma: PrismaClient,
  tenantId: string,
  now: number,
): Promise<ReadonlySet<string>> {
  const cached = cache.get(tenantId);
  if (cached && cached.expiresAt > now) {
    return cached.keys;
  }
  return refreshModelKeys(prisma, tenantId, now);
}

/**
 * 強制重抽指定租戶的型號白名單並更新快取，回傳新的主鍵集合。
 * 供 getKnownModelKeys 內部用，也供「手動刷新」API 直接呼叫。
 */
export async function refreshModelKeys(
  prisma: PrismaClient,
  tenantId: string,
  now: number,
): Promise<ReadonlySet<string>> {
  const rows = await prisma.kmArticle.findMany({
    where: { tenantId, status: 'PUBLISHED' },
    select: { title: true },
  });

  const keys = new Set<string>();
  for (const row of rows) {
    for (const parsed of detectModels(row.title)) {
      keys.add(parsed.key);
    }
  }

  cache.set(tenantId, {
    keys,
    sourceCount: rows.length,
    expiresAt: now + CACHE_TTL_MS,
  });

  logger.info(
    `[ModelRegistry] tenant=${tenantId} refreshed: ${keys.size} models from ${rows.length} articles`,
  );
  return keys;
}

/**
 * 清除指定租戶的快取（不立即重抽）。下次 getKnownModelKeys 會重抽。
 * 適合掛在「KB 文章新增/發布」事件後，讓新型號儘快生效。
 */
export function invalidateModelCache(tenantId: string): void {
  cache.delete(tenantId);
  logger.info(`[ModelRegistry] tenant=${tenantId} cache invalidated`);
}
