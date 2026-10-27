/**
 * 會員綁定的 flow：後台與顧客端讀寫租戶資料的 route 都經過這裡（AGENTS.md 結構規則 2）。
 * 綁定：讀設定（交易）→ 查詢外部會員系統（交易外，最多一次）→ 寫入綁定（交易）。
 * 交易由這裡以 inTenant() 開；service 只收 TenantCtx。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { inTenant } from '../../lib/tenant-ctx.js';
import { getBinding, getBindingConfig, saveBindingConfig, unbindMember, writeBinding } from './member-binding.service.js';
import { lookupMember } from './member-lookup.service.js';
import type { BindingResult, MemberBindingConfig, MemberLookupInput } from './member-binding.types.js';

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
  const config = await inTenant(deps.prisma, tenantId, (ctx) => getBindingConfig(ctx));
  if (!config?.enabled) return { ok: false, reason: 'NOT_CONFIGURED' };

  const lookup = await lookupMember(config, input);
  if (!lookup.ok) return lookup;

  return inTenant(deps.prisma, tenantId, (ctx) => writeBinding(ctx, config, contactId, lookup));
}

export function getBindingConfigFlow(deps: MemberBindingFlowDeps, tenantId: string) {
  return inTenant(deps.prisma, tenantId, (scope) => getBindingConfig(scope));
}

/**
 * 儲存設定。沒有重填憑證時沿用既有值：前端拿到的是遮蔽後的字串，直接存會把金鑰覆蓋成 ••••。
 * 讀既有設定與儲存在同一個交易。
 */
export function saveBindingConfigFlow(deps: MemberBindingFlowDeps, tenantId: string, body: MemberBindingConfig) {
  return inTenant(deps.prisma, tenantId, async (scope) => {
    const existing = await getBindingConfig(scope);
    const credential =
      body.auth?.credential && !body.auth.credential.startsWith('••') ? body.auth.credential : existing?.auth?.credential;
    await saveBindingConfig(scope, { ...body, auth: { ...body.auth, credential } });
  });
}

export function getBindingFlow(deps: MemberBindingFlowDeps, tenantId: string, contactId: string) {
  return inTenant(deps.prisma, tenantId, (scope) => getBinding(scope, contactId));
}

export function unbindMemberFlow(deps: MemberBindingFlowDeps, tenantId: string, contactId: string) {
  return inTenant(deps.prisma, tenantId, (scope) => unbindMember(scope, contactId));
}
