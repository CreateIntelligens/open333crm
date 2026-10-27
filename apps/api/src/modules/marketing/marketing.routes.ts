import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listTemplates,
  listBroadcasts,
  getBroadcast,
  createBroadcast,
  executeBroadcast,
  cancelBroadcast,
  previewBroadcastAudience,
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
import { inTenant } from '../../lib/tenant-ctx.js';
import {
  getCouponBroadcastSummary,
  listBroadcastRecipients,
  queueCouponBroadcast,
} from './broadcast-coupon.service.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import { clampPage, clampLimit } from '../../shared/utils/pagination.js';

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
  name: z.string().trim().min(1, '名稱不可為空白').max(200),
  description: z.string().max(500).optional(),
  rules: segmentRulesSchema,
});

const updateSegmentSchema = z.object({
  name: z.string().trim().min(1, '名稱不可為空白').max(200).optional(),
  description: z.string().max(500).optional(),
  rules: segmentRulesSchema.optional(),
});

const createCampaignSchema = z.object({
  name: z.string().trim().min(1, '名稱不可為空白').max(200),
  description: z.string().max(500).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const updateCampaignSchema = z.object({
  name: z.string().trim().min(1, '名稱不可為空白').max(200).optional(),
  description: z.string().max(500).optional(),
  status: z.enum(['draft', 'active', 'completed', 'cancelled']).optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

const createBroadcastSchema = z
  .object({
    name: z.string().trim().min(1, '名稱不可為空白').max(200),
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
    // 附券廣播（design D29）：只能選進行中的行銷券；素材可選，不支援舊版型
    couponId: z.string().uuid('優惠券識別格式不正確').optional(),
  })
  .refine((data) => (data.couponId ? !data.templateId : Boolean(data.materialId) !== Boolean(data.templateId)), {
    message: '素材與版型請擇一提供，不可同時或都不填',
    path: ['materialId'],
  });

const broadcastAudiencePreviewSchema = z.object({
  channelId: z.string().uuid(),
  // 附券廣播：一併回傳剩餘名額與已達每人上限的人數
  couponId: z.string().uuid().optional(),
  segmentId: z.string().uuid().optional(),
  targetType: z.enum(['all', 'segment', 'tags', 'contacts']),
  targetConfig: z
    .object({
      tagIds: z.array(z.string().uuid()).optional(),
      contactIds: z.array(z.string().uuid()).optional(),
    })
    .optional(),
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
    // 夾制下限：parseInt 讓 page=0/-1 算出負 skip，Prisma 拋錯 → 500
    const page = clampPage(parseInt(query.page || '1', 10));
    const limit = clampLimit(parseInt(query.limit || '50', 10), 50);

    const result = await listTemplates(request.tenantPrisma, request.agent.tenantId, {
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
    // 夾制下限：parseInt 讓 page=0/-1 算出負 skip，Prisma 拋錯 → 500
    const page = clampPage(parseInt(query.page || '1', 10));
    const limit = clampLimit(parseInt(query.limit || '50', 10), 50);

    const result = await listSegments(request.tenantPrisma, request.agent.tenantId, page, limit);
    return reply.send(paginated(result.segments, result.total, result.page, result.limit));
  });

  fastify.post('/segments', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const data = createSegmentSchema.parse(request.body);
    const segment = await createSegment(
      request.tenantPrisma,
      request.agent.tenantId,
      request.agent.id,
      data,
    );
    return reply.status(201).send(success(segment));
  });

  fastify.get<{ Params: { id: string } }>('/segments/:id', async (request, reply) => {
    const segment = await getSegment(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(segment));
  });

  fastify.patch<{ Params: { id: string } }>('/segments/:id', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const data = updateSegmentSchema.parse(request.body);
    const segment = await updateSegment(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
      data,
    );
    return reply.send(success(segment));
  });

  fastify.delete<{ Params: { id: string } }>('/segments/:id', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const result = await deleteSegment(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(result));
  });

  // POST /segments/preview — preview matching contacts without saving
  fastify.post('/segments/preview', async (request, reply) => {
    const data = segmentRulesSchema.parse(request.body);
    const result = await calculateSegmentContacts(
      request.tenantPrisma,
      request.agent.tenantId,
      data,
    );
    return reply.send(success({ count: result.count }));
  });

  // ─── Campaigns ────────────────────────────────────────────────────────────

  fastify.get('/campaigns', async (request, reply) => {
    const query = request.query as Record<string, string>;
    // 夾制下限：parseInt 讓 page=0/-1 算出負 skip，Prisma 拋錯 → 500
    const page = clampPage(parseInt(query.page || '1', 10));
    const limit = clampLimit(parseInt(query.limit || '50', 10), 50);

    const result = await listCampaigns(request.tenantPrisma, request.agent.tenantId, {
      status: query.status || undefined,
      page,
      limit,
    });
    return reply.send(paginated(result.campaigns, result.total, result.page, result.limit));
  });

  fastify.post('/campaigns', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const data = createCampaignSchema.parse(request.body);
    const campaign = await createCampaign(
      request.tenantPrisma,
      request.agent.tenantId,
      request.agent.id,
      data,
    );
    return reply.status(201).send(success(campaign));
  });

  fastify.get<{ Params: { id: string } }>('/campaigns/:id', async (request, reply) => {
    const campaign = await getCampaign(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(campaign));
  });

  fastify.patch<{ Params: { id: string } }>('/campaigns/:id', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const data = updateCampaignSchema.parse(request.body);
    const campaign = await updateCampaign(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
      data,
    );
    return reply.send(success(campaign));
  });

  fastify.delete<{ Params: { id: string } }>('/campaigns/:id', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const result = await deleteCampaign(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(result));
  });

  // ─── Broadcasts ───────────────────────────────────────────────────────────

  fastify.get('/broadcasts', async (request, reply) => {
    const query = request.query as Record<string, string>;
    // 夾制下限：parseInt 讓 page=0/-1 算出負 skip，Prisma 拋錯 → 500
    const page = clampPage(parseInt(query.page || '1', 10));
    const limit = clampLimit(parseInt(query.limit || '50', 10), 50);

    const result = await listBroadcasts(request.tenantPrisma, request.agent.tenantId, {
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
      request.tenantPrisma,
      request.agent.tenantId,
      request.agent.id,
      data,
    );
    return reply.status(201).send(success(broadcast));
  });

  // POST /broadcasts/audience-preview — 預估符合條件與可送達人數（FB／IG 只算 24 小時內互動過的人），不建立群發
  fastify.post('/broadcasts/audience-preview', async (request, reply) => {
    const data = broadcastAudiencePreviewSchema.parse(request.body);
    const result = await previewBroadcastAudience(request.tenantPrisma, request.agent.tenantId, data);
    return reply.send(success(result));
  });

  fastify.get<{ Params: { id: string } }>('/broadcasts/:id', async (request, reply) => {
    const broadcast = await getBroadcast(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
    );
    // 附券廣播的結果：發券張數、依原因分列的跳過與失敗人數（design D29）
    const couponSummary = broadcast.couponId
      ? await inTenant(fastify.prisma, request.agent.tenantId, (ctx) => getCouponBroadcastSummary(ctx, broadcast.id))
      : null;
    return reply.send(success({ ...broadcast, couponSummary }));
  });

  // GET /broadcasts/:id/recipients — 結果頁列出收件人與跳過、失敗的原因
  fastify.get<{ Params: { id: string } }>('/broadcasts/:id/recipients', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid('廣播識別格式不正確') }).parse(request.params);
    const query = z.object({
      status: z.enum(['sent', 'failed', 'skipped', 'pending']).optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(50),
    }).parse(request.query);
    const result = await inTenant(fastify.prisma, request.agent.tenantId, (ctx) => listBroadcastRecipients(ctx, id, query));
    if (!result) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '找不到這則廣播' } });
    return reply.send(paginated(result.items, result.total, result.page, result.limit));
  });

  // POST /broadcasts/:id/send — manually trigger broadcast execution
  fastify.post<{ Params: { id: string } }>('/broadcasts/:id/send', { preHandler: requirePermission('marketing.broadcast') }, async (request, reply) => {
    const broadcast = await getBroadcast(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
    );
    // 附券廣播：排入排程立即執行，不在 HTTP 請求內發送（design D29）；結果在廣播列表查看
    if (broadcast.couponId) {
      const queued = await inTenant(fastify.prisma, request.agent.tenantId, (ctx) => queueCouponBroadcast(ctx, broadcast.id));
      return reply.status(202).send(success(queued));
    }
    const result = await executeBroadcast(request.tenantPrisma, fastify.io, broadcast.id);
    return reply.send(success(result));
  });

  // POST /broadcasts/:id/cancel — cancel a draft/scheduled broadcast
  fastify.post<{ Params: { id: string } }>('/broadcasts/:id/cancel', { preHandler: requirePermission('marketing.broadcast') }, async (request, reply) => {
    const result = await cancelBroadcast(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(result));
  });
}
