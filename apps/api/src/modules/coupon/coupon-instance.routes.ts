/**
 * 單一優惠券的成效與已發出序號（後台詳情頁）。Prefix: /api/v1/coupons
 *
 * 與 coupon.routes.ts 同前綴，但只處理「已發出的券」這個子資源，避免單一路由檔超過結構規則 3 的上限。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../../guards/rbac.guard.js';
import { getCoupon } from './coupon.service.js';
import { getCouponStats, listInstances, exportInstancesCsv } from './coupon-stats.service.js';

const date = z.coerce.date({ errorMap: () => ({ message: '日期格式不正確' }) });

const instanceQuerySchema = z.object({
  q: z.string().optional(),
  status: z.enum(['ISSUED', 'CLAIMED', 'OPENED', 'REDEEMED', 'EXPIRED', 'REVOKED']).optional(),
  claimedFrom: date.optional(),
  claimedTo: date.optional(),
  redeemedFrom: date.optional(),
  redeemedTo: date.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export default async function couponInstanceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

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
    const query = instanceQuerySchema.parse(request.query);
    const result = await listInstances(request.tenantPrisma, request.agent.tenantId, id, query);
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
}
