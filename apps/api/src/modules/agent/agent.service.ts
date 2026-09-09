import type { PrismaClient } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { withTenant } from '../../lib/tenant-db.js';
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
  prisma: TenantDb,
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
  prisma: TenantDb,
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
  prisma: TenantDb,
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
  prisma: TenantDb,
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
  prisma: TenantDb,
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
  prisma: TenantDb,
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
  prisma: TenantDb,
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
  prisma: TenantDb,
  tenantId: string,
  target: { isActive: boolean; role: string; roleId: string | null },
): Promise<void> {
  if (!target.isActive) return;
  const targetIsAdmin =
    target.role === 'ADMIN' ||
    (target.roleId
      ? Boolean(await prisma.role.findFirst({
          where: { id: target.roleId, tenantId, slug: 'admin', isSystem: true },
          select: { id: true },
        }))
      : false);
  if (!targetIsAdmin) return;

  const activeAdmins = await prisma.agent.count({
    where: { tenantId, isActive: true, ...ADMIN_WHERE },
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
  prisma: TenantDb,
  tenantId: string,
  agentId: string,
) {
  const existing = await prisma.agent.findFirst({
    where: { id: agentId, tenantId },
    select: { id: true, isActive: true, role: true, roleId: true },
  });

  if (!existing) {
    throw new AppError('Agent not found', 'NOT_FOUND', 404);
  }

  // 防呆：不可停用最後一位啟用中的管理員（租戶會被鎖死）
  await assertNotLastActiveAdmin(prisma, tenantId, existing);

  await prisma.agent.update({
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
 * 全程於單一交易內執行，任一步失敗則整體回滾。
 */
export async function purgeAgent(
  prisma: PrismaClient,
  tenantId: string,
  agentId: string,
) {
  // 交易內先設好 RLS 租戶 session，再於同交易清關聯 + 刪 Agent（同連線=SET LOCAL 有效）
  await withTenant(prisma, tenantId, async (tx) => {
    const existing = await tx.agent.findFirst({
      where: { id: agentId, tenantId },
      select: { id: true, isActive: true, role: true, roleId: true },
    });
    if (!existing) {
      throw new AppError('Agent not found', 'NOT_FOUND', 404);
    }
    // 防呆：不可刪除最後一位啟用中的管理員（租戶會被鎖死）
    await assertNotLastActiveAdmin(tx, tenantId, existing);
    // 先清 RESTRICT 關聯（有資料會擋刪）
    await tx.notification.deleteMany({ where: { agentId } });
    await tx.cliSession.deleteMany({ where: { agentId } });
    await tx.passkeyCredential.deleteMany({ where: { agentId } });
    // 再刪 Agent（agent_team_members 會 CASCADE、cases/conversations/messages 等 SET NULL）
    await tx.agent.delete({ where: { id: agentId } });
  });
}
