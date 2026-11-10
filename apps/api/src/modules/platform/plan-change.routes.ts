/**
 * 租戶側方案升級/加購申請路由（租戶認證）。
 * 平台側審核路由在 platform.routes.ts（平台 superuser 認證）。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { success } from '../../shared/utils/response.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import { listTenantPlanChangeRequests } from './plan-change.service.js';
import { submitPlanChangeRequest } from './plan-change.flow.js';

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
    return success(await listTenantPlanChangeRequests(fastify.prismaAdmin, request.agent.tenantId));
  });

  // POST /api/v1/plan-change — 發起申請。寄信通知平台帳號在背景進行，不等寄完才回應
  // （change add-plan-change-platform-notify；結果寫進平台稽核 plan_change.notify_platform）
  fastify.post('/', async (request) => {
    const body = createSchema.parse(request.body);
    const { request: created } = await submitPlanChangeRequest(
      { prisma: fastify.prismaAdmin },
      request.agent.tenantId,
      body,
    );
    return success(created);
  });
}
