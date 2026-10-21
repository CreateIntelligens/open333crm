/**
 * 對話發券（add-coupon-system A11、design D14），掛在 /api/v1/coupon-issue。
 *
 * - GET  /conversations/:conversationId         發券面板資料（補償紀錄、可發的券、無法發券的原因）
 * - POST /conversations/:conversationId         發券（帶發送鍵）
 * - GET  /requests/:requestKey                  依發送鍵查詢結果（網路逾時後使用）
 * - GET  /conversations/:conversationId/issued  對話聯絡人收到的券（右側「已發優惠券」）
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../../guards/rbac.guard.js';
import { assertConversationChannelVisible } from '../../services/channel-visibility.js';
import { getAgentById } from '../auth/auth.service.js';
import { getBindingStore } from '../identity-binding/binding-code.js';
import {
  getIssueContext,
  getIssueRequest,
  issueInConversation,
  listIssuedCoupons,
  type InboxIssueDeps,
  type InboxIssueFailure,
} from './coupon-inbox.service.js';

const paramsSchema = z.object({ conversationId: z.string().uuid('對話識別格式不正確') });

const issueSchema = z.object({
  couponId: z.string().uuid('優惠券識別格式不正確'),
  requestKey: z.string().uuid('發送鍵格式不正確'),
  /** 座席開啟面板時看到的負責人（未指派為 null） */
  expectedAssigneeId: z.string().uuid().nullable(),
});

/** 失敗的狀態碼與訊息；前端依錯誤碼顯示對應文案並說明券是否已發出 */
const FAILURES: Record<InboxIssueFailure, { status: number; message: string }> = {
  NOT_FOUND: { status: 404, message: '查無此對話或優惠券' },
  COUPON_NOT_ISSUABLE: { status: 409, message: '此券已停止發放' },
  PER_CONTACT_LIMIT_REACHED: { status: 409, message: '此顧客已達該券的每人上限' },
  COUPON_DELIVERY_FAILED: { status: 409, message: '顧客目前無法接收訊息，券未發出' },
  CONVERSATION_OUT_OF_SCOPE: { status: 409, message: '此對話已不在你的處理範圍' },
  CONVERSATION_BOT_HANDLED: { status: 409, message: '機器人處理中，請先接手對話再發券' },
  REPLY_WINDOW_EXPIRED: { status: 409, message: '已超過回覆期限，無法發送優惠券' },
  ISSUE_IN_PROGRESS: { status: 409, message: '這次發券還在處理中，請稍候' },
  KEY_REUSED: { status: 409, message: '發送鍵已用於另一次發券，請重新選券' },
  ISSUE_FAILED: { status: 409, message: '發券失敗，券未發出，請重試' },
  DELIVERED_UNCONFIRMED: { status: 409, message: '發券訊息已送給顧客，但系統沒有記錄成功，請勿重送並通知管理員確認' },
};

export default async function couponInboxRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  const deps = (): InboxIssueDeps => ({
    store: getBindingStore(),
    emit: (room, event, data) => app.io.to(room).emit(event, data),
  });

  app.get('/conversations/:conversationId', { preHandler: [requirePermission('coupon.issue')] }, async (request, reply) => {
    const { conversationId } = paramsSchema.parse(request.params);
    await assertConversationChannelVisible(request, conversationId, 'reply_only');
    const context = await getIssueContext(app.prisma, deps(), { tenantId: request.agent.tenantId, conversationId });
    if (!context) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: FAILURES.NOT_FOUND.message } });
    }
    return { success: true, data: context };
  });

  app.post('/conversations/:conversationId', { preHandler: [requirePermission('coupon.issue')] }, async (request, reply) => {
    const { conversationId } = paramsSchema.parse(request.params);
    const body = issueSchema.parse(request.body);
    await assertConversationChannelVisible(request, conversationId, 'reply_only');
    const tenantId = request.agent.tenantId;
    // 保存發券座席當下的名稱，座席之後改名或刪除，序號明細與券訊息仍顯示原名
    const agent = await getAgentById(request.tenantPrisma, request.agent.id, tenantId);

    const result = await issueInConversation(app.prisma, deps(), {
      tenantId,
      conversationId,
      couponId: body.couponId,
      agentId: request.agent.id,
      agentName: agent?.name ?? undefined,
      expectedAssigneeId: body.expectedAssigneeId,
      requestKey: body.requestKey,
    });
    if (!result.ok) {
      const f = FAILURES[result.reason];
      return reply.status(f.status).send({
        success: false,
        error: { code: result.reason, message: f.message, ...(result.details ? { details: result.details } : {}) },
      });
    }
    const { ok: _ok, ...data } = result;
    return { success: true, data };
  });

  app.get('/requests/:requestKey', { preHandler: [requirePermission('coupon.issue')] }, async (request) => {
    const { requestKey } = z.object({ requestKey: z.string().uuid('發送鍵格式不正確') }).parse(request.params);
    return { success: true, data: await getIssueRequest(deps(), request.agent.tenantId, requestKey) };
  });

  app.get('/conversations/:conversationId/issued', { preHandler: [requirePermission('coupon.view')] }, async (request, reply) => {
    const { conversationId } = paramsSchema.parse(request.params);
    await assertConversationChannelVisible(request, conversationId, 'read_only');
    const list = await listIssuedCoupons(request.tenantPrisma, request.agent.tenantId, conversationId);
    if (!list) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: FAILURES.NOT_FOUND.message } });
    }
    return { success: true, data: list };
  });
}
