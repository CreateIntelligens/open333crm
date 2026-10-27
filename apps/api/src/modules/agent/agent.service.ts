import { ALL_CHANNELS, type ChannelAccessLevel, type ChannelGrantScope } from '../../services/channel-visibility.js';
import { insertAgentChannelAccess } from '../../services/channel-team-access.js';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { PERMISSIONS } from '@open333crm/core';
import { AppError } from '../../shared/utils/response.js';
import { verifyPassword } from '../../shared/utils/password.js';
import type { AgentRoleValue, CreateAgentInput } from './agent.schema.js';
import { getEffectiveLimit } from '../platform/plan-limits.service.js';
import { loadTenantRole } from '../role/role.service.js';
import { getEffectivePermissions } from '../../services/permission.service.js';
import { notFound } from '../../shared/messages/resource.js';

// 防自鎖的權限碼（registry 動態抽 selfLock:true，比照 role.service.setRolePermissions）：
// 含 role.manage。用於「自我降級」守門，避免寫死單一權限碼。
const SELF_LOCK_CODES = PERMISSIONS.filter((p) => p.selfLock).map((p) => p.code);
// module-load 斷言：registry 至少要有一個 selfLock 權限，否則下方自我降級守門會被
// `&& SELF_LOCK_CODES.length` 短路整段跳過而 fail-open。與 core registry 啟動驗證並存（縱深防禦）。
if (SELF_LOCK_CODES.length === 0) {
  throw new Error(
    'FATAL: registry 無任何 selfLock 權限 → 防自我降級守門將失效。請確保至少一個權限標記 selfLock:true（如 role.manage）。',
  );
}

// legacy enum role → system role slug（與 granular RBAC 雙寫的橋樑）
const ENUM_TO_SLUG: Record<string, string> = {
  ADMIN: 'admin',
  SUPERVISOR: 'supervisor',
  AGENT: 'agent',
};

// system role slug → legacy enum role（roleId 反解 legacy role 用）
const SLUG_TO_ENUM: Record<string, AgentRoleValue> = {
  admin: 'ADMIN',
  supervisor: 'SUPERVISOR',
  agent: 'AGENT',
};

/** 依 enum role 查該租戶對應 system role 的 roleId（雙寫用；查無回 null）。 */
async function resolveRoleId(
  ctx: TenantCtx,
  role: string,
): Promise<string | null> {
  const slug = ENUM_TO_SLUG[role];
  if (!slug) return null;
  const r = await ctx.tx.role.findFirst({
    where: { tenantId: ctx.tenantId, slug, isSystem: true },
    select: { id: true },
  });
  return r?.id ?? null;
}

/**
 * 指派角色前的越權防護：指派者(assigner)不可指派「權限高於自己有效權限」的角色。
 * 比對目標角色的權限集合與指派者角色的有效權限集合；若目標含指派者沒有的權限 → 丟 403。
 * admin system role 的指派者擁有全部權限，不受限。
 *
 * @param assignerRoleId 指派者自身角色 id（request.agent.roleId）
 * @param targetRoleId   欲指派給成員的目標角色 id（已驗證屬同租戶）
 */
async function assertNoRoleEscalation(
  ctx: TenantCtx,
  assignerRoleId: string | null | undefined,
  targetRoleId: string,
): Promise<void> {
  // 指派者若為該租戶 admin system role → 擁有全部權限，直接放行
  const assignerRole = assignerRoleId
    ? await ctx.tx.role.findFirst({
        where: { id: assignerRoleId, tenantId: ctx.tenantId },
        select: { slug: true, isSystem: true },
      })
    : null;
  if (assignerRole?.isSystem && assignerRole.slug === 'admin') return;

  const assignerEff = await getEffectivePermissions(ctx.tx, assignerRoleId);
  const targetEff = await getEffectivePermissions(ctx.tx, targetRoleId);
  const escalate = [...targetEff].filter((c) => !assignerEff.has(c));
  if (escalate.length) {
    throw new AppError(
      `無法指派權限高於自身的角色（超出的權限: ${escalate.join(', ')}）`,
      'ROLE_ESCALATION',
      403,
      { escalatedPermissions: escalate },
    );
  }
}

