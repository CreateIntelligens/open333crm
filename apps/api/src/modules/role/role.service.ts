/**
 * Role Service — 角色與權限管理
 *
 * 對應 rbac-granular-permissions specs/role-management。
 * 租戶隔離鐵律（見 tasks 5.1）：所有 Role/RolePermission 操作 tenantId 一律來自 request.agent.tenantId，
 * 改/刪/讀前先經 loadTenantRole() 驗擁有權，杜絕跨租戶越權。
 */

import type { PrismaClient } from '@prisma/client';
import {
  PERMISSIONS,
  PERMISSION_BY_CODE,
  PERMISSION_CODES,
  resolveImplied,
  SYSTEM_ROLE_SLUGS,
} from '@open333crm/core';
import { AppError } from '../../shared/utils/response.js';
import { getEffectivePermissions, invalidateRolePermissions } from '../../services/permission.service.js';

const ADMIN_LOCKED = PERMISSIONS.filter((p) => p.adminLock).map((p) => p.code);

/**
 * 【租戶隔離—必做】以 tenantId 驗證 role 屬於本租戶，找不到丟 404。
 * 任何碰 RolePermission 的操作前都必須先過這道關。
 */
export async function loadTenantRole(prisma: PrismaClient, roleId: string, tenantId: string) {
  const role = await prisma.role.findFirst({ where: { id: roleId, tenantId } });
  if (!role) throw new AppError('Role not found', 'NOT_FOUND', 404);
  return role;
}

/** 列出租戶所有角色（含權限數）。 */
export async function listRoles(prisma: PrismaClient, tenantId: string) {
  const roles = await prisma.role.findMany({
    where: { tenantId },
    orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
    include: { _count: { select: { permissions: true, agents: true } } },
  });
  return roles.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    isSystem: r.isSystem,
    permissionCount: r._count.permissions,
    agentCount: r._count.agents,
  }));
}

/** 取得某角色的權限碼清單（明確授予，不含 implies）。 */
export async function getRolePermissions(prisma: PrismaClient, roleId: string, tenantId: string) {
  await loadTenantRole(prisma, roleId, tenantId);
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permissionCode: true },
  });
  return rows.map((r) => r.permissionCode);
}

/** 建立自訂角色（空白，0 權限）。 */
export async function createRole(prisma: PrismaClient, tenantId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new AppError('角色名稱不可為空', 'VALIDATION_ERROR', 422);
  // slug 用隨機值（custom），確保租戶內唯一
  const slug = `custom-${Math.random().toString(36).slice(2, 10)}`;
  // 名稱租戶內不可重複
  const dup = await prisma.role.findFirst({ where: { tenantId, name: trimmed } });
  if (dup) throw new AppError('已有同名角色', 'DUPLICATE', 422);
  const role = await prisma.role.create({
    data: { tenantId, slug, name: trimmed, isSystem: false },
  });
  return { id: role.id, slug: role.slug, name: role.name, isSystem: false };
}

/** 改角色名稱（system role 可改 name 不可改 slug）。 */
export async function renameRole(prisma: PrismaClient, roleId: string, tenantId: string, name: string) {
  await loadTenantRole(prisma, roleId, tenantId);
  const trimmed = name.trim();
  if (!trimmed) throw new AppError('角色名稱不可為空', 'VALIDATION_ERROR', 422);
  const dup = await prisma.role.findFirst({ where: { tenantId, name: trimmed, NOT: { id: roleId } } });
  if (dup) throw new AppError('已有同名角色', 'DUPLICATE', 422);
  const role = await prisma.role.update({ where: { id: roleId }, data: { name: trimmed } });
  return { id: role.id, slug: role.slug, name: role.name, isSystem: role.isSystem };
}

/** 刪除自訂角色（system role 不可刪；仍被指派則阻擋）。 */
export async function deleteRole(prisma: PrismaClient, roleId: string, tenantId: string) {
  const role = await loadTenantRole(prisma, roleId, tenantId);
  if (role.isSystem) throw new AppError('內建角色不可刪除', 'FORBIDDEN', 403);
  const agentCount = await prisma.agent.count({ where: { roleId, tenantId } });
  if (agentCount > 0) {
    throw new AppError(`此角色仍有 ${agentCount} 位成員使用中，請先改派`, 'ROLE_IN_USE', 409, {
      blockingAgentCount: agentCount,
    });
  }
  await prisma.role.delete({ where: { id: roleId } }); // RolePermission 隨 Cascade 刪除
  return { deleted: true };
}

