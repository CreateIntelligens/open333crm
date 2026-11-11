/**
 * 身分合併建議的路由 — /api/v1/identity（change migrate-canvas-tenant-ctx 從 canvas 模組搬來）。
 * 主規格 identity-stitching-engine「合併建議核准須在租戶邊界內執行」。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { SuggestionNotFoundError, SuggestionNotPendingError } from '@open333crm/core';
import { actorOf } from '../../lib/request-actor.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import { success, paginated, AppError } from '../../shared/utils/response.js';
import { approveMergeSuggestionFlow, listMergeSuggestionsFlow, rejectMergeSuggestionFlow } from './contact.flow.js';

const suggestionQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const suggestionParamsSchema = z.object({
  id: z.string().uuid('合併建議 id 格式錯誤'),
});

/** 把 core 的建議錯誤轉成對應 HTTP 狀態的 AppError */
function toSuggestionAppError(err: unknown): never {
  if (err instanceof SuggestionNotFoundError) {
    throw new AppError('找不到此合併建議', 'NOT_FOUND', 404);
  }
  if (err instanceof SuggestionNotPendingError) {
    throw new AppError('此合併建議已處理過了', 'CONFLICT', 409);
  }
  throw err;
}

export default async function mergeSuggestionRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ── GET /api/v1/identity/suggestions ───────────────────────────────────
  // registry 無 identity.view，讀取端點一律以 identity.review 守門
  fastify.get('/suggestions', { preHandler: [requirePermission('identity.review')] }, async (request, reply) => {
    const { status, page, limit } = suggestionQuerySchema.parse(request.query);
    const { suggestions, total } = await listMergeSuggestionsFlow(fastify, actorOf(request).tenantId, status ?? 'PENDING', {
      page,
      limit,
    });
    return reply.send(paginated(suggestions, total, page, limit));
  });

  // ── POST /api/v1/identity/suggestions/:id/approve ──────────────────────
  fastify.post('/suggestions/:id/approve', { preHandler: [requirePermission('identity.review')] }, async (request, reply) => {
    const { id } = suggestionParamsSchema.parse(request.params);
    const result = await approveMergeSuggestionFlow(fastify, actorOf(request), id).catch(toSuggestionAppError);
    return reply.send(success({ merged: true, mergeLogId: result.mergeLogId }));
  });

  // ── POST /api/v1/identity/suggestions/:id/reject ───────────────────────
  fastify.post('/suggestions/:id/reject', { preHandler: [requirePermission('identity.review')] }, async (request, reply) => {
    const { id } = suggestionParamsSchema.parse(request.params);
    const actor = actorOf(request);
    await rejectMergeSuggestionFlow(fastify, actor.tenantId, actor.agentId, id).catch(toSuggestionAppError);
    return reply.send(success({ rejected: true }));
  });
}