/**
 * 解析要寫入 agent 的 { role, roleId }。
 * - 提供 roleId：驗證屬同租戶（loadTenantRole 跨租戶丟 404）；legacy role 依角色 slug 反填
 *   （system role → 對應 enum；custom role → 沿用傳入的 fallbackRole 或既有值，預設 AGENT）。
 * - 未提供 roleId：用 legacy role 解析對應 system role 的 roleId（維持既有雙寫）。
 *
 * @param assignerRoleId 指派者角色（越權防護用；null/undefined 表示不做越權檢查，如離線工具）
 */
async function resolveRoleAssignment(
  ctx: TenantCtx,
  input: { role?: AgentRoleValue; roleId?: string },
  fallbackRole: AgentRoleValue,
  assignerRoleId: string | null | undefined,
): Promise<{ role: AgentRoleValue; roleId: string | null }> {
  if (input.roleId) {
    // 跨租戶必 404（loadTenantRole 以 tenantId 驗擁有權）
    const target = await loadTenantRole(ctx, input.roleId);
    // 越權防護：不可指派超出自身權限的角色
    await assertNoRoleEscalation(ctx, assignerRoleId, target.id);
    // legacy role 反填：system role 對應 enum；custom role 用傳入 role 或 fallback
    const legacyRole: AgentRoleValue = target.isSystem
      ? SLUG_TO_ENUM[target.slug] ?? input.role ?? fallbackRole
      : input.role ?? fallbackRole;
    return { role: legacyRole, roleId: target.id };
  }

  // 只給 legacy role：解析對應 system role 的 roleId（既有雙寫）
  const role = input.role ?? fallbackRole;
  const roleId = await resolveRoleId(ctx, role);
  // 該租戶缺對應 system role → 資料未正確初始化，直接擋下而非用 null 覆蓋既有 roleId
  // （否則成員 roleId 會被清空，getEffectivePermissions(null) 回空集合把人鎖死）。
  if (!roleId) {
    throw new AppError(
      '租戶缺少對應的系統角色，請重新初始化角色設定',
      'SYSTEM_ROLE_MISSING',
      500,
      { role },
    );
  }
  // legacy 路徑同樣做越權防護（例：SUPERVISOR 不可指派 ADMIN），取代舊 inline 硬規則
  await assertNoRoleEscalation(ctx, assignerRoleId, roleId);
  return { role, roleId };
}

const agentSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  avatarUrl: true,
  isActive: true,
  tenantId: true,
  createdAt: true,
} as const;

/**
 * 新成員要直綁哪些渠道、什麼層級（change channel-visibility-fail-closed）。可見範圍是 fail-closed：
 * 沒有任何綁定的成員（非總店）什麼都看不到，所以建立時一併決定。
 *   - 沒指定 → 建立者可指派的全部渠道（總店或有 channel.assign_team 為租戶所有渠道）
 *   - 指定了建立者不能指派的渠道 → 403；指定了不屬於本租戶的渠道 → 400
 *   - 層級：總店或有 channel.assign_team 時為 full；否則不高於建立者自己的層級，避免越權
 * 都在建立成員之前檢查，不留下半套。
 */
async function resolveNewAgentChannels(
  ctx: TenantCtx,
  requested: string[] | undefined,
  grantable: ChannelGrantScope,
): Promise<Array<{ channelId: string; accessLevel: ChannelAccessLevel }>> {
  if (requested === undefined) {
    if (grantable !== ALL_CHANNELS) {
      return Array.from(grantable, ([channelId, accessLevel]) => ({ channelId, accessLevel }));
    }
    const channels = await ctx.tx.channel.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true } });
    return channels.map((c) => ({ channelId: c.id, accessLevel: 'full' }));
  }
  const ids = Array.from(new Set(requested));
  if (ids.length === 0) return [];
  if (grantable !== ALL_CHANNELS && ids.some((id) => !grantable.has(id))) {
    throw new AppError('不能指派自己看不到的渠道', 'FORBIDDEN', 403);
  }
  const owned = await ctx.tx.channel.findMany({ where: { tenantId: ctx.tenantId, id: { in: ids } }, select: { id: true } });
  if (owned.length !== ids.length) {
    throw new AppError('指定的渠道中有部分不存在或不屬於此租戶', 'BAD_REQUEST', 400);
  }
  return ids.map((channelId) => ({
    channelId,
    accessLevel: grantable === ALL_CHANNELS ? 'full' : grantable.get(channelId)!,
  }));
}

