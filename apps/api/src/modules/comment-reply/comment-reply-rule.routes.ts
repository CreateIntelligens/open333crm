/**
 * 留言規則（change add-comment-keyword-private-reply design「API」，前綴 /api/v1/comment-replies）。
 *
 * GET    /rules                 規則列表（comment_reply.view；依渠道可見範圍）
 * GET    /rules/:id             單一規則（view）
 * POST   /rules                 建立（comment_reply.manage）
 * PATCH  /rules/:id             修改（manage；帶 channelId → 400 CHANNEL_IMMUTABLE）
 * PATCH  /rules/:id/active      啟用切換（manage）
 * PUT    /rules/order           排序（manage）
 * DELETE /rules/:id             軟刪除（manage）
 * POST   /rules/test            試算（view；不建立紀錄、不呼叫 Meta）
 * GET    /material-options      素材選項（manage；不需要 marketing.view，design D20）
 *
 * 全部 authenticate → requirePermission（含方案天花板）→ Zod → flow；route 不查資料庫（結構規則 1）。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { requirePermission } from '../../guards/rbac.guard.js';
import { actorOf } from '../../lib/request-actor.js';
import { success } from '../../shared/utils/response.js';
import type { EventPublisher } from '../../events/outbox-publisher.js';
import { COMMENT_REPLY_MANAGE, COMMENT_REPLY_VIEW, viewerOf } from './comment-reply-request.js';
import {
  createRuleFlow,
  deleteRuleFlow,
  getRuleFlow,
  listMaterialOptionsFlow,
  listRulesFlow,
  reorderRulesFlow,
  setRuleActiveFlow,
  testRulesFlow,
  updateRuleFlow,
  type CommentReplyFlowDeps,
} from './comment-reply.flow.js';
import {
  idParamSchema,
  materialOptionsQuerySchema,
  parseReorderInput,
  parseRuleInput,
  parseRulePatch,
  parseRuleTestInput,
  parseWithField,
  ruleActiveSchema,
} from './comment-reply.schemas.js';

export interface CommentReplyRoutesOptions {
  /** 測試用：替換 outbox 寫入 */
  events?: EventPublisher;
}

const rulesQuerySchema = z.object({ channelId: z.string().uuid().optional() });

export default async function commentReplyRuleRoutes(fastify: FastifyInstance, opts: CommentReplyRoutesOptions = {}) {
  const deps = (): CommentReplyFlowDeps => ({ prisma: fastify.prisma, redis: fastify.redis, events: opts.events });
  const view = { preHandler: [fastify.authenticate, requirePermission(COMMENT_REPLY_VIEW)] };
  const manage = { preHandler: [fastify.authenticate, requirePermission(COMMENT_REPLY_MANAGE)] };

  fastify.get('/rules', view, async (request) => {
    const query = parseWithField(rulesQuerySchema, request.query);
    return success(await listRulesFlow(deps(), actorOf(request), await viewerOf(request), query));
  });

  fastify.get('/rules/:id', view, async (request) => {
    const { id } = parseWithField(idParamSchema, request.params);
    return success(await getRuleFlow(deps(), actorOf(request), await viewerOf(request), id));
  });

  fastify.post('/rules', manage, async (request, reply) => {
    const input = parseRuleInput(request.body);
    const rule = await createRuleFlow(deps(), actorOf(request), await viewerOf(request), input);
    return reply.status(201).send(success(rule));
  });

  fastify.put('/rules/order', manage, async (request) => {
    const { ids } = parseReorderInput(request.body);
    return success(await reorderRulesFlow(deps(), actorOf(request), await viewerOf(request), ids));
  });

  fastify.post('/rules/test', view, async (request) => {
    const input = parseRuleTestInput(request.body);
    return success(await testRulesFlow(deps(), actorOf(request), await viewerOf(request), input));
  });

  fastify.patch('/rules/:id', manage, async (request) => {
    const { id } = parseWithField(idParamSchema, request.params);
    const patch = parseRulePatch(request.body);
    return success(await updateRuleFlow(deps(), actorOf(request), await viewerOf(request), id, patch));
  });

  fastify.patch('/rules/:id/active', manage, async (request) => {
    const { id } = parseWithField(idParamSchema, request.params);
    const { isActive } = parseWithField(ruleActiveSchema, request.body);
    return success(await setRuleActiveFlow(deps(), actorOf(request), await viewerOf(request), id, isActive));
  });

  fastify.delete('/rules/:id', manage, async (request, reply) => {
    const { id } = parseWithField(idParamSchema, request.params);
    await deleteRuleFlow(deps(), actorOf(request), await viewerOf(request), id);
    return reply.status(204).send();
  });

  fastify.get('/material-options', manage, async (request) => {
    const { channelId } = parseWithField(materialOptionsQuerySchema, request.query);
    return success(await listMaterialOptionsFlow(deps(), actorOf(request), await viewerOf(request), channelId));
  });
}
