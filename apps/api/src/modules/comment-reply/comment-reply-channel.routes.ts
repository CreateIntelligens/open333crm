/**
 * 留言自動私訊的渠道端（change add-comment-keyword-private-reply design「API」、D19、D25，前綴 /api/v1/comment-replies）。
 *
 * GET    /readiness                               前置條件（comment_reply.view）
 * GET    /channels/:channelId/posts               最近貼文（comment_reply.manage）
 * POST   /channels/:channelId/posts/resolve       以網址找貼文（manage；只呼叫 Graph API）
 * POST   /channels/:channelId/subscribe-comments  開啟留言接收（channel.update＋comment_reply.view）
 * DELETE /channels/:channelId/subscribe-comments  關閉留言接收（同上）
 */
import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../../guards/rbac.guard.js';
import { actorOf } from '../../lib/request-actor.js';
import { success } from '../../shared/utils/response.js';
import { COMMENT_REPLY_MANAGE, COMMENT_REPLY_VIEW, viewerOf } from './comment-reply-request.js';
import {
  listPostsFlow,
  readinessFlow,
  resolvePostFlow,
  setCommentReceivingFlow,
  type CommentReplyFlowDeps,
} from './comment-reply.flow.js';
import type { CommentReplyRoutesOptions } from './comment-reply-rule.routes.js';
import { channelIdParamSchema, parseWithField, postsQuerySchema, resolvePostSchema } from './comment-reply.schemas.js';

export default async function commentReplyChannelRoutes(fastify: FastifyInstance, opts: CommentReplyRoutesOptions = {}) {
  const deps = (): CommentReplyFlowDeps => ({ prisma: fastify.prisma, redis: fastify.redis, events: opts.events });
  const view = { preHandler: [fastify.authenticate, requirePermission(COMMENT_REPLY_VIEW)] };
  const manage = { preHandler: [fastify.authenticate, requirePermission(COMMENT_REPLY_MANAGE)] };
  // 開關留言接收會改粉專在 Meta 的訂閱：要渠道修改權限，comment_reply.view 確認方案含此功能
  const subscribe = {
    preHandler: [fastify.authenticate, requirePermission('channel.update'), requirePermission(COMMENT_REPLY_VIEW)],
  };

  fastify.get('/readiness', view, async (request) => {
    return success(await readinessFlow(deps(), actorOf(request), await viewerOf(request)));
  });

  fastify.get('/channels/:channelId/posts', manage, async (request) => {
    const { channelId } = parseWithField(channelIdParamSchema, request.params);
    const { cursor } = parseWithField(postsQuerySchema, request.query);
    return success(await listPostsFlow(deps(), actorOf(request), await viewerOf(request), channelId, cursor));
  });

  fastify.post('/channels/:channelId/posts/resolve', manage, async (request) => {
    const { channelId } = parseWithField(channelIdParamSchema, request.params);
    const { url } = parseWithField(resolvePostSchema, request.body);
    return success(await resolvePostFlow(deps(), actorOf(request), await viewerOf(request), channelId, url));
  });

  fastify.post('/channels/:channelId/subscribe-comments', subscribe, async (request) => {
    const { channelId } = parseWithField(channelIdParamSchema, request.params);
    return success(await setCommentReceivingFlow(deps(), actorOf(request), await viewerOf(request), channelId, true));
  });

  fastify.delete('/channels/:channelId/subscribe-comments', subscribe, async (request) => {
    const { channelId } = parseWithField(channelIdParamSchema, request.params);
    return success(await setCommentReceivingFlow(deps(), actorOf(request), await viewerOf(request), channelId, false));
  });
}
