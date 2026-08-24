import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listTemplates,
  listBroadcasts,
  getBroadcast,
  createBroadcast,
  executeBroadcast,
  cancelBroadcast,
} from './marketing.service.js';
import {
  listSegments,
  getSegment,
  createSegment,
  updateSegment,
  deleteSegment,
  calculateSegmentContacts,
} from './segment.service.js';
import {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
} from './campaign.service.js';
import { success, paginated } from '../../shared/utils/response.js';
import { requirePermission } from '../../guards/rbac.guard.js';

// --- Schemas ---

const segmentConditionSchema = z.object({
  field: z.enum(['tag', 'channelType', 'createdAfter', 'createdBefore']),
  operator: z.string().default('eq'),
  value: z.unknown().optional(),
});

const segmentRulesSchema = z.object({
  conditions: z.array(segmentConditionSchema),
  logic: z.enum(['AND', 'OR']).default('AND'),
});

const createSegmentSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  rules: segmentRulesSchema,
});

const updateSegmentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  rules: segmentRulesSchema.optional(),
});

const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const updateCampaignSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  status: z.enum(['draft', 'active', 'completed', 'cancelled']).optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

const createBroadcastSchema = z
  .object({
    name: z.string().min(1).max(200),
    // 來源二擇一：素材（推薦）或舊範本（向下相容）
    materialId: z.string().uuid().optional(),
    templateId: z.string().uuid().optional(),
    channelId: z.string().uuid(),
    campaignId: z.string().uuid().optional(),
    segmentId: z.string().uuid().optional(),
    targetType: z.enum(['all', 'segment', 'tags', 'contacts']),
    targetConfig: z
      .object({
        tagIds: z.array(z.string().uuid()).optional(),
        contactIds: z.array(z.string().uuid()).optional(),
      })
      .optional(),
    scheduledAt: z.string().optional(),
  })
  .refine((data) => Boolean(data.materialId) !== Boolean(data.templateId), {
    message: 'Must provide exactly one of materialId or templateId',
    path: ['materialId'],
  });

export default async function marketingRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePermission('marketing.view'));

  // ─── Templates (read-only) ────────────────────────────────────────────────
  //   範本管理 UI 與 QuickBroadcast 已下線（改用 Material 系統 + 統一的 Broadcast）。
  //   GET /templates 唯一保留：給 Inbox 客服在對話視窗插入快速回覆範本用。

  fastify.get('/templates', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '50', 10);

    const result = await listTemplates(fastify.prisma, request.agent.tenantId, {
      category: query.category || undefined,
      channelType: query.channelType || undefined,
      q: query.q || undefined,
      page,
      limit,
    });

    return reply.send(paginated(result.templates, result.total, result.page, result.limit));
  });

  // ─── Segments ─────────────────────────────────────────────────────────────

  fastify.get('/segments', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '50', 10);

    const result = await listSegments(fastify.prisma, request.agent.tenantId, page, limit);
    return reply.send(paginated(result.segments, result.total, result.page, result.limit));
  });

  fastify.post('/segments', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const data = createSegmentSchema.parse(request.body);
    const segment = await createSegment(
      fastify.prisma,
      request.agent.tenantId,
      request.agent.id,
      data,
    );
    return reply.status(201).send(success(segment));
  });

  fastify.get<{ Params: { id: string } }>('/segments/:id', async (request, reply) => {
    const segment = await getSegment(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(segment));
  });

  fastify.patch<{ Params: { id: string } }>('/segments/:id', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const data = updateSegmentSchema.parse(request.body);
    const segment = await updateSegment(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
      data,
    );
    return reply.send(success(segment));
  });

  fastify.delete<{ Params: { id: string } }>('/segments/:id', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const result = await deleteSegment(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(result));
  });

  // POST /segments/preview — preview matching contacts without saving
  fastify.post('/segments/preview', async (request, reply) => {
    const data = segmentRulesSchema.parse(request.body);
    const result = await calculateSegmentContacts(
      fastify.prisma,
      request.agent.tenantId,
      data,
    );
    return reply.send(success({ count: result.count }));
  });

  // ─── Campaigns ────────────────────────────────────────────────────────────

  fastify.get('/campaigns', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '50', 10);

    const result = await listCampaigns(fastify.prisma, request.agent.tenantId, {
      status: query.status || undefined,
      page,
      limit,
    });
    return reply.send(paginated(result.campaigns, result.total, result.page, result.limit));
  });

  fastify.post('/campaigns', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const data = createCampaignSchema.parse(request.body);
    const campaign = await createCampaign(
      fastify.prisma,
      request.agent.tenantId,
      request.agent.id,
      data,
    );
    return reply.status(201).send(success(campaign));
  });

  fastify.get<{ Params: { id: string } }>('/campaigns/:id', async (request, reply) => {
    const campaign = await getCampaign(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(campaign));
  });

  fastify.patch<{ Params: { id: string } }>('/campaigns/:id', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const data = updateCampaignSchema.parse(request.body);
    const campaign = await updateCampaign(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
      data,
    );
    return reply.send(success(campaign));
  });

  fastify.delete<{ Params: { id: string } }>('/campaigns/:id', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const result = await deleteCampaign(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(result));
  });

  // ─── Broadcasts ───────────────────────────────────────────────────────────

  fastify.get('/broadcasts', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '50', 10);

    const result = await listBroadcasts(fastify.prisma, request.agent.tenantId, {
      campaignId: query.campaignId || undefined,
      status: query.status || undefined,
      page,
      limit,
    });
    return reply.send(paginated(result.broadcasts, result.total, result.page, result.limit));
  });

  fastify.post('/broadcasts', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const data = createBroadcastSchema.parse(request.body);
    const broadcast = await createBroadcast(
      fastify.prisma,
      request.agent.tenantId,
      request.agent.id,
      data,
    );
    return reply.status(201).send(success(broadcast));
  });

  fastify.get<{ Params: { id: string } }>('/broadcasts/:id', async (request, reply) => {
    const broadcast = await getBroadcast(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(broadcast));
  });

  // POST /broadcasts/:id/send — manually trigger broadcast execution
  fastify.post<{ Params: { id: string } }>('/broadcasts/:id/send', { preHandler: requirePermission('marketing.broadcast') }, async (request, reply) => {
    const broadcast = await getBroadcast(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );
    const result = await executeBroadcast(fastify.prisma, fastify.io, broadcast.id);
    return reply.send(success(result));
  });

  // POST /broadcasts/:id/cancel — cancel a draft/scheduled broadcast
  fastify.post<{ Params: { id: string } }>('/broadcasts/:id/cancel', { preHandler: requirePermission('marketing.broadcast') }, async (request, reply) => {
    const result = await cancelBroadcast(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(result));
  });
}
