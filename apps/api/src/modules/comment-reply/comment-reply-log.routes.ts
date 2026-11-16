/**
 * 觸發紀錄（change add-comment-keyword-private-reply design「API」，前綴 /api/v1/comment-replies）。
 *
 * GET  /logs              查詢（comment_reply.view；status 可重複、cursor 分頁；countOnly＋since 回新紀錄數）
 * GET  /logs/summary      各狀態筆數＋failed24h（view）
 * GET  /logs/:id          詳情（view；conversationId 只在有 inbox.view 時回傳）
 * POST /logs/:id/retry    手動重試（comment_reply.manage；202 { status: 'PENDING' }）
 */
import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../../guards/rbac.guard.js';
import { actorOf } from '../../lib/request-actor.js';
import { success } from '../../shared/utils/response.js';
import { COMMENT_REPLY_MANAGE, COMMENT_REPLY_VIEW, viewerOf } from './comment-reply-request.js';
import { getLogFlow, listLogsFlow, retryLogFlow, summarizeLogsFlow, type CommentReplyFlowDeps } from './comment-reply.flow.js';
import type { CommentReplyRoutesOptions } from './comment-reply-rule.routes.js';
import { idParamSchema, parseLogsQuery, parseWithField } from './comment-reply.schemas.js';

export default async function commentReplyLogRoutes(fastify: FastifyInstance, opts: CommentReplyRoutesOptions = {}) {
  const deps = (): CommentReplyFlowDeps => ({ prisma: fastify.prisma, redis: fastify.redis, events: opts.events });
  const view = { preHandler: [fastify.authenticate, requirePermission(COMMENT_REPLY_VIEW)] };
  const manage = { preHandler: [fastify.authenticate, requirePermission(COMMENT_REPLY_MANAGE)] };

  fastify.get('/logs', view, async (request) => {
    const query = parseLogsQuery(request.query);
    return success(await listLogsFlow(deps(), actorOf(request), await viewerOf(request), query));
  });

  fastify.get('/logs/summary', view, async (request) => {
    const query = parseLogsQuery(request.query);
    return success(await summarizeLogsFlow(deps(), actorOf(request), await viewerOf(request), query));
  });

  fastify.get('/logs/:id', view, async (request) => {
    const { id } = parseWithField(idParamSchema, request.params);
    return success(await getLogFlow(deps(), actorOf(request), await viewerOf(request), id));
  });

  fastify.post('/logs/:id/retry', manage, async (request, reply) => {
    const { id } = parseWithField(idParamSchema, request.params);
    const result = await retryLogFlow(deps(), actorOf(request), await viewerOf(request), id);
    return reply.status(202).send(success(result));
  });
}