export async function createAgent(
  ctx: TenantCtx,
  data: CreateAgentInput,
  assignerRoleId: string | null | undefined,
  /**
   * grantable、grantedById：新成員的可見渠道，建立者可指派的範圍與授權人。
   * passwordHash：呼叫端先在交易外雜湊好，避免 bcrypt 佔住交易與連線。
   */
  opts: { grantable: ChannelGrantScope; grantedById?: string; passwordHash: string },
) {
  // email 全域唯一。這裡只查得到同租戶的成員：路由以綁定租戶的連線呼叫，RLS 會藏起其他租戶的成員。
  // 跨租戶撞 email 時由資料庫的唯一約束擋下（P2002），error-handler.plugin.ts 轉成 409 CONFLICT。
  const existing = await ctx.tx.agent.findUnique({
    where: { email: data.email },
  });

  if (existing) {
    throw new AppError('這個電子郵件已被使用，請換一個', 'CONFLICT', 409);
  }

  // 方案人數上限硬擋（建立時 count 檢查；無上限 = null 時跳過）。
  // 在權限檢查之後、實際建立之前，正交於 RBAC。
  const maxAgents = await getEffectiveLimit(ctx.tx, ctx.tenantId, 'maxAgents');
  if (maxAgents !== null) {
    const activeCount = await ctx.tx.agent.count({ where: { tenantId: ctx.tenantId, isActive: true } });
    if (activeCount >= maxAgents) {
      throw new AppError('已達方案客服人數上限，請升級方案', 'PLAN_LIMIT_EXCEEDED', 403, {
        limitKey: 'maxAgents',
        current: activeCount,
        max: maxAgents,
      });
    }
  }

  const channels = await resolveNewAgentChannels(ctx, data.channelIds, opts.grantable);
  // 雙寫：legacy role enum + granular roleId。提供 roleId 時以 roleId 為準並做越權防護。
  const { role, roleId } = await resolveRoleAssignment(ctx,
    { role: data.role, roleId: data.roleId },
    data.role,
    assignerRoleId,
  );

  const agent = await ctx.tx.agent.create({
    data: {
      tenantId: ctx.tenantId,
      name: data.name,
      email: data.email,
      role,
      roleId,
      passwordHash: opts.passwordHash,
    },
    select: agentSelect,
  });

  await insertAgentChannelAccess(
    ctx.tx,
    channels.map((c) => ({ ...c, agentId: agent.id })),
    opts.grantedById,
  );

  return agent;
}

export async function updateAgentRole(
  ctx: TenantCtx,
  agentId: string,
  input: { role?: AgentRoleValue; roleId?: string },
  assignerRoleId: string | null | undefined,
  selfAgentId: string | null | undefined,
) {
  const existing = await ctx.tx.agent.findFirst({
    where: { id: agentId, tenantId: ctx.tenantId },
    select: { role: true },
  });

  if (!existing) {
    throw new AppError(notFound('agent'), 'NOT_FOUND', 404);
  }

  // 雙寫：改 legacy role 同時更新 granular roleId。提供 roleId 時以 roleId 為準並做越權防護。
  // custom role 無對應 enum 時 fallback 沿用成員既有 legacy role。
  const { role, roleId } = await resolveRoleAssignment(ctx,
    input,
    existing.role as AgentRoleValue,
    assignerRoleId,
  );

  // 防自我降級（self-demotion）：操作者不可把「自己」改成不含 selfLock 權限（如 role.manage）
  // 的角色，否則該租戶將失去所有能管理角色/權限的人，只能手動改 DB 復原。
  // 僅在「目標即操作者本人」時檢查；改別人一律放行。
  if (selfAgentId && agentId === selfAgentId) {
    const newEff = await getEffectivePermissions(ctx.tx, roleId);
    const retainsSelfLock = SELF_LOCK_CODES.some((c) => newEff.has(c));
    if (!retainsSelfLock) {
      throw new AppError(
        `無法將自己改為此角色：改後你將失去管理角色權限的能力（缺少: ${SELF_LOCK_CODES.join(', ')}）`,
        'SELF_LOCK',
        422,
        { selfLockPermissions: SELF_LOCK_CODES },
      );
    }
  }

  const agent = await ctx.tx.agent.update({
    where: { id: agentId },
    data: { role, roleId },
    select: agentSelect,
  });

  return agent;
}

