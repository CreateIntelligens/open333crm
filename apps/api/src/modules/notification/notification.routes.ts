import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { actorOf } from '../../lib/request-actor.js';
import {
  getUnreadCountFlow,
  listNotificationsFlow,
  markAllAsReadFlow,
  markAsReadFlow,
} from './notification.flow.js';
import { success, paginated } from '../../shared/utils/response.js';

const listQuerySchema = z.object({
  isRead: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

export default async function notificationRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);
  const deps = { prisma: fastify.prisma };

  // GET /api/v1/notifications/unread-count (static path before :id)
  fastify.get('/unread-count', async (request, reply) => {
    const actor = actorOf(request);
    const count = await getUnreadCountFlow(deps, actor.tenantId, actor.agentId);
    return reply.send(success({ count }));
  });

  // GET /api/v1/notifications
  fastify.get('/', async (request, reply) => {
    const actor = actorOf(request);
    const { page, limit, isRead } = listQuerySchema.parse(request.query);

    const { notifications, total } = await listNotificationsFlow(deps, actor.tenantId, actor.agentId, { isRead }, { page, limit });

    return reply.send(paginated(notifications, total, page, limit));
  });

  // PATCH /api/v1/notifications/:id/read
  fastify.patch('/:id/read', async (request, reply) => {
    const actor = actorOf(request);
    const { id } = idParamsSchema.parse(request.params);
    const notification = await markAsReadFlow(deps, actor.tenantId, id, actor.agentId);
    return reply.send(success(notification));
  });

  // POST /api/v1/notifications/read-all
  fastify.post('/read-all', async (request, reply) => {
    const actor = actorOf(request);
    const count = await markAllAsReadFlow(deps, actor.tenantId, actor.agentId);
    return reply.send(success({ updated: count }));
  });
}
