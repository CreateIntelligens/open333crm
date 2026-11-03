import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { success } from '../../shared/utils/response.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import type { EventPublisher } from '../../events/outbox-publisher.js';
import { actorOf } from '../../lib/request-actor.js';
import { getExportDownloadFlow, getExportRequestFlow, requestExportFlow } from './data-export.flow.js';

const createBodySchema = z.object({
  // 匯出範圍：可指定資料類型陣列（如 ['contacts','cases']）；未給＝全部。
  scope: z.array(z.string()).optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

/**
 * 匯出內容是全租戶的資料（所有渠道的聯絡人、對話、訊息、工單），不依成員的渠道可見範圍篩選。
 * 所以發起、查詢與下載除了 data.export，還要持有 channel.view_all（可查看所有渠道），
 * 避免只看得到某家分店的角色一次拿走所有分店的客戶資料（#428）。
 */
const EXPORT_GUARDS = [
  requirePermission('data.export'),
  requirePermission(
    'channel.view_all',
    '資料匯出會匯出全租戶（所有渠道）的資料，需要同時具備「檢視所有渠道」權限。如需使用請聯繫管理員。',
  ),
];

export interface DataExportRoutesOptions {
  /** 測試用：取代寫 outbox 的 publisher */
  events?: EventPublisher;
}

export default async function dataExportRoutes(fastify: FastifyInstance, opts: DataExportRoutesOptions = {}) {
  fastify.addHook('preHandler', fastify.authenticate);

  // 發起資料匯出（建 pending + 寫稽核 + 匯出工作寫進 outbox）
  fastify.post('/', { preHandler: EXPORT_GUARDS }, async (request) => {
    const body = createBodySchema.parse(request.body ?? {});
    const req = await requestExportFlow({ prisma: fastify.prisma, events: opts.events }, actorOf(request), {
      scope: body.scope,
    });
    return success(req);
  });

  // 查匯出請求狀態
  fastify.get('/:id', { preHandler: EXPORT_GUARDS }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const req = await getExportRequestFlow(fastify, actorOf(request).tenantId, id);
    return success(req);
  });

  // 下載已完成的匯出檔（短時效 presigned URL，downloadCount++）
  fastify.get(
    '/:id/download',
    { preHandler: EXPORT_GUARDS },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const result = await getExportDownloadFlow(fastify, actorOf(request).tenantId, id);
      return success(result);
    },
  );
}
