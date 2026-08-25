import type { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '@open333crm/core';
import { AppError } from '../../shared/utils/response.js';
import { hashPassword, verifyPassword } from '../../shared/utils/password.js';
import type { AgentRoleValue, CreateAgentInput } from './agent.schema.js';
import { getEffectiveLimit } from '../platform/plan-limits.service.js';
import { loadTenantRole } from '../role/role.service.js';
import { getEffectivePermissions } from '../../services/permission.service.js';

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
  prisma: PrismaClient,
  tenantId: string,
  role: string,
): Promise<string | null> {
  const slug = ENUM_TO_SLUG[role];
  if (!slug) return null;
  const r = await prisma.role.findFirst({
    where: { tenantId, slug, isSystem: true },
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
  prisma: PrismaClient,
  tenantId: string,
  assignerRoleId: string | null | undefined,
  targetRoleId: string,
): Promise<void> {
  // 指派者若為該租戶 admin system role → 擁有全部權限，直接放行
  const assignerRole = assignerRoleId
    ? await prisma.role.findFirst({
        where: { id: assignerRoleId, tenantId },
        select: { slug: true, isSystem: true },
      })
    : null;
  if (assignerRole?.isSystem && assignerRole.slug === 'admin') return;

  const assignerEff = await getEffectivePermissions(prisma, assignerRoleId);
  const targetEff = await getEffectivePermissions(prisma, targetRoleId);
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
  prisma: PrismaClient,
  tenantId: string,
  input: { role?: AgentRoleValue; roleId?: string },
  fallbackRole: AgentRoleValue,
  assignerRoleId: string | null | undefined,
): Promise<{ role: AgentRoleValue; roleId: string | null }> {
  if (input.roleId) {
    // 跨租戶必 404（loadTenantRole 以 tenantId 驗擁有權）
    const target = await loadTenantRole(prisma, input.roleId, tenantId);
    // 越權防護：不可指派超出自身權限的角色
    await assertNoRoleEscalation(prisma, tenantId, assignerRoleId, target.id);
    // legacy role 反填：system role 對應 enum；custom role 用傳入 role 或 fallback
    const legacyRole: AgentRoleValue = target.isSystem
      ? SLUG_TO_ENUM[target.slug] ?? input.role ?? fallbackRole
      : input.role ?? fallbackRole;
    return { role: legacyRole, roleId: target.id };
  }

  // 只給 legacy role：解析對應 system role 的 roleId（既有雙寫）
  const role = input.role ?? fallbackRole;
  const roleId = await resolveRoleId(prisma, tenantId, role);
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
  await assertNoRoleEscalation(prisma, tenantId, assignerRoleId, roleId);
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

export async function createAgent(
  prisma: PrismaClient,
  tenantId: string,
  data: CreateAgentInput,
  assignerRoleId: string | null | undefined,
) {
  // email 全域唯一：跨租戶檢查是否已被使用（不限本租戶），
  // 否則跨租戶撞 email 會在 create 時冒 P2002 → 500，而非乾淨的 409
  const existing = await prisma.agent.findUnique({
    where: { email: data.email },
  });

  if (existing) {
    throw new AppError('Email already in use', 'CONFLICT', 409);
  }

  // 方案人數上限硬擋（建立時 count 檢查；無上限 = null 時跳過）。
  // 在權限檢查之後、實際建立之前，正交於 RBAC。
  const maxAgents = await getEffectiveLimit(prisma, tenantId, 'maxAgents');
  if (maxAgents !== null) {
    const activeCount = await prisma.agent.count({ where: { tenantId, isActive: true } });
    if (activeCount >= maxAgents) {
      throw new AppError('已達方案客服人數上限，請升級方案', 'PLAN_LIMIT_EXCEEDED', 403, {
        limitKey: 'maxAgents',
        current: activeCount,
        max: maxAgents,
      });
    }
  }

  const passwordHash = await hashPassword(data.password);
  // 雙寫：legacy role enum + granular roleId。提供 roleId 時以 roleId 為準並做越權防護。
  const { role, roleId } = await resolveRoleAssignment(
    prisma,
    tenantId,
    { role: data.role, roleId: data.roleId },
    data.role,
    assignerRoleId,
  );

  const agent = await prisma.agent.create({
    data: {
      tenantId,
      name: data.name,
      email: data.email,
      role,
      roleId,
      passwordHash,
    },
    select: agentSelect,
  });

  return agent;
}

export async function updateAgentRole(
  prisma: PrismaClient,
  tenantId: string,
  agentId: string,
  input: { role?: AgentRoleValue; roleId?: string },
  assignerRoleId: string | null | undefined,
  selfAgentId: string | null | undefined,
) {
  const existing = await prisma.agent.findFirst({
    where: { id: agentId, tenantId },
    select: { role: true },
  });

  if (!existing) {
    throw new AppError('Agent not found', 'NOT_FOUND', 404);
  }

  // 雙寫：改 legacy role 同時更新 granular roleId。提供 roleId 時以 roleId 為準並做越權防護。
  // custom role 無對應 enum 時 fallback 沿用成員既有 legacy role。
  const { role, roleId } = await resolveRoleAssignment(
    prisma,
    tenantId,
    input,
    existing.role as AgentRoleValue,
    assignerRoleId,
  );

  // 防自我降級（self-demotion）：操作者不可把「自己」改成不含 selfLock 權限（如 role.manage）
  // 的角色，否則該租戶將失去所有能管理角色/權限的人，只能手動改 DB 復原。
  // 僅在「目標即操作者本人」時檢查；改別人一律放行。
  if (selfAgentId && agentId === selfAgentId) {
    const newEff = await getEffectivePermissions(prisma, roleId);
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

  const agent = await prisma.agent.update({
    where: { id: agentId },
    data: { role, roleId },
    select: agentSelect,
  });

  return agent;
}

export async function changeOwnPassword(
  prisma: PrismaClient,
  agentId: string,
  currentPassword: string,
  newPassword: string,
) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { passwordHash: true },
  });

  if (!agent) {
    throw new AppError('Agent not found', 'NOT_FOUND', 404);
  }

  const valid = await verifyPassword(currentPassword, agent.passwordHash);
  if (!valid) {
    throw new AppError('Current password is incorrect', 'INVALID_PASSWORD', 400);
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.agent.update({
    where: { id: agentId },
    data: { passwordHash },
  });
}

export async function resetAgentPassword(
  prisma: PrismaClient,
  tenantId: string,
  agentId: string,
  newPassword: string,
) {
  const existing = await prisma.agent.findFirst({
    where: { id: agentId, tenantId },
  });

  if (!existing) {
    throw new AppError('Agent not found', 'NOT_FOUND', 404);
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.agent.update({
    where: { id: agentId },
    data: { passwordHash },
  });
}

export async function deactivateAgent(
  prisma: PrismaClient,
  tenantId: string,
  agentId: string,
) {
  const existing = await prisma.agent.findFirst({
    where: { id: agentId, tenantId },
  });

  if (!existing) {
    throw new AppError('Agent not found', 'NOT_FOUND', 404);
  }

  await prisma.agent.update({
    where: { id: agentId },
    data: { isActive: false },
  });
}
