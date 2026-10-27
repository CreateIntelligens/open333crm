/**
 * role 的 flow（change migrate-role-agent-tenant-ctx，design 決策 7）：開交易、呼叫 service、寫稽核、清快取。
 *
 * 權限快取在 commit 之後才清除（design 決策 1）：commit 之前清掉的快取，可能被另一個請求以舊資料寫回。
 * inTenant() 等清除完成才回傳，所以 route 的回應在清除之後送出（主規格 permission-check）。
 */
import type { PrismaClient } from '@prisma/client';
import { inTenant, type TenantScope } from '../../lib/tenant-ctx.js';
import type { RequestActor } from '../../lib/request-actor.js';
import { invalidateRolePermissions } from '../../services/permission.service.js';
import { recordTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import { deleteRole, setRolePermissions } from './role.service.js';

export interface RoleFlowDeps {
  prisma: PrismaClient;
}

function clearPermissionCache(scope: TenantScope, roleId: string) {
  scope.afterCommit('invalidateRolePermissions', () => invalidateRolePermissions(roleId));
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

/** 刪除自訂角色，並清掉已刪角色的殘留快取 */
export function deleteRoleFlow(deps: RoleFlowDeps, actor: RequestActor, roleId: string) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const result = await deleteRole(scope, roleId);
    clearPermissionCache(scope, roleId);
    return result;
  });
}
