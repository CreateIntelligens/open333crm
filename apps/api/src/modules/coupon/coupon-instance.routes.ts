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
import {
  EXPORT_SYNC_LIMIT,
  countInstances,
  readExportFile,
  startBackgroundExport,
  type ExportNotice,
} from './coupon-export.service.js';
import { getBindingStore, type BindingStore } from '../identity-binding/binding-code.js';
import { createAndDispatch } from '../notification/notification.service.js';
import { withTenant } from '../../lib/tenant-db.js';

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

/** 券 id：格式不對直接回 400，不讓資料庫丟錯 */
const idParams = z.object({ id: z.string().uuid('券識別格式不正確') });

export interface CouponInstanceRoutesOptions {
  /** 測試用：直接下載的筆數上限、檔案儲存、背景產生前的掛勾 */
  exportSyncLimit?: number;
  exportStore?: BindingStore;
  beforeBackgroundExport?: () => Promise<void>;
}

/** 下載檔名：只保留安全字元。HTTP 標頭只能放 Latin-1，中文檔名放在 filename*（RFC 5987） */
function csvDisposition(couponName: string): string {
  const safeName = couponName.replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 40);
  return `attachment; filename="coupon.csv"; filename*=UTF-8''${encodeURIComponent(`coupon_${safeName}.csv`)}`;
}

export default async function couponInstanceRoutes(app: FastifyInstance, opts: CouponInstanceRoutesOptions = {}) {
  const exportStore = () => opts.exportStore ?? getBindingStore();
  const syncLimit = opts.exportSyncLimit ?? EXPORT_SYNC_LIMIT;

  app.addHook('preHandler', app.authenticate);

  // ── 成效與名單 ──

  app.get('/:id/stats', { preHandler: [requirePermission('coupon.view')] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const stats = await getCouponStats(request.tenantPrisma, request.agent.tenantId, id);
    if (!stats) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此券' } });
    }
    return { success: true, data: stats };
  });

  app.get('/:id/instances', { preHandler: [requirePermission('coupon.view')] }, async (request) => {
    const { id } = idParams.parse(request.params);
    const query = instanceQuerySchema.parse(request.query);
    const result = await listInstances(request.tenantPrisma, request.agent.tenantId, id, query);
    return {
      success: true,
      data: result.items,
      meta: { total: result.total, page: result.page, limit: result.limit },
    };
  });

  app.get('/:id/instances/export', { preHandler: [requirePermission('coupon.view')] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const coupon = await getCoupon(request.tenantPrisma, request.agent.tenantId, id);
    if (!coupon) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此券' } });
    }
    const { tenantId, id: agentId } = request.agent;
    // 明細太多時改背景產生，完成後以站內通知告知（design D22）
    if ((await countInstances(request.tenantPrisma, tenantId, id)) > syncLimit) {
      const notify = (notice: ExportNotice) =>
        withTenant(app.prisma, notice.tenantId, (tx) => createAndDispatch(tx, app.io, notice)).then(() => undefined);
      const { jobId } = startBackgroundExport(
        app.prisma,
        { store: exportStore(), notify, beforeGenerate: opts.beforeBackgroundExport },
        { tenantId, agentId, couponId: id, couponName: coupon.name, fileName: coupon.name },
      );
      return reply.status(202).send({ success: true, data: { mode: 'background', jobId } });
    }
    const csv = await exportInstancesCsv(request.tenantPrisma, tenantId, id);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', csvDisposition(coupon.name))
      .send(csv);
  });

  // 下載背景產生的序號明細：只有匯出者本人
  app.get('/export-jobs/:jobId/download', { preHandler: [requirePermission('coupon.view')] }, async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string().max(64) }).parse(request.params);
    const file = await readExportFile(exportStore(), jobId, { tenantId: request.agent.tenantId, agentId: request.agent.id });
    if (file.status === 'not_found') {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此匯出檔' } });
    }
    if (file.status === 'expired') {
      return reply.status(410).send({ success: false, error: { code: 'EXPORT_EXPIRED', message: '匯出檔已過期，請回到優惠券頁重新匯出' } });
    }
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', csvDisposition(file.fileName))
      .send(file.csv);
  });
}
