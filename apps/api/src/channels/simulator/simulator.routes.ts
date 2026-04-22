import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { simulateInboundMessage } from './simulator.service.js';
import { success } from '../../shared/utils/response.js';
import { CHANNEL_TYPE } from '@open333crm/shared';

const sendMessageSchema = z.object({
  channelType: z.enum([CHANNEL_TYPE.LINE, CHANNEL_TYPE.FB, CHANNEL_TYPE.WEBCHAT, CHANNEL_TYPE.WHATSAPP] as [string, ...string[]]),
  channelId: z.string().uuid(),
  contactUid: z.string().min(1),
  contactName: z.string().optional(),
  contentType: z.string().default('text'),
  content: z.record(z.unknown()),
});

export default async function simulatorRoutes(fastify: FastifyInstance) {
  // All simulator routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // POST /api/v1/simulator/send-message
  fastify.post('/send-message', async (request, reply) => {
    const data = sendMessageSchema.parse(request.body);

    const result = await simulateInboundMessage(
      fastify.prisma,
      fastify.io,
      request.agent.tenantId,
      data,
    );

    return reply.status(201).send(success(result));
  });
}
