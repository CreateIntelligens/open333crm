import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import {
  addNoteFlow,
  assignCaseFlow,
  createCaseFlow,
  createCaseFromConversationFlow,
  deleteCaseFlow,
  escalateCaseFlow,
  getCaseEventsFlow,
  getCaseFlow,
  getCaseStatsFlow,
  linkConversationToCaseFlow,
  listCasesFlow,
  transitionCaseFlow,
  updateCaseFlow,
} from './case.flow.js';
import { actorOf } from '../../lib/request-actor.js';
import { recordCsatScore } from '../csat/csat.service.js';
import { addTagToTarget, removeTagFromTarget } from '../tag/tagging.service.js';
import { success, paginated, AppError } from '../../shared/utils/response.js';
import { resolveChannelVisibility, isChannelAccessible, assertCaseChannelVisible, assertChannelVisible, assertConversationChannelVisible } from '../../services/channel-visibility.js';
import { notFound } from '../../shared/messages/resource.js';
import { CASE_CATEGORIES, LEGACY_CASE_CATEGORIES } from '@open333crm/shared';
import { requirePermission, requirePermissionWhen } from '../../guards/rbac.guard.js';
import { caseAssignIfAssigning } from './case-permission.js';


// 篩選值正規化為大寫再驗證，避免呼叫端送小寫（如 status=open）直塞 Prisma enum 炸 400
const caseStatusEnum = z.enum(['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'ESCALATED', 'CLOSED']);
const casePriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

const listQuerySchema = z.object({
  status: z.string().transform((s) => s.toUpperCase()).pipe(caseStatusEnum).optional(),
  priority: z.string().transform((s) => s.toUpperCase()).pipe(casePriorityEnum).optional(),
  assigneeId: z.string().uuid().optional(),
  // 篩選用：只限長度，不限列舉（允許查詢歷史遺留的舊分類值）
  category: z.string().max(100).optional(),
  slaStatus: z.enum(['normal', 'warning', 'breached']).optional(),
  sortBy: z.enum(['slaDueAt', 'priority', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// 工單分類：改用 @open333crm/shared 的單一事實來源。
// 原本是 z.string() 全開——實測 500 字亂碼與 <script> 都能寫入，
// 會污染分類篩選下拉與報表版面。
// 允許空字串（等同「未分類」，詳情頁可清空分類）。
const caseCategorySchema = z
  .string()
  .max(100)
  .refine((v) => v === '' || (CASE_CATEGORIES as readonly string[]).includes(v), {
    message: `分類必須是下列其中之一：${CASE_CATEGORIES.join('、')}`,
  });

/**
 * 更新用的分類驗證：除了新清單，額外放行 LEGACY_CASE_CATEGORIES。
 *
 * 為什麼不能直接套 caseCategorySchema：統一分類前建立的工單帶著舊值
 * （維修／查詢／投訴），使用者打開這種工單改個標題、表單把 category 原樣送回，
 * 就會被 400 擋下——訊息還叫他從新清單挑一個，但他根本沒改分類，
 * 而且新清單裡沒有對應項，等於這張工單再也存不了。
 *
 * 建立走嚴格版（不讓新資料再帶舊值），更新走寬鬆版（不擋既有資料）。
 * 待舊值清乾淨後可移除。
 */
const caseCategoryUpdateSchema = z
  .string()
  .max(100)
  .refine(
    (v) =>
      v === '' ||
      (CASE_CATEGORIES as readonly string[]).includes(v) ||
      (LEGACY_CASE_CATEGORIES as readonly string[]).includes(v),
    { message: `分類必須是下列其中之一：${CASE_CATEGORIES.join('、')}` },
  );

const createCaseSchema = z.object({
  contactId: z.string().uuid(),
  channelId: z.string().uuid(),
  title: z.string().trim().min(1, '標題不可為空白').max(100),
  description: z.string().max(2000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  category: caseCategorySchema.optional(),
  assigneeId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  slaPolicyId: z.string().uuid().optional(),
});

const updateCaseSchema = z.object({
  title: z.string().trim().min(1, '標題不可為空白').max(100).optional(),
  description: z.string().max(2000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  // 更新走寬鬆版：既有工單可能帶舊分類值，不可因此擋下存檔
  category: caseCategoryUpdateSchema.optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'ESCALATED', 'CLOSED']).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
});

const assignSchema = z.object({
  assigneeId: z.string().uuid(),
});

const escalateSchema = z.object({
  reason: z.string().trim().min(1, '原因不可為空白').max(1000, '原因不可超過 1000 字'),
  note: z.string().max(500).optional(),
  newPriority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  assigneeId: z.string().uuid().optional(),
  // 升級通知對象：主管與管理員、升級前的指派人、團隊（升級視窗的三個勾選）。
  // team 目前沒有收件人（系統沒有「通知團隊」的實作），只接受、不通知
  notifyTargets: z.array(z.enum(['supervisor', 'original_assignee', 'team'])).optional(),
});

const addNoteSchema = z.object({
  content: z.string().trim().min(1, '內容不可為空白').max(5000, '備註不可超過 5000 字'),
  isInternal: z.boolean().default(true),
});

const addTagSchema = z.object({
  tagId: z.string().uuid(),
});

const csatSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

const createCaseFromConvSchema = z.object({
  title: z.string().trim().min(1, '標題不可為空白').max(100),
  description: z.string().max(2000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  category: caseCategorySchema.optional(),
  assigneeId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  slaPolicyId: z.string().uuid().optional(),
});

// 工單路由的權限檢查集中在這裡（AUDIT RBAC-01；權限碼見 packages/core/src/rbac/permissions.ts）。
// 新增工單路由時請從這張表選用；路由層測試見 tests/feature/modules/route-permission-guards.test.ts
const perm = {
  view: requirePermission('case.view'),
  create: requirePermission('case.create'),
  update: requirePermission('case.update'),
  assign: requirePermission('case.assign'),
  escalate: requirePermission('case.escalate'),
  delete: requirePermission('case.delete'),
  // 建立或編輯時順便改負責人／團隊、或改成「已升級」：不另外檢查的話，只有建立或編輯權限就能繞過指派與升級權限
  assignIfAssigning: caseAssignIfAssigning,
  escalateIfEscalating: requirePermissionWhen(
    'case.escalate',
    (request) => (request.body as { status?: unknown } | undefined)?.status === 'ESCALATED',
  ),
};

export default async function caseRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/cases/categories
  fastify.get('/categories', { preHandler: [perm.view] }, async (_request, reply) => {
    return reply.send(success(CASE_CATEGORIES));
  });

  // GET /api/v1/cases/stats
  fastify.get('/stats', { preHandler: [perm.view] }, async (request, reply) => {
    const stats = await getCaseStatsFlow(fastify, actorOf(request).tenantId);
    return reply.send(success(stats));
  });

  // GET /api/v1/cases
  fastify.get('/', { preHandler: [perm.view] }, async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, ...filters } = query;

    // CM-173 渠道級可見性：只回可見渠道的案件（總店 view_all 不過濾）
    const accessible = await resolveChannelVisibility(request);

    const { cases, total } = await listCasesFlow(fastify, actorOf(request).tenantId, filters, { page, limit }, accessible);

    return reply.send(paginated(cases, total, page, limit));
  });

  // POST /api/v1/cases
  fastify.post('/', { preHandler: [perm.create, perm.assignIfAssigning] }, async (request, reply) => {
    const data = createCaseSchema.parse(request.body);
    // S10：工單渠道必須是操作者看得到的渠道；建立工單為管理操作（同從對話建立）
    await assertChannelVisible(request, data.channelId, 'full');

    const caseRecord = await createCaseFlow(fastify, actorOf(request), data);

    return reply.status(201).send(success(caseRecord));
  });

  // GET /api/v1/cases/:id
  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: [perm.view] }, async (request, reply) => {
    // 先取案件（單次查詢），再做渠道可見性檢查，避免先前「findFirst 取 channelId + getCase」
    // 的重複查詢；比照 conversation.routes.ts GET /:id 的寫法。
    const caseRecord = await getCaseFlow(fastify, actorOf(request).tenantId, request.params.id);
    if (!caseRecord) {
      throw new AppError(notFound('case'), 'NOT_FOUND', 404);
    }

    // CM-173：案件所屬渠道不在可見集合 → 視為不存在（404）。
    // 總店（ALL_CHANNELS）時 isChannelAccessible 直接回 true。
    const accessible = await resolveChannelVisibility(request);
    if (!isChannelAccessible(accessible, caseRecord.channelId)) {
      throw new AppError(notFound('case'), 'NOT_FOUND', 404);
    }

    return reply.send(success(caseRecord));
  });

  // PATCH /api/v1/cases/:id
  fastify.patch<{ Params: { id: string } }>('/:id', { preHandler: [perm.update, perm.assignIfAssigning, perm.escalateIfEscalating] }, async (request, reply) => {
    const data = updateCaseSchema.parse(request.body);
    await assertCaseChannelVisible(request, request.params.id, 'full'); // CM-173：改工單為管理操作

    const caseRecord = await updateCaseFlow(fastify, actorOf(request), request.params.id, data);

    return reply.send(success(caseRecord));
  });

  // DELETE /api/v1/cases/:id
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [perm.delete] }, async (request, reply) => {
    await assertCaseChannelVisible(request, request.params.id, 'full'); // CM-173：刪工單為管理操作
    // 稽核與刪除一起 commit（deleteCaseFlow）
    const deleted = await deleteCaseFlow(fastify, actorOf(request), request.params.id);

    return reply.send(success(deleted));
  });

  // POST /api/v1/cases/:id/tags
  fastify.post<{ Params: { id: string } }>('/:id/tags', { preHandler: [perm.update] }, async (request, reply) => {
    const body = addTagSchema.parse(request.body);
    await assertCaseChannelVisible(request, request.params.id); // CM-173：貼標為 reply_only
    const caseTag = await addTagToTarget(request.tenantPrisma, {
      tenantId: request.agent.tenantId,
      targetType: 'CASE',
      targetId: request.params.id,
      tagId: body.tagId,
      agentId: request.agent.id,
    });

    return reply.status(201).send(success(caseTag));
  });

  // DELETE /api/v1/cases/:id/tags/:tagId
  fastify.delete<{ Params: { id: string; tagId: string } }>(
    '/:id/tags/:tagId', { preHandler: [perm.update] },
    async (request, reply) => {
      await assertCaseChannelVisible(request, request.params.id); // CM-173：移除標籤為 reply_only
      const removed = await removeTagFromTarget(request.tenantPrisma, {
        tenantId: request.agent.tenantId,
        targetType: 'CASE',
        targetId: request.params.id,
        tagId: request.params.tagId,
      });

      return reply.send(success(removed));
    },
  );

  // GET /api/v1/cases/:id/events
  fastify.get<{ Params: { id: string } }>('/:id/events', { preHandler: [perm.view] }, async (request, reply) => {
    await assertCaseChannelVisible(request, request.params.id, 'read_only'); // CM-173：讀工單時間軸需渠道可見
    const events = await getCaseEventsFlow(fastify, actorOf(request).tenantId, request.params.id);
    return reply.send(success(events));
  });

  // POST /api/v1/cases/:id/notes
  fastify.post<{ Params: { id: string } }>('/:id/notes', { preHandler: [perm.update] }, async (request, reply) => {
    const data = addNoteSchema.parse(request.body);
    await assertCaseChannelVisible(request, request.params.id); // CM-173：加註為 reply_only

    const note = await addNoteFlow(fastify, actorOf(request), request.params.id, data);

    return reply.status(201).send(success(note));
  });

  // POST /api/v1/cases/:id/assign
  fastify.post<{ Params: { id: string } }>('/:id/assign', { preHandler: [perm.assign] }, async (request, reply) => {
    const data = assignSchema.parse(request.body);
    await assertCaseChannelVisible(request, request.params.id, 'full'); // CM-173：指派為管理操作

    const caseRecord = await assignCaseFlow(fastify, actorOf(request), request.params.id, data.assigneeId);

    return reply.send(success(caseRecord));
  });

  // POST /api/v1/cases/:id/resolve
  fastify.post<{ Params: { id: string } }>('/:id/resolve', { preHandler: [perm.update] }, async (request, reply) => {
    await assertCaseChannelVisible(request, request.params.id, 'full'); // CM-173：結案轉換為管理操作
    const caseRecord = await transitionCaseFlow(fastify, actorOf(request), request.params.id, 'RESOLVED');

    return reply.send(success(caseRecord));
  });

  // POST /api/v1/cases/:id/close
  fastify.post<{ Params: { id: string } }>('/:id/close', { preHandler: [perm.update] }, async (request, reply) => {
    await assertCaseChannelVisible(request, request.params.id, 'full'); // CM-173：關閉轉換為管理操作
    const caseRecord = await transitionCaseFlow(fastify, actorOf(request), request.params.id, 'CLOSED');

    return reply.send(success(caseRecord));
  });

  // POST /api/v1/cases/:id/reopen
  fastify.post<{ Params: { id: string } }>('/:id/reopen', { preHandler: [perm.update] }, async (request, reply) => {
    await assertCaseChannelVisible(request, request.params.id, 'full'); // CM-173：重啟轉換為管理操作
    const caseRecord = await transitionCaseFlow(fastify, actorOf(request), request.params.id, 'OPEN');

    return reply.send(success(caseRecord));
  });

  // POST /api/v1/cases/:id/escalate
  fastify.post<{ Params: { id: string } }>('/:id/escalate', { preHandler: [perm.escalate] }, async (request, reply) => {
    const body = escalateSchema.parse(request.body);
    await assertCaseChannelVisible(request, request.params.id, 'full'); // CM-173：升級為管理操作

    const caseRecord = await escalateCaseFlow(fastify, actorOf(request), request.params.id, body);

    return reply.send(success(caseRecord));
  });

  // POST /api/v1/cases/:id/conversations/:conversationId/link
  fastify.post<{ Params: { id: string; conversationId: string } }>(
    '/:id/conversations/:conversationId/link', { preHandler: [perm.update] },
    async (request, reply) => {
      await assertCaseChannelVisible(request, request.params.id, 'full'); // CM-173：連結對話到工單為管理操作
      const linked = await linkConversationToCaseFlow(
        fastify,
        actorOf(request),
        request.params.id,
        request.params.conversationId,
      );

      return reply.send(success(linked));
    },
  );

  // POST /api/v1/cases/:id/csat — Record CSAT score (WebChat / manual)
  fastify.post<{ Params: { id: string } }>('/:id/csat', { preHandler: [perm.update] }, async (request, reply) => {
    const data = csatSchema.parse(request.body);
    await assertCaseChannelVisible(request, request.params.id, 'full'); // CM-173：記錄 CSAT 為管理操作

    const recorded = await recordCsatScore(
      request.tenantPrisma,
      fastify.io,
      request.params.id,
      data.score,
      data.comment,
      { tenantId: request.agent.tenantId },
    );

    if (!recorded) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: '無法記錄滿意度評分，此案件可能不存在或已評分過' },
      });
    }

    return reply.send(success({ score: data.score, comment: data.comment }));
  });

  // POST /api/v1/cases/from-conversation/:conversationId
  fastify.post<{ Params: { conversationId: string } }>(
    '/from-conversation/:conversationId', { preHandler: [perm.create, perm.assignIfAssigning] },
    async (request, reply) => {
      const data = createCaseFromConvSchema.parse(request.body);
      // CM-173：與 POST /conversations/:id/case 一致，看不到對話所屬渠道不得替它建工單
      await assertConversationChannelVisible(request, request.params.conversationId, 'full');

      const caseRecord = await createCaseFromConversationFlow(
        fastify,
        actorOf(request),
        request.params.conversationId,
        data,
      );

      return reply.status(201).send(success(caseRecord));
    },
  );
}
