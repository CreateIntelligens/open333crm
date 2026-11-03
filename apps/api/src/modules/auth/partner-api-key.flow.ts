/**
 * Partner API 金鑰的管理（#337 階段 3 第九批，AGENTS.md 結構規則 2）。
 *
 * 建立時先在交易外產生金鑰並以 bcrypt 雜湊，再開交易寫入，交易不等 bcrypt。
 * 驗證金鑰（verifyPartnerApiKey）在綁定租戶之前執行，由 auth.plugin 以 prismaAdmin 呼叫，不經過這裡。
 */
import type { PrismaClient } from '@prisma/client';
import { flowOf, inTenant } from '../../lib/tenant-ctx.js';
import type { RequestActor } from '../../lib/request-actor.js';
import {
  createPartnerApiKey,
  generatePartnerApiKey,
  listPartnerApiKeys,
  revokePartnerApiKey,
} from './partner-api-key.service.js';

export const listPartnerApiKeysFlow = flowOf(listPartnerApiKeys);
export const revokePartnerApiKeyFlow = flowOf(revokePartnerApiKey);

/** 回傳完整金鑰（只有這一次）與寫入的列 */
export async function createPartnerApiKeyFlow(
  deps: { prisma: PrismaClient },
  actor: RequestActor,
  input: { name: string; expiresAt: Date | null },
) {
  const key = await generatePartnerApiKey();
  const apiKey = await inTenant(deps.prisma, actor.tenantId, (scope) =>
    createPartnerApiKey(scope, { createdById: actor.agentId, name: input.name, expiresAt: input.expiresAt, key }),
  );
  return { key: key.rawKey, apiKey };
}
