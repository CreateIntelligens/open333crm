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
import { modelNotInstalledError, probeEmbeddingService, type EmbeddingProbeTarget } from '../embedding/embedding-client.js';
import { readEmbeddingProbeTarget } from '../embedding/embedding.service.js';
import {
  EMBEDDING_VECTOR_DIM,
  getEmbeddingSettings,
  getEmbeddingStats,
  updateEmbeddingSettings,
  type EmbeddingSettings,
  type OllamaHealth,
  type OllamaModel,
} from './embedding-settings.service.js';

/** 一次檢查同時得到健康狀態與模型清單。服務連不到時模型清單是空的 */
async function checkEmbeddingService(
  target: EmbeddingProbeTarget,
): Promise<{ health: OllamaHealth; models: OllamaModel[] }> {
  const probe = await probeEmbeddingService(target);
  if (!probe.reachable) {
    return {
      health: { ok: false, reachable: false, modelInstalled: false, currentModel: target.model, error: probe.error },
      models: [],
    };
  }
  const installed = probe.installed !== undefined;
  return {
    health: {
      ok: installed,
      reachable: true,
      modelInstalled: installed,
      currentModel: target.model,
      error: installed ? undefined : modelNotInstalledError(target.model, probe.models),
    },
    models: probe.models,
  };
}

/** `GET /settings/embedding`：設定、文章統計、健康狀態與模型清單 */
export async function getEmbeddingSettingsPageFlow(deps: { prisma: PrismaClient }, tenantId: string) {
  const { settings, stats, target } = await inTenant(deps.prisma, tenantId, async (scope) => {
    const settings = await getEmbeddingSettings(scope);
    return { settings, stats: await getEmbeddingStats(scope), target: await readEmbeddingProbeTarget(scope, settings) };
  });
  const { health, models } = await checkEmbeddingService(target);
  return { settings, health, models, stats, vectorDim: EMBEDDING_VECTOR_DIM };
}

/** `POST /settings/embedding/health` */
export async function checkEmbeddingHealthFlow(deps: { prisma: PrismaClient }, tenantId: string): Promise<OllamaHealth> {
  const target = await inTenant(deps.prisma, tenantId, (scope) => readEmbeddingProbeTarget(scope));
  return (await checkEmbeddingService(target)).health;
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
