/**
 * Canvas REST routes — /api/v1/canvas (Tasks 5.1, 5.4)
 * 身分合併建議的路由在 contact/merge-suggestion.routes.ts。
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { FlowRunner } from '@open333crm/core';
import { actorOf } from '../../lib/request-actor.js';
import {
  activateFlowFlow,
  createFlowFlow,
  getFlowAnalyticsFlow,
  getFlowFlow,
  listExecutionsFlow,
  listFlowsFlow,
  triggerFlowFlow,
  updateFlowFlow,
} from './canvas.flow.js';
import { success, paginated } from '../../shared/utils/response.js';
import { requirePermission } from '../../guards/rbac.guard.js';

// ── Schemas ─────────────────────────────────────────────────────────────────

const nodeSchema = z.object({
  nodeType: z.enum(['TRIGGER', 'MESSAGE', 'WAIT', 'CONDITION', 'API_FETCH', 'AI_GEN', 'ACTION']),
  label: z.string().min(1).max(200),
  config: z.record(z.unknown()).optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  nextNodeId: z.string().uuid().optional(),
  falseNodeId: z.string().uuid().optional(),
  sortOrder: z.number().int().optional(),
});

const createFlowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  triggerType: z.enum(['webhook', 'schedule', 'manual', 'event']),
  triggerConfig: z.record(z.unknown()).optional(),
  maxStepLimit: z.number().int().min(1).max(1000).optional(),
  nodes: z.array(nodeSchema).optional(),
});

const updateFlowSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  triggerType: z.enum(['webhook', 'schedule', 'manual', 'event']).optional(),
  triggerConfig: z.record(z.unknown()).optional(),
  maxStepLimit: z.number().int().min(1).max(1000).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
});

const listQuerySchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// 執行紀錄的 status 是 execution 的狀態（ExecutionState），不是流程的狀態
const executionQuerySchema = z.object({
  status: z.enum(['RUNNING', 'WAITING', 'COMPLETED', 'FAILED']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const flowParamsSchema = z.object({
  id: z.string().uuid('流程 id 格式錯誤'),
});

const triggerFlowSchema = z.object({
  contactId: z.string().uuid(),
  vars: z.record(z.unknown()).optional(),
});

// ── Route registration ───────────────────────────────────────────────────────

export default async function canvasRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ── GET /api/v1/canvas ──────────────────────────────────────────────────
  // registry 無 canvas.view，讀取端點一律以 canvas.use 守門
  fastify.get('/', { preHandler: [requirePermission('canvas.use')] }, async (request, reply) => {
    const { page, limit, status } = listQuerySchema.parse(request.query);
    const { flows, total } = await listFlowsFlow(fastify, actorOf(request).tenantId, { page, limit, status });
    return reply.send(paginated(flows, total, page, limit));
  });

  // ── POST /api/v1/canvas ─────────────────────────────────────────────────
  fastify.post('/', { preHandler: [requirePermission('canvas.use')] }, async (request, reply) => {
    const data = createFlowSchema.parse(request.body);
    const flow = await createFlowFlow(fastify, actorOf(request).tenantId, data);
    return reply.status(201).send(success(flow));
  });

  // ── GET /api/v1/canvas/:id ──────────────────────────────────────────────
  fastify.get('/:id', { preHandler: [requirePermission('canvas.use')] }, async (request, reply) => {
    const { id } = flowParamsSchema.parse(request.params);
    const flow = await getFlowFlow(fastify, actorOf(request).tenantId, id);
    return reply.send(success(flow));
  });

  // ── PATCH /api/v1/canvas/:id ────────────────────────────────────────────
  fastify.patch('/:id', { preHandler: [requirePermission('canvas.use')] }, async (request, reply) => {
    const { id } = flowParamsSchema.parse(request.params);
    const data = updateFlowSchema.parse(request.body);
    const flow = await updateFlowFlow(fastify, actorOf(request).tenantId, id, data);
    return reply.send(success(flow));
  });

  // ── POST /api/v1/canvas/:id/activate ───────────────────────────────────
  fastify.post('/:id/activate', { preHandler: [requirePermission('canvas.use')] }, async (request, reply) => {
    const { id } = flowParamsSchema.parse(request.params);
    const flow = await activateFlowFlow(fastify, actorOf(request).tenantId, id);
    return reply.send(success(flow));
  });

  // ── POST /api/v1/canvas/:id/trigger ────────────────────────────────────
  // 流程不存在或屬於另一個租戶回 404、不是 ACTIVE 回 409；引擎在 commit 之後才開始執行
  fastify.post('/:id/trigger', { preHandler: [requirePermission('canvas.use')] }, async (request, reply) => {
    const { id } = flowParamsSchema.parse(request.params);
    const { contactId, vars } = triggerFlowSchema.parse(request.body);
    const executionId = await triggerFlowFlow(
      { prisma: fastify.prisma, runFlow: (executionId) => FlowRunner.run(executionId) },
      actorOf(request).tenantId,
      { flowId: id, contactId, vars },
    );
    return reply.status(202).send(success({ executionId }));
  });

  // ── GET /api/v1/canvas/:id/analytics ───────────────────────────────────
  fastify.get('/:id/analytics', { preHandler: [requirePermission('canvas.use')] }, async (request, reply) => {
    const { id } = flowParamsSchema.parse(request.params);
    const analytics = await getFlowAnalyticsFlow(fastify, actorOf(request).tenantId, id);
    return reply.send(success(analytics));
  });

  // ── GET /api/v1/canvas/:id/executions ──────────────────────────────────
  fastify.get('/:id/executions', { preHandler: [requirePermission('canvas.use')] }, async (request, reply) => {
    const { id } = flowParamsSchema.parse(request.params);
    const { page, limit, status } = executionQuerySchema.parse(request.query);
    const result = await listExecutionsFlow(fastify, actorOf(request).tenantId, id, { page, limit, status });
    return reply.send(paginated(result.executions, result.total, page, limit));
  });
}
