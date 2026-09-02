import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { suggestReply, summarizeConversation } from './ai.service.js';
import { analyzeSentiment } from './sentiment.service.js';
import { classifyIssue } from './classify.service.js';
import { rewriteText } from './flex-ai.service.js';
import { success } from '../../shared/utils/response.js';
import { runAgentReply } from './agent/agent.service.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import { getConfig } from '../../config/env.js';
import { AppError } from '../../shared/utils/response.js';

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

  // POST /api/v1/ai/agent/run — manually run the tenant-scoped Agent.
  fastify.post('/agent/run', { preHandler: requirePermission('inbox.reply') }, async (request, reply) => {
    const config = getConfig();
    if (!config.AGENTIC_LLM_ENABLED) {
      throw new AppError('Agentic LLM is disabled', 'SERVICE_UNAVAILABLE', 503);
    }
    const data = z.object({
      userMessage: z.string().trim().min(1).max(20_000),
      conversationId: z.string().uuid().optional(),
    }).parse(request.body);
    const result = await runAgentReply(request.tenantPrisma, {
      tenantId: request.agent.tenantId,
      userMessage: data.userMessage,
      conversationId: data.conversationId,
      initiatedById: request.agent.id,
      canPublishWiki: config.AGENT_WIKI_AUTO_PUBLISH,
    });
    return reply.send(success(result));
  });

  // GET /api/v1/ai/agent/runs/:id — inspect bounded Agent trace.
  fastify.get('/agent/runs/:id', { preHandler: requirePermission('inbox.view') }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const run = await request.tenantPrisma.agentRun.findFirst({
      where: { id: params.id, tenantId: request.agent.tenantId },
      select: {
        id: true, status: true, provider: true, model: true, finalText: true,
        stopReason: true, turnCount: true, toolCallCount: true, expiresAt: true,
        completedAt: true, createdAt: true,
        toolCalls: {
          orderBy: { turn: 'asc' },
          select: { id: true, turn: true, toolName: true, arguments: true, result: true, status: true, durationMs: true, createdAt: true },
        },
      },
    });
    if (!run) return reply.status(404).send({ code: 'NOT_FOUND', message: 'Agent run not found' });
    return reply.send(success(run));
  });
}
