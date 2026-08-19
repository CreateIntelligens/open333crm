import type { FastifyRequest, FastifyReply } from 'fastify';
import { getEffectivePermissions } from '../services/permission.service.js';

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

/**
 * 權限點 guard：當前 agent 的有效權限集合不含 `code` 時回 403。
 *
 * @example
 * fastify.post('/', { preHandler: [fastify.authenticate, requirePermission('channel.create')] }, handler);
 */
export const requirePermission = (code: string) => {
  usedPermissionCodes.add(code);
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Partner API key / CLI session 走各自 scope 機制，不套用角色權限判斷
    if (request.agent?.isPartnerKey || request.agent?.isCliSession) {
      return; // 交由既有 scope 檢查（若有）；此處不阻擋
    }
    const roleId = request.agent?.roleId;
    const eff = await getEffectivePermissions(request.server.prisma, roleId);
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
