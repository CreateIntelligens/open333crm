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
import { requirePermission } from '../../guards/rbac.guard.js';

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

// keyword.matched 觸發的具名 schema。
//
// 為什麼要特別處理：原本 trigger 只有 `z.object({ type }).passthrough()`，
// keywords 完全不驗，而 automation.worker.ts 的比對是
// `lowerText.includes(kw.toLowerCase())` —— `includes('')` 在 JS 恆為 true。
// worker 雖有 `if (keywords.length === 0) continue` 防空陣列，但擋不住
// `['']`（長度為 1），結果是該規則會對租戶內每一則進來的訊息觸發自動回覆。
// UI 有前端擋控，但 API 直呼完全無防護。
const keywordTriggerSchema = z.object({
  type: z.literal('keyword.matched'),
  keywords: z
    .array(
      z
        .string()
        .trim()
        .min(1, '關鍵字不可為空白')
        .max(100, '單一關鍵字不可超過 100 字'),
    )
    .min(1, '至少需要一個關鍵字')
    .max(50, '關鍵字不可超過 50 個'),
  match_mode: z.enum(['any', 'all']).optional(),
});

// 其他觸發類型維持寬鬆（各自的參數由 contracts 層驗證）。
const genericTriggerSchema = z
  .object({ type: z.string().min(1) })
  .passthrough();

/**
 * 依 type 分流：keyword.matched 走嚴格驗證，其餘維持原本行為。
 * 用 superRefine 而非 discriminatedUnion，是為了讓 keyword.matched
 * 的錯誤訊息能精準指到 keywords 欄位，而不是回一句「沒有符合的 union 分支」。
 */
const triggerSchema = genericTriggerSchema.superRefine((val, ctx) => {
  if (val.type !== 'keyword.matched') return;
  const r = keywordTriggerSchema.safeParse(val);
  if (!r.success) {
    for (const issue of r.error.issues) ctx.addIssue(issue);
  }
});

const createRuleSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  stopOnMatch: z.boolean().optional(),
  trigger: triggerSchema,
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
  // 更新也必須套同一套驗證，否則可先建合法規則再改成 keywords:[''] 繞過
  trigger: triggerSchema.optional(),
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
  fastify.get('/rules', { preHandler: requirePermission('automation.view') }, async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, ...filters } = query;

    const { rules, total } = await listRules(
      request.tenantPrisma,
      request.agent.tenantId,
      filters,
      { page, limit },
    );

    return reply.send(paginated(rules, total, page, limit));
  });

  // ── POST /api/v1/automation/rules ───────────────────────────────────────
  fastify.post('/rules', { preHandler: requirePermission('automation.manage') }, async (request, reply) => {
    const data = createRuleSchema.parse(request.body);

    const rule = await createRule(
      request.tenantPrisma,
      request.agent.tenantId,
      data,
    );

    return reply.status(201).send(success(rule));
  });

  // ── GET /api/v1/automation/rules/:id ────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/rules/:id', { preHandler: requirePermission('automation.view') }, async (request, reply) => {
    const rule = await getRule(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
    );

    return reply.send(success(rule));
  });

  // ── PATCH /api/v1/automation/rules/:id ──────────────────────────────────
  fastify.patch<{ Params: { id: string } }>('/rules/:id', { preHandler: requirePermission('automation.manage') }, async (request, reply) => {
    const data = updateRuleSchema.parse(request.body);

    const rule = await updateRule(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
      data,
    );

    return reply.send(success(rule));
  });

  // ── DELETE /api/v1/automation/rules/:id ─────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/rules/:id', { preHandler: requirePermission('automation.manage') }, async (request, reply) => {
    const rule = await deleteRule(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
    );

    return reply.send(success(rule));
  });

  // ── POST /api/v1/automation/rules/:id/test ──────────────────────────────
  fastify.post<{ Params: { id: string } }>('/rules/:id/test', async (request, reply) => {
    const data = testRuleSchema.parse(request.body);

    const result = await testRule(
      request.tenantPrisma,
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
      request.tenantPrisma,
      request.agent.tenantId,
      { page, limit },
      filters,
    );

    return reply.send(paginated(logs, total, page, limit));
  });
}
