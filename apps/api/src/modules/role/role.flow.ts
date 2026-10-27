/**
 * role 的 flow（change migrate-role-agent-tenant-ctx，design 決策 7）：開交易、呼叫 service、寫稽核、清快取。
 * role.routes.ts 讀寫租戶資料的 route 都經過這裡，查詢也一樣（之後要加快取時放在這一層）。
 *
 * 權限快取在 commit 之後才清除（design 決策 1）：commit 之前清掉的快取，可能被另一個請求以舊資料寫回。
 * inTenant() 等清除完成才回傳，所以 route 的回應在清除之後送出（主規格 permission-check）。
 */
import type { PrismaClient } from '@prisma/client';
import { inTenant, type TenantScope } from '../../lib/tenant-ctx.js';
import type { RequestActor } from '../../lib/request-actor.js';
import { invalidateRolePermissions } from '../../services/permission.service.js';
import { recordTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import { createRole, deleteRole, getRolePermissions, listRoles, renameRole, setRolePermissions } from './role.service.js';

export interface RoleFlowDeps {
  prisma: PrismaClient;
}

function clearPermissionCache(scope: TenantScope, roleId: string) {
  scope.afterCommit('invalidateRolePermissions', () => invalidateRolePermissions(roleId));
}

export function listRolesFlow(deps: RoleFlowDeps, actor: RequestActor) {
  return inTenant(deps.prisma, actor.tenantId, (scope) => listRoles(scope));
}

export function getRolePermissionsFlow(deps: RoleFlowDeps, actor: RequestActor, roleId: string) {
  return inTenant(deps.prisma, actor.tenantId, (scope) => getRolePermissions(scope, roleId));
}

/** 建立自訂角色（空白）。稽核記角色名稱 */
export function createRoleFlow(deps: RoleFlowDeps, actor: RequestActor, name: string) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const role = await createRole(scope, name);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'role.create',
      targetType: 'role',
      targetId: role.id,
      payload: { name: role.name },
      ip: actor.ip,
    });
    return role;
  });
}

/** 改角色名稱。稽核記新名稱 */
export function renameRoleFlow(deps: RoleFlowDeps, actor: RequestActor, roleId: string, name: string) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const role = await renameRole(scope, roleId, name);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'role.rename',
      targetType: 'role',
      targetId: roleId,
      payload: { name: role.name },
      ip: actor.ip,
    });
    return role;
  });
}

/** 設定角色權限（整批取代）。稽核與權限一起 commit（payload 記最終權限碼清單，權限碼非 PII） */
export function setRolePermissionsFlow(deps: RoleFlowDeps, actor: RequestActor, roleId: string, codes: string[]) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const result = await setRolePermissions(scope, roleId, codes, actor.roleId);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'role.permission.update',
      targetType: 'role',
      targetId: roleId,
      payload: { permissions: result.permissions },
      ip: actor.ip,
    });
    clearPermissionCache(scope, roleId);
    return result;
  });
}

/** 刪除自訂角色，並清掉已刪角色的殘留快取。稽核記被刪角色的名稱（角色列已不存在） */
export function deleteRoleFlow(deps: RoleFlowDeps, actor: RequestActor, roleId: string) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const { name } = await deleteRole(scope, roleId);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'role.delete',
      targetType: 'role',
      targetId: roleId,
      payload: { name },
      ip: actor.ip,
    });
    clearPermissionCache(scope, roleId);
    return { deleted: true as const };
  });
}
