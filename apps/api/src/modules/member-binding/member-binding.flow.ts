/**
 * 會員綁定的入口：讀設定（交易）→ 查詢外部會員系統（交易外，最多一次）→ 寫入綁定（交易）。
 * 交易由這裡以 inTenant() 開；service 只收 TenantCtx（AGENTS.md 結構規則 2）。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { inTenant } from '../../lib/tenant-ctx.js';
import { createOutboxPublisher } from '../../events/outbox-publisher.js';
import { getBindingConfig, writeBinding } from './member-binding.service.js';
import { lookupMember } from './member-lookup.service.js';
import type { BindingResult, MemberLookupInput } from './member-binding.types.js';

export interface MemberBindingFlowDeps {
  prisma: PrismaClient;
  io?: Server;
}

/** 綁定會員：外部查詢不放在交易內，避免佔住連線與超過 5 秒的交易時限 */
export async function bindMember(
  deps: MemberBindingFlowDeps,
  tenantId: string,
  contactId: string,
  input: MemberLookupInput,
): Promise<BindingResult> {
  const tenantDeps = { prisma: deps.prisma, io: deps.io, events: createOutboxPublisher(deps.prisma) };
  const config = await inTenant(tenantDeps, tenantId, (ctx) => getBindingConfig(ctx));
  if (!config?.enabled) return { ok: false, reason: 'NOT_CONFIGURED' };

  const lookup = await lookupMember(config, input);
  if (!lookup.ok) return lookup;

  return inTenant(tenantDeps, tenantId, (ctx) => writeBinding(ctx, config, contactId, lookup));
}
