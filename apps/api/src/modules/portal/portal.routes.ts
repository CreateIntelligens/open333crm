/**
 * Portal Admin API routes — CRUD for activities + points management.
 * Prefix: /api/v1/portal
 */

import type { FastifyInstance } from 'fastify';
import {
  listActivities,
  getActivity,
  createActivity,
  updateActivity,
  deleteActivity,
  publishActivity,
  endActivity,
  archiveActivity,
  unarchiveActivity,
  listSubmissions,
  drawWinners,
} from './portal.service.js';
import {
  listPointTransactions,
  addPointTransaction,
  getPointBalance,
} from './points.service.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import { withTenant } from '../../lib/tenant-db.js';
import { clampPage, clampLimit } from '../../shared/utils/pagination.js';
import { z } from 'zod';
import { int4Schema } from '../../shared/utils/numeric-bounds.js';

// 積分調整：允許負數（扣點），但必須是能存進 Int 欄位的整數。
// 小數不做無條件捨去而是直接擋下——靜默改動使用者輸入的數字，
// 在「調整積分」這種帳務性操作上不可接受。
const adjustPointsSchema = z.object({
  contactId: z.string().uuid('聯繫人 ID 格式不正確'),
  amount: int4Schema,
  note: z.string().trim().max(500, '備註不可超過 500 字').optional(),
});

/**
 * 活動建立／更新。原本這兩個端點**完全沒有驗證**，body 直接 as 進 service：
 *   - startsAt/endsAt 亂填會變成 Invalid Date 一路送進 Prisma → 500 而非 400
 *   - type 直接 as 成 union，不在 enum 內的值要等 DB 才擋
 *
 * 日期一律 z.coerce.date()（專案慣例）：前端 <input type="datetime-local">
 * 送的是帶時區的 ISO 字串，coerce.date() 能正確解析；亂填則在這層就擋下。
 */
const activityOptionSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1, '選項內容不可為空白').max(500, '選項內容不可超過 500 字'),
  imageUrl: z.string().trim().max(2048).optional(),
  sortOrder: int4Schema.optional(),
  isCorrect: z.boolean().optional(),
});

const activityFieldSchema = z.object({
  id: z.string().uuid().optional(),
  fieldKey: z.string().trim().min(1, '欄位代碼不可為空白').max(100, '欄位代碼不可超過 100 字'),
  label: z.string().trim().min(1, '欄位名稱不可為空白').max(200, '欄位名稱不可超過 200 字'),
  fieldType: z.string().trim().max(50).optional(),
  options: z.unknown().optional(),
  isRequired: z.boolean().optional(),
  sortOrder: int4Schema.optional(),
});

const createActivitySchema = z.object({
  type: z.enum(['POLL', 'FORM', 'QUIZ'], { errorMap: () => ({ message: '活動類型不正確' }) }),
  title: z.string().trim().min(1, '活動標題不可為空白').max(200, '活動標題不可超過 200 字'),
  description: z.string().trim().max(5000, '活動說明不可超過 5000 字').optional(),
  coverImage: z.string().trim().max(2048).optional(),
  settings: z.record(z.unknown()).optional(),
  startsAt: z.coerce.date({ errorMap: () => ({ message: '開始時間格式不正確' }) }).nullish(),
  endsAt: z.coerce.date({ errorMap: () => ({ message: '結束時間格式不正確' }) }).nullish(),
  options: z.array(activityOptionSchema).optional(),
  fields: z.array(activityFieldSchema).optional(),
});

// 結束早於開始是無效區間：活動永遠不會開放，但畫面上看起來像設定成功。
// 只在兩者都有值時檢查——只設其中一個是合法的（不限開始或不限結束）。
const endsAfterStarts = <T extends { startsAt?: Date | null; endsAt?: Date | null }>(
  v: T,
  ctx: z.RefinementCtx,
) => {
  if (v.startsAt && v.endsAt && v.endsAt <= v.startsAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endsAt'],
      message: '結束時間必須晚於開始時間',
    });
  }
};

const createActivityBody = createActivitySchema.superRefine(endsAfterStarts);

// 更新全欄位可選；type 不可改（改了既有的 options/fields 就對不上）
const updateActivitySchema = createActivitySchema
  .partial()
  .omit({ type: true })
  .superRefine(endsAfterStarts);

