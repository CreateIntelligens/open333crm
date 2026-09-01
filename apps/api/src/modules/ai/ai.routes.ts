import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { suggestReply, summarizeConversation } from './ai.service.js';
import { analyzeSentiment } from './sentiment.service.js';
import { classifyIssue } from './classify.service.js';
import { rewriteText } from './flex-ai.service.js';
import { success } from '../../shared/utils/response.js';

export default async function aiRoutes(fastify: FastifyInstance) {
  // 傳入 embedding/llm 等尚未改造為 TenantDb 的跨模組服務；待相依服務全數放寬後，
  fastify.addHook('preHandler', fastify.authenticate);

  // POST /api/v1/ai/suggest-reply
  fastify.post('/suggest-reply', async (request, reply) => {
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.body);

    const result = await suggestReply(request.tenantPrisma, conversationId);
    return reply.send(success(result));
  });

  // POST /api/v1/ai/summarize
  fastify.post('/summarize', async (request, reply) => {
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.body);

    const result = await summarizeConversation(request.tenantPrisma, conversationId);
    return reply.send(success(result));
  });

  // POST /api/v1/ai/analyze-sentiment
  fastify.post('/analyze-sentiment', async (request, reply) => {
    const { text } = z
      .object({ text: z.string().min(1) })
      .parse(request.body);

    const result = await analyzeSentiment(request.tenantPrisma, request.agent.tenantId, text);
    return reply.send(success(result));
  });

  // POST /api/v1/ai/classify
  fastify.post('/classify', async (request, reply) => {
    const { text } = z
      .object({ text: z.string().min(1) })
      .parse(request.body);

    const result = await classifyIssue(request.tenantPrisma, request.agent.tenantId, text);
    return reply.send(success(result));
  });

  // POST /api/v1/ai/rewrite — 文字潤稿 / 縮短 / 改語氣（填空編輯器 text 欄位用）
  fastify.post('/rewrite', async (request, reply) => {
    const { text, action } = z
      .object({
        text: z.string().min(1).max(2000),
        action: z.enum(['polish', 'shorten', 'tone']),
      })
      .parse(request.body);

    const result = await rewriteText(request.tenantPrisma, request.agent.tenantId, text, action);
    return reply.send(success({ text: result }));
  });
}