/** newPasswordHash：呼叫端先在交易外雜湊好，避免 bcrypt 佔住交易與連線 */
export async function changeOwnPassword(
  ctx: TenantCtx,
  agentId: string,
  currentPassword: string,
  newPasswordHash: string,
) {
  const agent = await ctx.tx.agent.findUnique({
    where: { id: agentId },
    select: { passwordHash: true },
  });

  if (!agent) {
    throw new AppError(notFound('agent'), 'NOT_FOUND', 404);
  }

  const valid = await verifyPassword(currentPassword, agent.passwordHash);
  if (!valid) {
    throw new AppError('目前密碼不正確', 'INVALID_PASSWORD', 400);
  }

  await ctx.tx.agent.update({
    where: { id: agentId },
    data: { passwordHash: newPasswordHash },
  });
}

/** passwordHash：呼叫端先在交易外雜湊好 */
export async function resetAgentPassword(
  ctx: TenantCtx,
  agentId: string,
  passwordHash: string,
) {
  const existing = await ctx.tx.agent.findFirst({
    where: { id: agentId, tenantId: ctx.tenantId },
  });

  if (!existing) {
    throw new AppError(notFound('agent'), 'NOT_FOUND', 404);
  }

  await ctx.tx.agent.update({
    where: { id: agentId },
    data: { passwordHash },
  });
}

// admin 判定條件（legacy enum 或 granular system role 其一即算）：last-admin 守門用
const ADMIN_WHERE = {
  OR: [
    { role: 'ADMIN' as const },
    { roleRef: { is: { slug: 'admin', isSystem: true } } },
  ],
};

/**
 * Last-admin 守門：目標若為「啟用中的管理員」且是租戶最後一位，擋下停用/刪除。
 * 否則租戶將失去所有管理權限（無人能再指派角色/調整設定），只能手動改 DB 復原。
 * 目標已停用（isActive=false）時不影響啟用中 admin 數，不在此擋。
 */
async function assertNotLastActiveAdmin(
  ctx: TenantCtx,
  target: { isActive: boolean; role: string; roleId: string | null },
): Promise<void> {
  if (!target.isActive) return;
  const targetIsAdmin =
    target.role === 'ADMIN' ||
    (target.roleId
      ? Boolean(await ctx.tx.role.findFirst({
          where: { id: target.roleId, tenantId: ctx.tenantId, slug: 'admin', isSystem: true },
          select: { id: true },
        }))
      : false);
  if (!targetIsAdmin) return;

  const activeAdmins = await ctx.tx.agent.count({
    where: { tenantId: ctx.tenantId, isActive: true, ...ADMIN_WHERE },
  });
  if (activeAdmins <= 1) {
    throw new AppError(
      '不可停用/刪除租戶最後一位啟用中的管理員',
      'LAST_ADMIN_PROTECTED',
      422,
    );
  }
}

export async function deactivateAgent(
  ctx: TenantCtx,
  agentId: string,
) {
  const existing = await ctx.tx.agent.findFirst({
    where: { id: agentId, tenantId: ctx.tenantId },
    select: { id: true, isActive: true, role: true, roleId: true },
  });

  if (!existing) {
    throw new AppError(notFound('agent'), 'NOT_FOUND', 404);
  }

  // 防呆：不可停用最後一位啟用中的管理員（租戶會被鎖死）
  await assertNotLastActiveAdmin(ctx, existing);

  await ctx.tx.agent.update({
    where: { id: agentId },
    data: { isActive: false },
  });
}

