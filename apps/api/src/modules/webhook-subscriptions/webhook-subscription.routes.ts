import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success } from '../../shared/utils/response.js';
import { requireAdmin, requireSupervisor } from '../../guards/rbac.guard.js';
import {
  listSubscriptions,
  getSubscription,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  listDeliveries,
} from './webhook-subscription.service.js';
import { dispatchWebhook } from './webhook-dispatcher.js';

const createSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().optional(),
  isActive: z.boolean().optional(),
});

const updateSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.string()).min(1).optional(),
  secret: z.string().optional(),
  isActive: z.boolean().optional(),
});

export default async function webhookSubscriptionRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/webhook-subscriptions
  fastify.get('/', { preHandler: requireSupervisor() }, async (request, reply) => {
    const subs = await listSubscriptions(fastify.prisma, request.agent.tenantId);
    return reply.send(success(subs));
  });

  // GET /api/v1/webhook-subscriptions/:id
  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: requireSupervisor() }, async (request, reply) => {
    const sub = await getSubscription(fastify.prisma, request.params.id, request.agent.tenantId);
    return reply.send(success(sub));
  });

  // POST /api/v1/webhook-subscriptions
  fastify.post('/', { preHandler: requireAdmin() }, async (request, reply) => {
    const data = createSchema.parse(request.body);
    const sub = await createSubscription(fastify.prisma, request.agent.tenantId, data);
    return reply.status(201).send(success(sub));
  });

  // PATCH /api/v1/webhook-subscriptions/:id
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const data = updateSchema.parse(request.body);
    const sub = await updateSubscription(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
      data,
    );
    return reply.send(success(sub));
  });

  // DELETE /api/v1/webhook-subscriptions/:id
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: requireAdmin() }, async (request, reply) => {
    const result = await deleteSubscription(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(result));
  });

  // GET /api/v1/webhook-subscriptions/:id/deliveries
  fastify.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/:id/deliveries',
    async (request, reply) => {
      const limit = parseInt(request.query.limit || '50', 10);
      const deliveries = await listDeliveries(
        fastify.prisma,
        request.params.id,
        request.agent.tenantId,
        limit,
      );
      return reply.send(success(deliveries));
    },
  );

  // POST /api/v1/webhook-subscriptions/:id/test — send a test event
  fastify.post<{ Params: { id: string } }>('/:id/test', async (request, reply) => {
    const sub = await getSubscription(fastify.prisma, request.params.id, request.agent.tenantId);

    const testPayload = {
      event: 'webhook.test',
      tenantId: request.agent.tenantId,
      timestamp: new Date().toISOString(),
      data: { message: 'This is a test webhook delivery' },
    };

    const result = await dispatchWebhook(
      fastify.prisma,
      sub.id,
      sub.url,
      sub.secret,
      'webhook.test',
      testPayload,
    );

    return reply.send(success(result));
  });
}
