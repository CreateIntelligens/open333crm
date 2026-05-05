/**
 * Embedding Settings Service
 *
 * Manages tenant-scoped embedding configuration (Ollama base URL, model,
 * search topK/threshold). Replaces global env-based config so each tenant
 * can tune its own retrieval behavior.
 *
 * Vector dimension is locked at 1024 (matches schema.prisma vector(1024) +
 * existing pgvector indexes). Switching to a model with a different
 * dimension is unsupported and would corrupt existing embeddings.
 */

import type { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';

export interface EmbeddingSettings {
  baseUrl: string;
  model: string;
  topK: number;
  threshold: number;
}

export interface OllamaModel {
  name: string;
  size?: number;
  modified_at?: string;
}

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
  baseUrl: 'http://localhost:11434',
  model: 'bge-m3',
  topK: 5,
  threshold: 0.3,
};

// Vector dimension is hard-coded in the DB schema; keep this in sync if you
// ever migrate to a different size.
export const EMBEDDING_VECTOR_DIM = 1024;

// ─── Settings CRUD ──────────────────────────────────────────────────────────

export async function getEmbeddingSettings(
  prisma: PrismaClient,
  tenantId: string,
): Promise<EmbeddingSettings> {
  let settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });

  if (!settings) {
    settings = await prisma.tenantSettings.create({
      data: {
        tenantId,
        embeddingBaseUrl: DEFAULT_EMBEDDING_SETTINGS.baseUrl,
        embeddingModel: DEFAULT_EMBEDDING_SETTINGS.model,
        embeddingTopK: DEFAULT_EMBEDDING_SETTINGS.topK,
        embeddingThreshold: DEFAULT_EMBEDDING_SETTINGS.threshold,
      },
    });
  }

  return {
    baseUrl: settings.embeddingBaseUrl,
    model: settings.embeddingModel,
    topK: settings.embeddingTopK,
    threshold: settings.embeddingThreshold,
  };
}

export async function updateEmbeddingSettings(
  prisma: PrismaClient,
  tenantId: string,
  patch: Partial<EmbeddingSettings>,
): Promise<{ settings: EmbeddingSettings; modelChanged: boolean; previousModel: string }> {
  const current = await getEmbeddingSettings(prisma, tenantId);
  const next: EmbeddingSettings = { ...current, ...patch };
  const modelChanged = patch.model !== undefined && patch.model !== current.model;

  const updated = await prisma.tenantSettings.update({
    where: { tenantId },
    data: {
      embeddingBaseUrl: next.baseUrl,
      embeddingModel: next.model,
      embeddingTopK: next.topK,
      embeddingThreshold: next.threshold,
    },
  });

  return {
    settings: {
      baseUrl: updated.embeddingBaseUrl,
      model: updated.embeddingModel,
      topK: updated.embeddingTopK,
      threshold: updated.embeddingThreshold,
    },
    modelChanged,
    previousModel: current.model,
  };
}

// ─── Ollama Probing ─────────────────────────────────────────────────────────

export async function listOllamaModels(baseUrl: string): Promise<OllamaModel[]> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) return [];
    const data = (await response.json()) as { models?: OllamaModel[] };
    return data.models ?? [];
  } catch (err) {
    logger.warn(`[EmbeddingSettings] Failed to list Ollama models from ${baseUrl}: ${(err as Error).message}`);
    return [];
  }
}

export async function checkOllamaHealth(
  baseUrl: string,
  model: string,
): Promise<OllamaHealth> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) {
      return {
        ok: false,
        reachable: false,
        modelInstalled: false,
        currentModel: model,
        error: `Ollama responded ${response.status}`,
      };
    }

    const data = (await response.json()) as { models?: OllamaModel[] };
    const models = data.models ?? [];
    const installed = models.some((m) => m.name === model || m.name.startsWith(`${model}:`));

    return {
      ok: installed,
      reachable: true,
      modelInstalled: installed,
      currentModel: model,
      error: installed
        ? undefined
        : `Model "${model}" not installed. Available: ${models.map((m) => m.name).join(', ') || 'none'}`,
    };
  } catch (err) {
    return {
      ok: false,
      reachable: false,
      modelInstalled: false,
      currentModel: model,
      error: `Cannot reach Ollama at ${baseUrl}: ${(err as Error).message}`,
    };
  }
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export async function getEmbeddingStats(
  prisma: PrismaClient,
  tenantId: string,
): Promise<EmbeddingStats> {
  const total = await prisma.kmArticle.count({
    where: { tenantId, status: 'PUBLISHED' },
  });

  const embeddedRows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint AS count FROM km_articles
     WHERE "tenantId" = $1::uuid AND status = 'PUBLISHED' AND embedding IS NOT NULL`,
    tenantId,
  );
  const embedded = Number(embeddedRows[0]?.count ?? 0);

  return { total, embedded, missing: total - embedded };
}
