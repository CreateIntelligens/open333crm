import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from './notification.service.js';
import { success, paginated } from '../../shared/utils/response.js';

const listQuerySchema = z.object({
  isRead: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export default async function notificationRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/notifications/unread-count (static path before :id)
  fastify.get('/unread-count', async (request, reply) => {
    const count = await getUnreadCount(
      fastify.prisma,
      request.agent.id,
      request.agent.tenantId,
    );
    return reply.send(success({ count }));
  });

  // GET /api/v1/notifications
  fastify.get('/', async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, isRead } = query;

    const { notifications, total } = await listNotifications(
      fastify.prisma,
      request.agent.id,
      request.agent.tenantId,
      { isRead },
      { page, limit },
    );

    return reply.send(paginated(notifications, total, page, limit));
  });

  // PATCH /api/v1/notifications/:id/read
  fastify.patch<{ Params: { id: string } }>('/:id/read', async (request, reply) => {
    const notification = await markAsRead(
      fastify.prisma,
      request.params.id,
      request.agent.id,
      request.agent.tenantId,
    );
    return reply.send(success(notification));
  });

  // POST /api/v1/notifications/read-all
  fastify.post('/read-all', async (request, reply) => {
    const count = await markAllAsRead(
      fastify.prisma,
      request.agent.id,
      request.agent.tenantId,
    );
    return reply.send(success({ updated: count }));
  });
}
