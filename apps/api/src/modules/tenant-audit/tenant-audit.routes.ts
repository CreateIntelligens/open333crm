import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success } from '../../shared/utils/response.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import { listTenantAudit } from './tenant-audit.service.js';

const listQuerySchema = z.object({
  action: z.string().optional(),
  actorId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export default async function tenantAuditRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // 租戶操作稽核查詢（分頁 + 篩選，一律 tenantId scoped）
  fastify.get('/', { preHandler: [requirePermission('audit.view')] }, async (request) => {
    const q = listQuerySchema.parse(request.query);
    const result = await listTenantAudit(request.tenantPrisma, {
      tenantId: request.agent.tenantId,
      action: q.action,
      actorId: q.actorId,
      from: q.from,
      to: q.to,
      page: q.page,
      pageSize: q.pageSize,
    });
    return success(result);
  });
}
