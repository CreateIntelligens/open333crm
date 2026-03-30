/**
 * Canvas REST routes — /api/v1/canvas (Tasks 5.1, 5.4)
 * Identity merge routes — /api/v1/identity
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listFlows,
  getFlow,
  createFlow,
  updateFlow,
  activateFlow,
  getFlowAnalytics,
  listExecutions,
  triggerFlow,
} from './canvas.service.js';
import {
  listSuggestions,
  approveMerge,
  rejectMerge,
} from '@open333crm/core';
import { success, paginated } from '../../shared/utils/response.js';

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

const triggerFlowSchema = z.object({
  contactId: z.string().uuid(),
  vars: z.record(z.unknown()).optional(),
});

const suggestionQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// ── Route registration ───────────────────────────────────────────────────────

export default async function canvasRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ── GET /api/v1/canvas ──────────────────────────────────────────────────
  fastify.get('/', async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, status } = query;

    const { flows, total } = await listFlows(fastify.prisma, request.agent.tenantId, {
      page, limit, status,
    });

    return reply.send(paginated(flows, total, page, limit));
  });

  // ── POST /api/v1/canvas ─────────────────────────────────────────────────
  fastify.post('/', async (request, reply) => {
    const data = createFlowSchema.parse(request.body);
    const flow = await createFlow(fastify.prisma, request.agent.tenantId, data as never);
    return reply.status(201).send(success(flow));
  });

  // ── GET /api/v1/canvas/:id ──────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const flow = await getFlow(fastify.prisma, request.params.id, request.agent.tenantId);
    return reply.send(success(flow));
  });

  // ── PATCH /api/v1/canvas/:id ────────────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const data = updateFlowSchema.parse(request.body);
    const flow = await updateFlow(fastify.prisma, request.params.id, request.agent.tenantId, data);
    return reply.send(success(flow));
  });

  // ── POST /api/v1/canvas/:id/activate ───────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/:id/activate', async (request, reply) => {
    const flow = await activateFlow(fastify.prisma, request.params.id, request.agent.tenantId);
    return reply.send(success(flow));
  });

  // ── POST /api/v1/canvas/:id/trigger ────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/:id/trigger', async (request, reply) => {
    const { contactId, vars } = triggerFlowSchema.parse(request.body);
    const executionId = await triggerFlow(
      fastify.prisma,
      request.params.id,
      contactId,
      request.agent.tenantId,
      vars,
    );
    return reply.status(202).send(success({ executionId }));
  });

  // ── GET /api/v1/canvas/:id/analytics ───────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/:id/analytics', async (request, reply) => {
    const analytics = await getFlowAnalytics(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(analytics));
  });

  // ── GET /api/v1/canvas/:id/executions ──────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/:id/executions', async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, status } = query;

    const result = await listExecutions(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
      { page, limit, status },
    );

    return reply.send(paginated(result.executions, result.total, page, limit));
  });
}

// ── Identity routes (separate prefix /api/v1/identity) ─────────────────────

export async function identityRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ── GET /api/v1/identity/suggestions ───────────────────────────────────
  fastify.get('/suggestions', async (request, reply) => {
    const query = suggestionQuerySchema.parse(request.query);
    const { status, page, limit } = query;

    const { suggestions, total } = await listSuggestions(
      request.agent.tenantId,
      status ?? 'PENDING',
      { page, limit },
    );

    return reply.send(paginated(suggestions, total, page, limit));
  });

  // ── POST /api/v1/identity/suggestions/:id/approve ──────────────────────
  fastify.post<{ Params: { id: string } }>('/suggestions/:id/approve', async (request, reply) => {
    await approveMerge(request.params.id, request.agent.id);
    return reply.send(success({ merged: true }));
  });

  // ── POST /api/v1/identity/suggestions/:id/reject ───────────────────────
  fastify.post<{ Params: { id: string } }>('/suggestions/:id/reject', async (request, reply) => {
    await rejectMerge(request.params.id, request.agent.id);
    return reply.send(success({ rejected: true }));
  });
}
