/**
 * 向量化設定的 flow（change migrate-embedding-tenant-ctx，design D1、D4）。
 *
 * 讀設定在交易內，呼叫向量化服務檢查健康狀態在交易外。修改設定時，設定與稽核在同一個交易寫入
 * （spec embedding-settings「修改向量化設定」）。
 */
import type { PrismaClient } from '@prisma/client';
import { inTenant } from '../../lib/tenant-ctx.js';
import type { RequestActor } from '../../lib/request-actor.js';
import { recordTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import { modelNotInstalledError, probeEmbeddingService } from '../embedding/embedding-client.js';
import {
  EMBEDDING_VECTOR_DIM,
  getEmbeddingSettings,
  getEmbeddingStats,
  updateEmbeddingSettings,
  type EmbeddingSettings,
  type OllamaHealth,
  type OllamaModel,
} from './embedding-settings.service.js';

/** 一次 `/api/tags` 同時得到健康狀態與模型清單。服務連不到時模型清單是空的 */
async function checkEmbeddingService(
  settings: Pick<EmbeddingSettings, 'baseUrl' | 'model'>,
): Promise<{ health: OllamaHealth; models: OllamaModel[] }> {
  const probe = await probeEmbeddingService(settings.baseUrl, settings.model);
  if (!probe.reachable) {
    return {
      health: { ok: false, reachable: false, modelInstalled: false, currentModel: settings.model, error: probe.error },
      models: [],
    };
  }
  const installed = probe.installed !== undefined;
  return {
    health: {
      ok: installed,
      reachable: true,
      modelInstalled: installed,
      currentModel: settings.model,
      error: installed ? undefined : modelNotInstalledError(settings.model, probe.models),
    },
    models: probe.models,
  };
}

/** `GET /settings/embedding`：設定、文章統計、健康狀態與模型清單 */
export async function getEmbeddingSettingsPageFlow(deps: { prisma: PrismaClient }, tenantId: string) {
  const { settings, stats } = await inTenant(deps.prisma, tenantId, async (scope) => ({
    settings: await getEmbeddingSettings(scope),
    stats: await getEmbeddingStats(scope),
  }));
  const { health, models } = await checkEmbeddingService(settings);
  return { settings, health, models, stats, vectorDim: EMBEDDING_VECTOR_DIM };
}

/** `POST /settings/embedding/health` */
export async function checkEmbeddingHealthFlow(deps: { prisma: PrismaClient }, tenantId: string): Promise<OllamaHealth> {
  const settings = await inTenant(deps.prisma, tenantId, (scope) => getEmbeddingSettings(scope));
  return (await checkEmbeddingService(settings)).health;
}

/** `PUT /settings/embedding`：稽核寫入失敗時，設定一起 rollback */
export function updateEmbeddingSettingsFlow(
  deps: { prisma: PrismaClient },
  actor: RequestActor,
  patch: Partial<EmbeddingSettings>,
) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const result = await updateEmbeddingSettings(scope, patch);
    // 只記變更的欄位名，不放 baseUrl 等值
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'settings.update',
      targetType: 'settings',
      payload: { section: 'embedding', keys: Object.keys(patch) },
      ip: actor.ip,
    });
    return result;
  });
}
