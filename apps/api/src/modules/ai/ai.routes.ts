import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { suggestReply, summarizeConversation } from './ai.service.js';
import { analyzeSentiment } from './sentiment.service.js';
import { classifyIssue } from './classify.service.js';
import { success } from '../../shared/utils/response.js';

export default async function aiRoutes(fastify: FastifyInstance) {
  // TODO(rls): 本模組服務（suggestReply/summarize/analyzeSentiment/classify）會把 prisma
  // 傳入 embedding/llm 等尚未改造為 TenantDb 的跨模組服務；待相依服務全數放寬後，
  // 再一併改走 request.tenantPrisma。目前維持 fastify.prisma。
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

  // POST /api/v1/ai/analyze-sentiment
  fastify.post('/analyze-sentiment', async (request, reply) => {
    const { text } = z
      .object({ text: z.string().min(1) })
      .parse(request.body);

    const result = await analyzeSentiment(fastify.prisma, request.agent.tenantId, text);
    return reply.send(success(result));
  });

  // POST /api/v1/ai/classify
  fastify.post('/classify', async (request, reply) => {
    const { text } = z
      .object({ text: z.string().min(1) })
      .parse(request.body);

    const result = await classifyIssue(fastify.prisma, request.agent.tenantId, text);
    return reply.send(success(result));
  });
}
