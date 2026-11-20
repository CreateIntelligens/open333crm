/**
 * Embedding Settings Service
 *
 * Manages tenant-scoped embedding configuration (Ollama base URL, model,
 * search topK/threshold). Replaces global env-based config so each tenant
 * can tune its own retrieval behavior.
 *
 * 只讀寫資料庫（change migrate-embedding-tenant-ctx，design D4）。健康檢查在 embedding-settings.flow.ts。
 *
 * Vector dimension is locked at 1024 (matches schema.prisma vector(1024) +
 * existing pgvector indexes). Switching to a model with a different
 * dimension is unsupported and would corrupt existing embeddings.
 */

import type { TenantCtx } from '../../lib/tenant-ctx.js';
import type { EmbeddingServiceModel } from '../embedding/embedding-client.js';
import { AppError } from '../../shared/utils/response.js';

/** 向量化服務。`gemini` 時模型固定是 `GEMINI_EMBEDDING_MODEL` */
export const EMBEDDING_PROVIDERS = ['ollama', 'gemini'] as const;
export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];
export const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';

export interface EmbeddingSettings {
  provider: EmbeddingProvider;
  baseUrl: string;
  model: string;
  topK: number;
  threshold: number;
}

export type OllamaModel = EmbeddingServiceModel;

export interface OllamaHealth {
  ok: boolean;
  reachable: boolean;
  modelInstalled: boolean;
  currentModel: string;
  error?: string;
}

export interface EmbeddingStats {
  total: number;
  embedded: number;
  missing: number;
}

export const DEFAULT_EMBEDDING_SETTINGS: EmbeddingSettings = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: 'bge-m3',
  topK: 5,
  threshold: 0.3,
};

// Vector dimension is hard-coded in the DB schema; keep this in sync if you
// ever migrate to a different size.
export const EMBEDDING_VECTOR_DIM = 1024;

// ─── Settings CRUD ──────────────────────────────────────────────────────────

function toProvider(value: string): EmbeddingProvider {
  return (EMBEDDING_PROVIDERS as readonly string[]).includes(value) ? (value as EmbeddingProvider) : 'ollama';
}

function toEmbeddingSettings(row: {
  embeddingProvider: string;
  embeddingBaseUrl: string;
  embeddingModel: string;
  embeddingTopK: number;
  embeddingThreshold: number;
}): EmbeddingSettings {
  return {
    provider: toProvider(row.embeddingProvider),
    baseUrl: row.embeddingBaseUrl,
    model: row.embeddingModel,
    topK: row.embeddingTopK,
    threshold: row.embeddingThreshold,
  };
}

/** 只讀：沒有設定列時回預設值，不建立設定列（spec embedding-settings「讀取向量化設定不寫入資料庫」） */
export async function getEmbeddingSettings(ctx: TenantCtx): Promise<EmbeddingSettings> {
  const row = await ctx.tx.tenantSettings.findUnique({ where: { tenantId: ctx.tenantId } });
  return row ? toEmbeddingSettings(row) : { ...DEFAULT_EMBEDDING_SETTINGS };
}

/** 寫入收到的欄位；沒有設定列時建立一列，沒有收到的欄位用預設值 */
export async function updateEmbeddingSettings(
  ctx: TenantCtx,
  patch: Partial<EmbeddingSettings>,
): Promise<{ settings: EmbeddingSettings; modelChanged: boolean; previousModel: string }> {
  const current = await getEmbeddingSettings(ctx);
  const merged = { ...current, ...patch };
  if (merged.provider === 'gemini' && merged.model !== GEMINI_EMBEDDING_MODEL) {
    throw new AppError(`Gemini 向量化只支援模型 ${GEMINI_EMBEDDING_MODEL}`, 'VALIDATION_ERROR', 400, {
      field: 'model',
    });
  }
  const data = {
    embeddingProvider: patch.provider,
    embeddingBaseUrl: patch.baseUrl,
    embeddingModel: patch.model,
    embeddingTopK: patch.topK,
    embeddingThreshold: patch.threshold,
  };
  const defaults = DEFAULT_EMBEDDING_SETTINGS;
  const updated = await ctx.tx.tenantSettings.upsert({
    where: { tenantId: ctx.tenantId },
    create: {
      tenantId: ctx.tenantId,
      embeddingProvider: patch.provider ?? defaults.provider,
      embeddingBaseUrl: patch.baseUrl ?? defaults.baseUrl,
      embeddingModel: patch.model ?? defaults.model,
      embeddingTopK: patch.topK ?? defaults.topK,
      embeddingThreshold: patch.threshold ?? defaults.threshold,
    },
    // undefined 的欄位 Prisma 不寫入
    update: data,
  });

  return {
    settings: toEmbeddingSettings(updated),
    modelChanged:
      (patch.model !== undefined && patch.model !== current.model) ||
      (patch.provider !== undefined && patch.provider !== current.provider),
    previousModel: current.model,
  };
}

// ─── Stats ──────────────────────────────────────────────────────────────────

/** 已向量化只計目前模型的向量：換服務或模型後，舊向量算成要重新向量化 */
export async function getEmbeddingStats(ctx: TenantCtx): Promise<EmbeddingStats> {
  const { model } = await getEmbeddingSettings(ctx);
  const total = await ctx.tx.kmArticle.count({
    where: { tenantId: ctx.tenantId, status: 'PUBLISHED' },
  });

  const embeddedRows = await ctx.tx.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint AS count FROM km_articles
     WHERE "tenantId" = $1::uuid AND status = 'PUBLISHED' AND embedding IS NOT NULL AND "embeddingModel" = $2`,
    ctx.tenantId,
    model,
  );
  const embedded = Number(embeddedRows[0]?.count ?? 0);

  return { total, embedded, missing: total - embedded };
}