/**
 * 設定角色權限（整批取代）。
 * 驗證：dependsOn 前置、admin 核心鎖定、防自鎖、越權防護。
 * @param editorRoleId 編輯者自身角色（越權/自鎖判斷）
 */
export async function setRolePermissions(
  prisma: PrismaClient,
  roleId: string,
  tenantId: string,
  codes: string[],
  editorRoleId: string | null | undefined,
) {
  const target = await loadTenantRole(prisma, roleId, tenantId);

  // 1. 所有 code 必須存在於 registry
  const unknown = codes.filter((c) => !PERMISSION_CODES.has(c));
  if (unknown.length) {
    throw new AppError(`未知的權限碼: ${unknown.join(', ')}`, 'VALIDATION_ERROR', 422);
  }

  const wanted = new Set(codes);

  // 2. dependsOn 驗證：勾了某權限必須也勾其前置
  for (const code of wanted) {
    const def = PERMISSION_BY_CODE.get(code);
    for (const dep of def?.dependsOn ?? []) {
      if (!wanted.has(dep)) {
        throw new AppError(`權限「${code}」需要前置權限「${dep}」`, 'DEPENDENCY_UNMET', 422, {
          missing: dep,
        });
      }
    }
  }

  // 3. 越權防護：非編輯自己以外，不可授予超出自己有效權限的權限
  //    （admin 角色的編輯者若自身即 admin 則有全部權限，不受限）
  const editorEff = await getEffectivePermissions(prisma, editorRoleId);
  const editorIsAdminOfTenant = await isAdminRole(prisma, editorRoleId, tenantId);
  if (!editorIsAdminOfTenant) {
    const escalate = [...wanted].filter((c) => !editorEff.has(c));
    if (escalate.length) {
      throw new AppError(`你本身沒有以下權限，無法授予: ${escalate.join(', ')}`, 'PRIVILEGE_ESCALATION', 403);
    }
  }

  // 4. admin 核心鎖定：admin system role 不可移除鎖定核心權限
  if (target.slug === 'admin' && target.isSystem) {
    for (const locked of ADMIN_LOCKED) {
      if (!wanted.has(locked)) {
        throw new AppError(`Admin 內建管理權限「${locked}」不可移除`, 'ADMIN_LOCK', 422);
      }
    }
  }

  // 5. 防自鎖：不可從自己當前角色移除 selfLock 權限（role.manage）
  if (editorRoleId && roleId === editorRoleId) {
    for (const p of PERMISSIONS) {
      if (p.selfLock && !wanted.has(p.code)) {
        throw new AppError(`移除「${p.code}」後你將無法再管理權限（防自鎖）`, 'SELF_LOCK', 422);
      }
    }
  }

  // 寫入：清空重建（同一交易）
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId } }),
    prisma.rolePermission.createMany({
      data: [...wanted].map((permissionCode) => ({ roleId, permissionCode })),
      skipDuplicates: true,
    }),
  ]);

  await invalidateRolePermissions(roleId);
  return { roleId, permissions: [...wanted] };
}

/** 權限矩陣資料：角色清單 + 依 group 的權限點（不含 implies 為可勾格）。 */
export function getPermissionMatrix() {
  const groups = new Map<string, typeof PERMISSIONS[number][]>();
  for (const p of PERMISSIONS) {
    const arr = groups.get(p.group) ?? [];
    arr.push(p);
    groups.set(p.group, arr);
  }
  return {
    groups: [...groups.entries()].map(([group, perms]) => ({
      group,
      permissions: perms.map((p) => ({
        code: p.code,
        label: p.label,
        description: p.description,
        dependsOn: p.dependsOn ?? [],
        implies: p.implies ?? [],
        adminLock: !!p.adminLock,
      })),
    })),
  };
}

async function isAdminRole(prisma: PrismaClient, roleId: string | null | undefined, tenantId: string) {
  if (!roleId) return false;
  const r = await prisma.role.findFirst({ where: { id: roleId, tenantId }, select: { slug: true, isSystem: true } });
  return !!r && r.isSystem && r.slug === 'admin';
}

export { resolveImplied, SYSTEM_ROLE_SLUGS };