/**
 * 永久刪除人員並釋放 email（不可復原）。
 *
 * email 全域唯一（agents.@@unique([email])，多租戶登入靠 email 解析租戶），
 * 停用不會釋放 email——只有真刪除記錄才行。刪除前須清理對 agents 為
 * RESTRICT 的關聯（notifications / cli_sessions / passkey_credentials），
 * 否則外鍵會擋下刪除；CASCADE（agent_team_members）與 SET NULL（cases /
 * conversations / messages 等指派欄位）由資料庫自理，歷史資料保留。
 * 全程在呼叫端開的交易內執行，任一步失敗則整體回滾。
 */
export async function purgeAgent(ctx: TenantCtx, agentId: string) {
  const { tx } = ctx;
  const existing = await tx.agent.findFirst({
    where: { id: agentId, tenantId: ctx.tenantId },
    select: { id: true, isActive: true, role: true, roleId: true },
  });
  if (!existing) {
    throw new AppError(notFound('agent'), 'NOT_FOUND', 404);
  }
  // 防呆：不可刪除最後一位啟用中的管理員（租戶會被鎖死）
  await assertNotLastActiveAdmin(ctx, existing);
  // 先清 RESTRICT 關聯（有資料會擋刪）
  await tx.notification.deleteMany({ where: { agentId } });
  await tx.cliSession.deleteMany({ where: { agentId } });
  await tx.passkeyCredential.deleteMany({ where: { agentId } });
  // 再刪 Agent（agent_team_members 會 CASCADE、cases/conversations/messages 等 SET NULL）
  await tx.agent.delete({ where: { id: agentId } });
}

/** 成員列表的欄位（含角色與團隊）。啟用中與停用的列表共用 */
const agentListSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  roleId: true,
  // 帶出指派的角色資訊，供前端顯示自訂角色名與精準預選
  roleRef: { select: { id: true, name: true, slug: true, isSystem: true } },
  avatarUrl: true,
  isActive: true,
  teams: { include: { team: { select: { id: true, name: true } } } },
  _count: { select: { assignedCases: true } },
} as const;

/** 本租戶的成員列表。isActive=false 時列出停用的成員（供重新啟用，AUDIT AUTH-09） */
export async function listAgents(ctx: TenantCtx, isActive: boolean) {
  return ctx.tx.agent.findMany({
    where: { tenantId: ctx.tenantId, isActive },
    select: agentListSelect,
    orderBy: { name: 'asc' },
  });
}

/**
 * 重新啟用停用的成員（G17，AUDIT AUTH-09）。角色維持停用前的角色。
 * 套用方案人數上限：否則「停用 → 建立新成員 → 重新啟用」可繞過建立時的上限。
 */
export async function reactivateAgent(ctx: TenantCtx, agentId: string): Promise<void> {
  const existing = await ctx.tx.agent.findFirst({
    where: { id: agentId, tenantId: ctx.tenantId },
    select: { id: true, isActive: true },
  });
  if (!existing) {
    throw new AppError(notFound('agent'), 'NOT_FOUND', 404);
  }
  if (existing.isActive) return;

  const maxAgents = await getEffectiveLimit(ctx.tx, ctx.tenantId, 'maxAgents');
  if (maxAgents !== null) {
    const activeCount = await ctx.tx.agent.count({ where: { tenantId: ctx.tenantId, isActive: true } });
    if (activeCount >= maxAgents) {
      throw new AppError('已達方案客服人數上限，無法重新啟用，請先停用其他成員或升級方案', 'PLAN_LIMIT_EXCEEDED', 403, {
        limitKey: 'maxAgents',
        current: activeCount,
        max: maxAgents,
      });
    }
  }

  await ctx.tx.agent.update({
    where: { id: agentId },
    data: { isActive: true },
  });
}
