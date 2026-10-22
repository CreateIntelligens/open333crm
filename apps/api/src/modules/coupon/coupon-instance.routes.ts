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
  recordExportNotice,
  startBackgroundExport,
} from './coupon-export.service.js';
import { getBindingStore, type BindingStore } from '../identity-binding/binding-code.js';
import { inTenant, tenantHandler, type TenantCtx, type TenantReply } from '../../lib/tenant-ctx.js';
import { createOutboxPublisher } from '../../events/outbox-publisher.js';

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

function notFound(reply: TenantReply) {
  reply.code(404);
  return { success: false, error: { code: 'NOT_FOUND', message: '查無此券' } };
}

export default async function couponInstanceRoutes(app: FastifyInstance, opts: CouponInstanceRoutesOptions = {}) {
  const exportStore = () => opts.exportStore ?? getBindingStore();
  const syncLimit = opts.exportSyncLimit ?? EXPORT_SYNC_LIMIT;

  app.addHook('preHandler', app.authenticate);

  // ── 成效與名單 ──

  app.get('/:id/stats', { preHandler: [requirePermission('coupon.view')] }, tenantHandler(app, async (request, reply, ctx) => {
    const { id } = idParams.parse(request.params);
    const stats = await getCouponStats(ctx, id);
    if (!stats) return notFound(reply);
    return { success: true, data: stats };
  }));

  app.get('/:id/instances', { preHandler: [requirePermission('coupon.view')] }, tenantHandler(app, async (request, _reply, ctx) => {
    const { id } = idParams.parse(request.params);
    const query = instanceQuerySchema.parse(request.query);
    const result = await listInstances(ctx, id, query);
    return {
      success: true,
      data: result.items,
      meta: { total: result.total, page: result.page, limit: result.limit },
    };
  }));

  app.get('/:id/instances/export', { preHandler: [requirePermission('coupon.view')] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { tenantId, id: agentId } = request.agent;
    const runInTenant = <T>(fn: (ctx: TenantCtx) => Promise<T>) =>
      inTenant({ prisma: app.prisma, io: app.io, events: createOutboxPublisher(app.prisma) }, tenantId, fn);

    const found = await runInTenant(async (ctx) => {
      const coupon = await getCoupon(ctx, id);
      return coupon ? { name: coupon.name, count: await countInstances(ctx, id) } : null;
    });
    if (!found) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此券' } });

    // 明細太多時改背景產生，完成後以站內通知告知（design D22）
    if (found.count > syncLimit) {
      const { jobId } = startBackgroundExport(
        {
          store: exportStore(),
          notify: (notice) => runInTenant((ctx) => recordExportNotice(ctx, notice)),
          runInTenant,
          beforeGenerate: opts.beforeBackgroundExport,
        },
        { tenantId, agentId, couponId: id, couponName: found.name, fileName: found.name },
      );
      return reply.status(202).send({ success: true, data: { mode: 'background', jobId } });
    }
    // 同步匯出也分頁讀，每頁一個交易，避開 5 秒的交易時限
    const csv = await exportInstancesCsv(runInTenant, id);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', csvDisposition(found.name))
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
