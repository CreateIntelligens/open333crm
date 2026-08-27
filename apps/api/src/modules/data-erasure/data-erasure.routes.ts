/**
 * GDPR 資料刪除（被遺忘權）路由。
 *
 * POST /        建立刪除請求（anonymize | hard_delete）→ 非同步處理
 * GET  /:id     查刪除請求狀態
 *
 * 全部需 data.erase 權限。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success, AppError } from '../../shared/utils/response.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import { requestErasure, getErasureRequest } from './data-erasure.service.js';

const createSchema = z.object({
  contactId: z.string().uuid(),
  mode: z.enum(['anonymize', 'hard_delete']).default('anonymize'),
  reason: z.string().max(1000).optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

export default async function dataErasureRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // 建立刪除請求（非同步走 worker）
  fastify.post('/', { preHandler: [requirePermission('data.erase')] }, async (request) => {
    const body = createSchema.parse(request.body);
    const erasure = await requestErasure(request.tenantPrisma, {
      tenantId: request.agent.tenantId,
      requestedBy: request.agent.id,
      contactId: body.contactId,
      mode: body.mode,
      reason: body.reason,
    });
    return success(erasure);
  });

  // 查刪除請求狀態
  fastify.get('/:id', { preHandler: [requirePermission('data.erase')] }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const erasure = await getErasureRequest(request.tenantPrisma, request.agent.tenantId, id);
    if (!erasure) {
      throw new AppError('刪除請求不存在', 'ERASURE_REQUEST_NOT_FOUND', 404);
    }
    return success(erasure);
  });
}
