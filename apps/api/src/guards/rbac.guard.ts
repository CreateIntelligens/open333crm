import type { FastifyRequest, FastifyReply } from 'fastify';
import { getEffectiveTenantPermissions } from '../services/permission.service.js';
import { getTenantPlanId } from '../services/tenant-plan.cache.js';

/**
 * RBAC guards.
 *
 * 新：requirePermission(code) — 以權限點為基礎，讀當前 agent 角色的有效權限集合判斷。
 * 舊：requireRole / requireAdmin / requireSupervisor — 角色白名單 shim，過渡期保留，
 *     新路由一律用 requirePermission。
 *
 * 所有 guard 必須放在 `fastify.authenticate` 之後。
 */

// 收集所有被 requirePermission 引用的權限碼，供啟動時做 route-to-registry 一致性檢查。
export const usedPermissionCodes = new Set<string>();

// Partner API key（合成 agent，無 roleId）允許放行的權限碼白名單。
// 只有明確列在此的碼才對 Partner key 放行——避免日後新增 partner 路由時無條件繞過權限。
const PARTNER_KEY_ALLOWED = new Set<string>(['knowledge.admin']);

/**
 * 權限點 guard：當前 agent 的有效權限集合不含 `code` 時回 403。
 *
 * @example
 * fastify.post('/', { preHandler: [fastify.authenticate, requirePermission('channel.create')] }, handler);
 */
export const requirePermission = (code: string) => {
  usedPermissionCodes.add(code);
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Partner API key：只對白名單權限碼放行，其餘一律擋（避免無條件繞過）
    if (request.agent?.isPartnerKey) {
      if (PARTNER_KEY_ALLOWED.has(code)) return;
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Insufficient permission' });
    }
    // CLI session 走自身 scope 機制（cli.routes），不經 requirePermission 路由；防禦性放行
    if (request.agent?.isCliSession) {
      return;
    }
    const roleId = request.agent?.roleId;
    // 有效權限 = 角色權限 ∩ 方案功能天花板（無方案則不設天花板）
    const planId = await getTenantPlanId(request.server.prisma, request.agent?.tenantId);
    const eff = await getEffectiveTenantPermissions(request.server.prisma, roleId, planId);
    if (!eff.has(code)) {
      return reply.status(403).send({
        code: 'FORBIDDEN',
        message: 'Insufficient permission',
      });
    }
  };
};

// ── 過渡 shim：舊角色白名單 guard（新路由勿用）──

export const requireRole = (allowedRoles: string[]) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const role = request.agent?.role;
    if (!role || !allowedRoles.includes(role)) {
      return reply.status(403).send({
        code: 'FORBIDDEN',
        message: 'Insufficient role',
      });
    }
  };
};

/** @deprecated 用 requirePermission。ADMIN only. */
export const requireAdmin = () => requireRole(['ADMIN']);

/** @deprecated 用 requirePermission。ADMIN or SUPERVISOR. */
export const requireSupervisor = () => requireRole(['ADMIN', 'SUPERVISOR']);