export default async function portalRoutes(app: FastifyInstance) {
  // All routes require agent JWT
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requirePermission('portal.view'));

  // ── Activities ────────────────────────────────────────────────────────────

  app.get('/activities', async (request) => {
    const { type, status, page, limit } = request.query as Record<string, string>;
    const result = await listActivities(request.tenantPrisma, request.agent.tenantId, {
      type,
      status,
      // 夾制下限：parseInt 讓 page=0/-1 算出負 skip，Prisma 拋錯 → 500
      page: page ? clampPage(parseInt(page)) : undefined,
      limit: limit ? clampLimit(parseInt(limit)) : undefined,
    });
    return { success: true, data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } };
  });

  app.post('/activities', { preHandler: requirePermission('portal.manage') }, async (request) => {
    const body = createActivityBody.parse(request.body);
    const activity = await createActivity(request.tenantPrisma, request.agent.tenantId, request.agent.id, body as Parameters<typeof createActivity>[3]);
    return { success: true, data: activity };
  });

  app.get('/activities/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const activity = await getActivity(request.tenantPrisma, id, request.agent.tenantId);
    // 先前漏了 reply.status，NOT_FOUND 實際以 HTTP 200 送出，前端判斷不到失敗
    if (!activity) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '找不到此活動，可能已被刪除' } });
    return { success: true, data: activity };
  });

  app.patch('/activities/:id', { preHandler: requirePermission('portal.manage') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateActivitySchema.parse(request.body);
    try {
      // updateActivity 內部有多筆 delete/create（選項、欄位），需在單一綁定租戶的交易內原子完成；
      // RLS 下交易不可巢狀，故由呼叫端用 withTenant 開好交易再把 tx 傳入（函式本身只用傳入的 tx）。
      const activity = await withTenant(app.prisma, request.agent.tenantId, (tx) =>
        updateActivity(tx, id, request.agent.tenantId, body as Parameters<typeof updateActivity>[3]),
      );
      if (!activity) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '找不到此活動，可能已被刪除' } });
      return { success: true, data: activity };
    } catch (err: unknown) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: (err as Error).message } });
    }
  });

  app.delete('/activities/:id', { preHandler: requirePermission('portal.manage') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await deleteActivity(request.tenantPrisma, id, request.agent.tenantId);
      if (!result) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '找不到此活動，可能已被刪除' } });
      return { success: true };
    } catch (err: unknown) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: (err as Error).message } });
    }
  });

  app.post('/activities/:id/publish', { preHandler: requirePermission('portal.manage') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const activity = await publishActivity(request.tenantPrisma, id, request.agent.tenantId);
      if (!activity) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '找不到此活動，可能已被刪除' } });
      return { success: true, data: activity };
    } catch (err: unknown) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: (err as Error).message } });
    }
  });

  app.post('/activities/:id/end', { preHandler: requirePermission('portal.manage') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const activity = await endActivity(request.tenantPrisma, id, request.agent.tenantId);
      if (!activity) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '找不到此活動，可能已被刪除' } });
      return { success: true, data: activity };
    } catch (err: unknown) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: (err as Error).message } });
    }
  });

  // ── Submissions ───────────────────────────────────────────────────────────


  // 封存／取消封存：ENDED 活動原本無法從列表移除（deleteActivity 只允許 DRAFT），
  // 誤建或辦完的活動會永遠留著。改用封存而非刪除——PortalSubmission 對
  // PortalActivity 是 onDelete: Cascade，硬刪會連帶清掉參與者的提交紀錄。
  //
  // 這兩個端點不套 try/catch 轉 400：AppError 自帶語意狀態碼
  // （狀態不對是 409 CONFLICT），交給全域 error handler 保留原碼即可。
  app.post('/activities/:id/archive', { preHandler: requirePermission('portal.manage') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const activity = await archiveActivity(request.tenantPrisma, id, request.agent.tenantId);
    if (!activity) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '找不到此活動，可能已被刪除' } });
    return { success: true, data: activity };
  });

  app.post('/activities/:id/unarchive', { preHandler: requirePermission('portal.manage') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const activity = await unarchiveActivity(request.tenantPrisma, id, request.agent.tenantId);
    if (!activity) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '找不到此活動，可能已被刪除' } });
    return { success: true, data: activity };
  });
  app.get('/activities/:id/submissions', async (request) => {
    const { id } = request.params as { id: string };
    const { page, limit } = request.query as Record<string, string>;
    const result = await listSubmissions(request.tenantPrisma, id, request.agent.tenantId, page ? clampPage(parseInt(page)) : undefined, limit ? clampLimit(parseInt(limit)) : undefined);
    return { success: true, data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } };
  });

  app.post('/activities/:id/draw', { preHandler: requirePermission('portal.manage') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { count } = request.body as { count: number };
    if (!count || count < 1) return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'count is required' } });
    const winners = await drawWinners(request.tenantPrisma, id, request.agent.tenantId, count);
    return { success: true, data: winners };
  });

  // ── Points ────────────────────────────────────────────────────────────────

  app.get('/points', async (request) => {
    const { contactId, page, limit } = request.query as Record<string, string>;
    if (!contactId) return { success: true, data: [], meta: { total: 0 } };
    const result = await listPointTransactions(request.tenantPrisma, request.agent.tenantId, contactId, page ? clampPage(parseInt(page)) : undefined, limit ? clampLimit(parseInt(limit)) : undefined);
    return { success: true, data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } };
  });

  app.post('/points/adjust', { preHandler: requirePermission('portal.manage') }, async (request) => {
    // 原本是裸轉型 + 只檢查 undefined：
    // 超大 amount（999999999999999）會溢位 int4 → 500；
    // 小數（1.5）被 Prisma 靜默無條件捨去成 1，使用者完全無感知。
    const { contactId, amount, note } = adjustPointsSchema.parse(request.body);
    const tx = await addPointTransaction(request.tenantPrisma, {
      tenantId: request.agent.tenantId,
      contactId,
      amount,
      type: 'admin_adjust',
      note,
    });
    return { success: true, data: tx };
  });

  app.get('/points/balance/:contactId', async (request) => {
    const { contactId } = request.params as { contactId: string };
    const balance = await getPointBalance(request.tenantPrisma, contactId);
    return { success: true, data: { contactId, balance } };
  });
}
