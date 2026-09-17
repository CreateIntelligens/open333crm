/**
 * 優惠券後台 API。Prefix: /api/v1/coupons
 *
 * 租戶隔離：一律用 request.tenantPrisma（已綁租戶的連線）；需要交易者改收 app.prisma
 * 並走 withTenant。⚠️ 券系統任何地方都不得使用 prismaAdmin（BYPASSRLS）。
 */
import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../../guards/rbac.guard.js';
import {
  listCoupons,
  getCoupon,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  CouponValidationError,
  type CouponInput,
} from './coupon.service.js';
import { changeStatus } from './coupon-lifecycle.service.js';
import { issueCoupons } from './coupon-issue.service.js';
import { redeemCoupon } from './coupon-redeem.service.js';
import { importCodes, previewImport, removeAvailableCode } from './coupon-import.service.js';
import {
  getCouponStats,
  listInstances,
  exportInstancesCsv,
  getBulkRedeemCounts,
} from './coupon-stats.service.js';

/** 驗證錯誤轉 400 並帶可讀訊息；其餘往上拋，交給全域錯誤處理回 500。 */
function handleError(err: unknown, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) {
  if (err instanceof CouponValidationError) {
    return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: err.message } });
  }
  throw err;
}

export default async function couponRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', { preHandler: [requirePermission('coupon.view')] }, async (request) => {
    const { status, purpose, q, page, limit } = request.query as Record<string, string>;
    const result = await listCoupons(request.tenantPrisma, request.agent.tenantId, {
      status,
      purpose,
      q,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return {
      success: true,
      data: result.items,
      meta: { total: result.total, page: result.page, limit: result.limit },
    };
  });

  app.get('/:id', { preHandler: [requirePermission('coupon.view')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const coupon = await getCoupon(request.tenantPrisma, request.agent.tenantId, id);
    if (!coupon) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此券' } });
    }
    return { success: true, data: coupon };
  });

  app.post('/', { preHandler: [requirePermission('coupon.manage')] }, async (request, reply) => {
    try {
      const coupon = await createCoupon(
        request.tenantPrisma,
        request.agent.tenantId,
        request.agent.id,
        request.body as CouponInput,
      );
      return { success: true, data: coupon };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.patch('/:id', { preHandler: [requirePermission('coupon.manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const coupon = await updateCoupon(
        request.tenantPrisma,
        request.agent.tenantId,
        id,
        request.body as CouponInput,
      );
      if (!coupon) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此券' } });
      }
      return { success: true, data: coupon };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.delete('/:id', { preHandler: [requirePermission('coupon.manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await deleteCoupon(request.tenantPrisma, request.agent.tenantId, id);
    if (!result.deleted) {
      if (result.reason === 'NOT_FOUND') {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此券' } });
      }
      return reply.status(409).send({
        success: false,
        error: { code: 'HAS_INSTANCES', message: `此券已發出 ${result.issued} 張，無法刪除。請改為結束此券。` },
      });
    }
    return { success: true };
  });

  // 狀態流轉。分成獨立端點而非 PATCH status，讓權限與稽核能對應到具體動作
  for (const [path, next] of [
    ['publish', 'ACTIVE'],
    ['pause', 'PAUSED'],
    ['resume', 'ACTIVE'],
    ['end', 'ENDED'],
  ] as const) {
    app.post(`/:id/${path}`, { preHandler: [requirePermission('coupon.manage')] }, async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const result = await changeStatus(request.tenantPrisma, request.agent.tenantId, id, next);
        if (!result.ok) {
          if (result.reason === 'NOT_FOUND') {
            return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此券' } });
          }
          return reply.status(409).send({ success: false, error: { code: 'INVALID_TRANSITION', message: result.reason } });
        }
        return { success: true };
      } catch (err) {
        return handleError(err, reply);
      }
    });
  }

  app.post('/:id/issue', { preHandler: [requirePermission('coupon.issue')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      contactIds?: string[];
      issuedVia?: string;
      issuedRefId?: string;
      requireClaim?: boolean;
    };
    try {
      const result = await issueCoupons(app.prisma, request.agent.tenantId, id, {
        contactIds: body.contactIds ?? [],
        issuedVia: body.issuedVia ?? 'inbox',
        issuedRefId: body.issuedRefId ?? request.agent.id,
        requireClaim: body.requireClaim,
      });
      return { success: true, data: result };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ── 序號包匯入 ──

  app.post('/:id/codes/preview', { preHandler: [requirePermission('coupon.manage')] }, async (request, reply) => {
    const body = request.body as { codes?: string };
    try {
      const result = await previewImport(app.prisma, request.agent.tenantId, body.codes ?? '');
      return { success: true, data: result };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/:id/codes', { preHandler: [requirePermission('coupon.manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { codes?: string };
    try {
      const result = await importCodes(app.prisma, request.agent.tenantId, id, body.codes ?? '');
      return { success: true, data: result };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.delete('/:id/codes/:code', { preHandler: [requirePermission('coupon.manage')] }, async (request, reply) => {
    const { id, code } = request.params as { id: string; code: string };
    const result = await removeAvailableCode(app.prisma, request.agent.tenantId, id, code);
    if (!result.removed) {
      if (result.reason === 'NOT_FOUND') {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此序號' } });
      }
      return reply.status(409).send({
        success: false,
        error: { code: 'ALREADY_ASSIGNED', message: '此序號已配發給顧客，無法移除' },
      });
    }
    return { success: true };
  });

  // ── 成效與名單 ──

  app.get('/:id/stats', { preHandler: [requirePermission('coupon.view')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const stats = await getCouponStats(request.tenantPrisma, request.agent.tenantId, id);
    if (!stats) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此券' } });
    }
    return { success: true, data: stats };
  });

  app.get('/:id/instances', { preHandler: [requirePermission('coupon.view')] }, async (request) => {
    const { id } = request.params as { id: string };
    const { status, page, limit } = request.query as Record<string, string>;
    const result = await listInstances(request.tenantPrisma, request.agent.tenantId, id, {
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return {
      success: true,
      data: result.items,
      meta: { total: result.total, page: result.page, limit: result.limit },
    };
  });

  app.get('/:id/instances/export', { preHandler: [requirePermission('coupon.view')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const coupon = await getCoupon(request.tenantPrisma, request.agent.tenantId, id);
    if (!coupon) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此券' } });
    }
    const csv = await exportInstancesCsv(request.tenantPrisma, request.agent.tenantId, id);
    // 檔名只保留安全字元，避免券名中的引號或路徑符號破壞 header
    const safeName = coupon.name.replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 40);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="coupon_${safeName}.csv"`)
      .send(csv);
  });

  // 核銷台。掃碼或手動輸入券號皆走此端點
  app.post('/redeem', { preHandler: [requirePermission('coupon.redeem')] }, async (request, reply) => {
    const body = request.body as { code?: string; instanceId?: string; staffCode?: string };
    if (!body.code && !body.instanceId) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: '請提供券號' } });
    }
    const result = await redeemCoupon(app.prisma, request.agent.tenantId, {
      code: body.code,
      instanceId: body.instanceId,
      staffCode: body.staffCode,
      redeemedBy: request.agent.id,
      redeemChannel: 'staff_console',
    });
    if (!result.ok) {
      // 失敗原因逐一對應訊息——店員需要知道為什麼不能用，不是只知道失敗
      const messages: Record<string, string> = {
        NOT_FOUND: '查無此券',
        ALREADY_REDEEMED: '此券已使用',
        EXPIRED: '此券已過期',
        NOT_YET_VALID: '此券尚未生效',
        REVOKED: '此券已作廢',
        NOT_CLAIMED: '此券尚未領取',
        STAFF_CODE_REQUIRED: '請輸入店員驗證碼',
        STAFF_CODE_MISMATCH: '店員驗證碼不正確',
        SELF_REDEEM_NOT_ALLOWED: '此券須由店員核銷',
        CONFLICT: '此券剛被核銷，請重新確認',
      };
      return reply.status(409).send({
        success: false,
        error: {
          code: result.reason,
          message: messages[result.reason] ?? '核銷失敗',
          redeemedAt: result.redeemedAt,
        },
      });
    }
    return { success: true, data: result };
  });
}
