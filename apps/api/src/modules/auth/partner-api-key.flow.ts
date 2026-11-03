/**
 * Partner API 金鑰的管理（#337 階段 3 第九批，AGENTS.md 結構規則 2）。
 *
 * 建立時先在交易外產生金鑰並以 bcrypt 雜湊，再開交易寫入，交易不等 bcrypt。
 * 稽核與金鑰在同一個交易寫入（主規格 tenant-audit-log）：稽核寫入失敗時，金鑰一起 rollback。
 * 驗證金鑰（verifyPartnerApiKey）在綁定租戶之前執行，由 auth.plugin 以 prismaAdmin 呼叫，不經過這裡。
 */
import type { PrismaClient } from '@prisma/client';
import { flowOf, inTenant } from '../../lib/tenant-ctx.js';
import type { RequestActor } from '../../lib/request-actor.js';
import { recordTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import {
  createPartnerApiKey,
  generatePartnerApiKey,
  listPartnerApiKeys,
  revokePartnerApiKey,
} from './partner-api-key.service.js';

export const listPartnerApiKeysFlow = flowOf(listPartnerApiKeys);

/** 金鑰不存在或屬於另一個租戶時，revokePartnerApiKey() 拋出 P2025（回 404），不會寫到稽核 */
export function revokePartnerApiKeyFlow(deps: { prisma: PrismaClient }, actor: RequestActor, id: string) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    await revokePartnerApiKey(scope, id);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'settings.update',
      targetType: 'settings',
      payload: { section: 'api-keys', operation: 'revoke', apiKeyId: id },
      ip: actor.ip,
    });
  });
}

/** 回傳完整金鑰（只有這一次）與寫入的列 */
export async function createPartnerApiKeyFlow(
  deps: { prisma: PrismaClient },
  actor: RequestActor,
  input: { name: string; expiresAt: Date | null },
) {
  const key = await generatePartnerApiKey();
  const apiKey = await inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const created = await createPartnerApiKey(scope, {
      createdById: actor.agentId,
      name: input.name,
      expiresAt: input.expiresAt,
      key,
    });
    // 不記金鑰的明文與雜湊
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'settings.update',
      targetType: 'settings',
      payload: {
        section: 'api-keys',
        operation: 'create',
        apiKeyId: created.id,
        name: created.name,
        expiresAt: created.expiresAt?.toISOString() ?? null,
      },
      ip: actor.ip,
    });
    return created;
  });
  return { key: key.rawKey, apiKey };
}
