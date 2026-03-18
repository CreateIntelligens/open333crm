import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { suggestReply, summarizeConversation } from './ai.service.js';
import { success } from '../../shared/utils/response.js';

export default async function aiRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // POST /api/v1/ai/suggest-reply
  fastify.post('/suggest-reply', async (request, reply) => {
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.body);

    const result = await suggestReply(fastify.prisma, conversationId);
    return reply.send(success(result));
  });

  // POST /api/v1/ai/summarize
  fastify.post('/summarize', async (request, reply) => {
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.body);

    const result = await summarizeConversation(fastify.prisma, conversationId);
    return reply.send(success(result));
  });
}
