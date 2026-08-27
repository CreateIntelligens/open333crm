import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success } from '../../shared/utils/response.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import {
  requestExport,
  getExportRequest,
  getExportDownload,
} from './data-export.service.js';

const createBodySchema = z.object({
  // 匯出範圍：可指定資料類型陣列（如 ['contacts','cases']）；未給＝全部。
  scope: z.array(z.string()).optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

export default async function dataExportRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // 發起資料匯出（建 pending + 寫稽核 + 入列 job）
  fastify.post('/', { preHandler: [requirePermission('data.export')] }, async (request) => {
    const body = createBodySchema.parse(request.body ?? {});
    const req = await requestExport(request.tenantPrisma, {
      tenantId: request.agent.tenantId,
      requestedBy: request.agent.id,
      scope: body.scope,
      ip: request.ip,
    });
    return success(req);
  });

  // 查匯出請求狀態
  fastify.get('/:id', { preHandler: [requirePermission('data.export')] }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const req = await getExportRequest(request.tenantPrisma, request.agent.tenantId, id);
    return success(req);
  });

  // 下載已完成的匯出檔（短時效 presigned URL，downloadCount++）
  fastify.get(
    '/:id/download',
    { preHandler: [requirePermission('data.export')] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const result = await getExportDownload(request.tenantPrisma, request.agent.tenantId, id);
      return success(result);
    },
  );
}
