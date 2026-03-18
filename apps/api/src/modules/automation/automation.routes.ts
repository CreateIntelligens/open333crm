/**
 * Automation REST routes.
 *
 * Prefix: /api/v1/automation
 * All routes require authentication via fastify.authenticate.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  testRule,
  listLogs,
} from './automation.service.js';
import { success, paginated } from '../../shared/utils/response.js';

// ── Validation schemas ──────────────────────────────────────────────────────

const listQuerySchema = z.object({
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  trigger: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const createRuleSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  stopOnMatch: z.boolean().optional(),
  trigger: z.object({
    type: z.string().min(1),
  }).passthrough(),
  conditions: z.record(z.unknown()),
  actions: z.array(
    z.object({
      type: z.string().min(1),
      params: z.record(z.unknown()).default({}),
    }),
  ).min(1),
});

const updateRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  stopOnMatch: z.boolean().optional(),
  isActive: z.boolean().optional(),
  trigger: z
    .object({
      type: z.string().min(1),
    })
    .passthrough()
    .optional(),
  conditions: z.record(z.unknown()).optional(),
  actions: z
    .array(
      z.object({
        type: z.string().min(1),
        params: z.record(z.unknown()).default({}),
      }),
    )
    .min(1)
    .optional(),
});

const testRuleSchema = z.object({
  facts: z.record(z.unknown()).optional(),
});

const logQuerySchema = z.object({
  ruleId: z.string().uuid().optional(),
  success: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// ── Route registration ──────────────────────────────────────────────────────

export default async function automationRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // ── GET /api/v1/automation/rules ────────────────────────────────────────
  fastify.get('/rules', async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, ...filters } = query;

    const { rules, total } = await listRules(
      fastify.prisma,
      request.agent.tenantId,
      filters,
      { page, limit },
    );

    return reply.send(paginated(rules, total, page, limit));
  });

  // ── POST /api/v1/automation/rules ───────────────────────────────────────
  fastify.post('/rules', async (request, reply) => {
    const data = createRuleSchema.parse(request.body);

    const rule = await createRule(
      fastify.prisma,
      request.agent.tenantId,
      data,
    );

    return reply.status(201).send(success(rule));
  });

  // ── GET /api/v1/automation/rules/:id ────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/rules/:id', async (request, reply) => {
    const rule = await getRule(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );

    return reply.send(success(rule));
  });

  // ── PATCH /api/v1/automation/rules/:id ──────────────────────────────────
  fastify.patch<{ Params: { id: string } }>('/rules/:id', async (request, reply) => {
    const data = updateRuleSchema.parse(request.body);

    const rule = await updateRule(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
      data,
    );

    return reply.send(success(rule));
  });

  // ── DELETE /api/v1/automation/rules/:id ─────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/rules/:id', async (request, reply) => {
    const rule = await deleteRule(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );

    return reply.send(success(rule));
  });

  // ── POST /api/v1/automation/rules/:id/test ──────────────────────────────
  fastify.post<{ Params: { id: string } }>('/rules/:id/test', async (request, reply) => {
    const data = testRuleSchema.parse(request.body);

    const result = await testRule(
      fastify.prisma,
      request.agent.tenantId,
      request.params.id,
      data.facts,
    );

    return reply.send(success(result));
  });

  // ── GET /api/v1/automation/logs ─────────────────────────────────────────
  fastify.get('/logs', async (request, reply) => {
    const query = logQuerySchema.parse(request.query);
    const { page, limit, ...filters } = query;

    const { logs, total } = await listLogs(
      fastify.prisma,
      request.agent.tenantId,
      { page, limit },
      filters,
    );

    return reply.send(paginated(logs, total, page, limit));
  });
}
