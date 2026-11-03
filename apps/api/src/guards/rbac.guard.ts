import type { FastifyRequest, FastifyReply } from 'fastify';
import { getEffectiveTenantPermissions } from '../services/permission.service.js';
import { getTenantPlanId } from '../services/tenant-plan.cache.js';
import { AppError } from '../shared/utils/response.js';

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
/**
 * 403 回應。
 *
 * ⚠️ 先前這五處直接送 `{ code, message }`，與全站慣例
 * `{ success, error: { code, message } }` 不一致——前端讀 `error.message` 會讀不到，
 * 導致權限不足時畫面一片空白、使用者不知道發生什麼事。
 *
 * `requiredPermission` 放 details 而非 message：「新增權限點後沒跑 reconcile 就 403」
 * 是本專案反覆踩到的坑，讓維運能直接從回應看出缺哪一個權限碼，
 * 但終端使用者的畫面上不顯示技術代碼。
 */
function sendForbidden(
  reply: FastifyReply,
  message: string,
  details?: Record<string, unknown>,
) {
  return reply.status(403).send({
    success: false,
    error: { code: 'FORBIDDEN', message, ...(details ? { details } : {}) },
  });
}

const PERMISSION_DENIED = '權限不足，無法執行此操作。如需使用請聯繫管理員。';

/**
 * 當前 agent 是否有某權限碼：Partner key 只看白名單、CLI session 放行（走自身 scope），
 * 其餘以有效權限（角色權限 ∩ 方案功能天花板）判斷。
 */
async function isPermitted(request: FastifyRequest, code: string): Promise<boolean> {
  // Partner API key：只對白名單權限碼放行，其餘一律擋（避免無條件繞過）
  if (request.agent?.isPartnerKey) return PARTNER_KEY_ALLOWED.has(code);
  // CLI session 走自身 scope 機制（cli.routes），不經 requirePermission 路由；防禦性放行
  if (request.agent?.isCliSession) return true;
  const roleId = request.agent?.roleId;
  // 有效權限 = 角色權限 ∩ 方案功能天花板（無方案則不設天花板）
  const planId = await getTenantPlanId(request.server.prismaAdmin, request.agent?.tenantId);
  const eff = await getEffectiveTenantPermissions(request.server.prismaAdmin, roleId, planId);
  return eff.has(code);
}

/**
 * @param message 被拒時給使用者看的說明；預設為通用的「權限不足」。
 *   同一條路由有多個檢查時，用它說清楚是哪個操作需要權限（details.requiredPermission 給維運看）
 */
export const requirePermission = (code: string, message: string = PERMISSION_DENIED) => {
  usedPermissionCodes.add(code);
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await isPermitted(request, code))) {
      return sendForbidden(reply, message, { requiredPermission: code });
    }
  };
};

/**
 * 條件式權限點 guard：`when(request)` 成立時才要求 `code`，否則放行。
 * 用於同一條路由依 body 內容需要額外權限的情境（例如建立或編輯工單時順便指派，需要 case.assign）。
 * 放在 preHandler 陣列中、排在基本權限 guard 之後；被拒時由 Fastify 中止後續 hook。
 */
export const requirePermissionWhen = (
  code: string,
  when: (request: FastifyRequest) => boolean,
  message?: string,
) => {
  const guard = requirePermission(code, message);
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (when(request)) return guard(request, reply);
  };
};

/**
 * 在 handler 內檢查權限：要先讀資料才知道需要哪個權限時用（例如附券廣播的「立即發送」要 coupon.issue）。
 * 沒有權限時拋 403 AppError，回應格式與 requirePermission 相同（details.requiredPermission）。
 */
export async function assertPermission(request: FastifyRequest, code: string, message: string = PERMISSION_DENIED): Promise<void> {
  usedPermissionCodes.add(code);
  if (!(await isPermitted(request, code))) {
    throw new AppError(message, 'FORBIDDEN', 403, { requiredPermission: code });
  }
}

/**
 * 權限點 guard（任一命中即放行）：當前 agent 的有效權限集合「不含任何一個」`codes` 時回 403。
 *
 * 用於同一條路由可被多種權限點滿足的情境
 * （例如 /analytics/my 只要有 analytics.view 或 analytics.view.self 其一即可）。
 *
 * @example
 * fastify.addHook('preHandler', requireAnyPermission(['analytics.view', 'analytics.view.self']));
 */
export const requireAnyPermission = (codes: string[]) => {
  codes.forEach((c) => usedPermissionCodes.add(c));
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Partner API key：任一碼在白名單即放行，其餘一律擋
    if (request.agent?.isPartnerKey) {
      if (codes.some((c) => PARTNER_KEY_ALLOWED.has(c))) return;
      return sendForbidden(reply, PERMISSION_DENIED, { requiredAnyOf: codes });
    }
    // CLI session 走自身 scope 機制，不經 requirePermission 路由；防禦性放行
    if (request.agent?.isCliSession) {
      return;
    }
    const roleId = request.agent?.roleId;
    // 有效權限 = 角色權限 ∩ 方案功能天花板（無方案則不設天花板）
    const planId = await getTenantPlanId(request.server.prismaAdmin, request.agent?.tenantId);
    const eff = await getEffectiveTenantPermissions(request.server.prismaAdmin, roleId, planId);
    if (!codes.some((c) => eff.has(c))) {
      return sendForbidden(reply, PERMISSION_DENIED, { requiredAnyOf: codes });
    }
  };
};

// ── 過渡 shim：舊角色白名單 guard（新路由勿用）──

export const requireRole = (allowedRoles: string[]) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const role = request.agent?.role;
    if (!role || !allowedRoles.includes(role)) {
      return sendForbidden(reply, '您的角色沒有權限執行此操作', { allowedRoles });
    }
  };
};

/** @deprecated 用 requirePermission。ADMIN only. */
export const requireAdmin = () => requireRole(['ADMIN']);

/** @deprecated 用 requirePermission。ADMIN or SUPERVISOR. */
export const requireSupervisor = () => requireRole(['ADMIN', 'SUPERVISOR']);
