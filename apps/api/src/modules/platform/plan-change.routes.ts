/**
 * 租戶側方案升級/加購申請路由（租戶認證）。
 * 平台側審核路由在 platform.routes.ts（平台 superuser 認證）。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success } from '../../shared/utils/response.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import {
  createPlanChangeRequest,
  listTenantPlanChangeRequests,
} from './plan-change.service.js';

const createSchema = z.object({
  type: z.enum(['upgrade', 'token_topup']),
  targetPlanSlug: z.string().optional(),
  topupTokens: z.number().int().positive().optional(),
  note: z.string().max(500).optional(),
});

export default async function planChangeRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);
  // 需要方案管理相關權限（沿用 settings.manage：能改設定者可發起升級）
  fastify.addHook('preHandler', requirePermission('settings.manage'));

  // GET /api/v1/plan-change — 查自己的申請
  fastify.get('/', async (request) => {
    return success(await listTenantPlanChangeRequests(fastify.prisma, request.agent.tenantId));
  });

  // POST /api/v1/plan-change — 發起申請
  fastify.post('/', async (request) => {
    const body = createSchema.parse(request.body);
    return success(await createPlanChangeRequest(fastify.prisma, request.agent.tenantId, body));
  });
}
