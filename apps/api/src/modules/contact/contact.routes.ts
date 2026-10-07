import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listContacts,
  getContact,
  updateContact,
  getContactConversations,
  getContactMessages,
  getContactCases,
  addContactTag,
  removeContactTag,
  getContactTimeline,
  getMergePreview,
  mergeContacts,
} from './contact.service.js';
import { listMergeLogs, revertMerge } from './contact-merge.service.js';
import { getBindingStore } from '../identity-binding/binding-code.js';
import {
  findBindingActorForConversation,
  getIdentityBindingSettings,
  issueBindingCode,
} from '../identity-binding/identity-binding.service.js';
import { issueEmailRegistrationLink } from '../identity-binding/email-registration.service.js';
import { withTenant } from '../../lib/tenant-db.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import { assertConversationChannelVisible, resolveChannelVisibility } from '../../services/channel-visibility.js';
import { success, paginated, AppError } from '../../shared/utils/response.js';
import { writeTenantAudit } from '../tenant-audit/tenant-audit.service.js';

const listQuerySchema = z.object({
  q: z.string().optional(),
  tagId: z.string().uuid().optional(),
  channelType: z.string().optional(),
  excludeChannelType: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const updateContactSchema = z.object({
  displayName: z.string().trim().min(1, '名稱不可為空白').max(200, '名稱不可超過 200 字').optional(),
  phone: z.string().nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  language: z.string().optional(),
  isBlocked: z.boolean().optional(),
  /** email 與其他聯絡人重複（409 EMAIL_IN_USE）後，客服確認仍要儲存 */
  allowDuplicateEmail: z.boolean().optional(),
});

const contactMessagesQuerySchema = z.object({
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const addTagSchema = z.object({
  tagId: z.string().uuid(),
});

const mergeLogParamsSchema = z.object({
  logId: z.string().uuid('合併紀錄 id 格式錯誤'),
});

const bindingLinkBodySchema = z.object({
  conversationId: z.string().uuid('對話 id 格式錯誤'),
});

const contactIdParamsSchema = z.object({
  id: z.string().uuid('聯絡人 id 格式錯誤'),
});

const mergePreviewQuerySchema = z.object({
  primaryId: z.string().uuid(),
  secondaryId: z.string().uuid(),
});

const mergeBodySchema = z.object({
  primaryContactId: z.string().uuid(),
  secondaryContactId: z.string().uuid(),
});

// 聯絡人路由的權限守門集中在這裡（RBAC 權限點早已定義，先前多數路由未套用，只要登入即可存取）。
// 新增聯絡人路由時請從這張表選用，不要漏掉守門；路由層測試見 test:contact-routes-permission
const perm = {
  view: requirePermission('contact.view'),
  update: requirePermission('contact.update'),
  merge: requirePermission('contact.merge'),
  inboxView: requirePermission('inbox.view'),
  // 代發綁定連結＝在對話中發訊息給顧客，屬回覆層級（不是「編輯聯絡人」）
  inboxReply: requirePermission('inbox.reply'),
  caseView: requirePermission('case.view'),
};

export default async function contactRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/contacts
  fastify.get('/', { preHandler: [perm.view] }, async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, ...filters } = query;

    const { contacts, total } = await listContacts(
      request.tenantPrisma,
      request.agent.tenantId,
      filters,
      { page, limit },
      await resolveChannelVisibility(request),
    );

    return reply.send(paginated(contacts, total, page, limit));
  });

  // GET /api/v1/contacts/merge-preview?primaryId=X&secondaryId=Y
  // Must be before /:id to avoid being captured as a param
  fastify.get('/merge-preview', { preHandler: [perm.merge] }, async (request, reply) => {
    const query = mergePreviewQuerySchema.parse(request.query);

    const preview = await getMergePreview(
      request.tenantPrisma,
      request.agent.tenantId,
      query.primaryId,
      query.secondaryId,
    );

    return reply.send(success(preview));
  });

  // POST /api/v1/contacts/merge
  fastify.post('/merge', { preHandler: [perm.merge] }, async (request, reply) => {
    const body = mergeBodySchema.parse(request.body);

    const result = await withTenant(fastify.prisma, request.agent.tenantId, (tx) =>
      mergeContacts(
        tx,
        fastify.io,
        request.agent.tenantId,
        body.primaryContactId,
        body.secondaryContactId,
        request.agent.id,
      ),
    );

    // 稽核：合併聯絡人（只放兩造 id，不放姓名/電話等 PII 明文）
    await writeTenantAudit(request.tenantPrisma, {
      tenantId: request.agent.tenantId,
      actorId: request.agent.id,
      action: 'contact.merge',
      targetType: 'contact',
      targetId: body.primaryContactId,
      payload: { primaryContactId: body.primaryContactId, secondaryContactId: body.secondaryContactId },
      ip: request.ip,
    });

    return reply.send(success(result));
  });

  // POST /api/v1/contacts/merge-logs/:logId/revert — 解除一次合併（任何來源皆可）
  fastify.post<{ Params: { logId: string } }>(
    '/merge-logs/:logId/revert',
    { preHandler: [perm.merge] },
    async (request, reply) => {
      const { logId } = mergeLogParamsSchema.parse(request.params);
      const tenantId = request.agent.tenantId;

      const result = await withTenant(fastify.prisma, tenantId, (tx) =>
        revertMerge(tx, { tenantId, mergeLogId: logId, revertedBy: request.agent.id }),
      );

      fastify.io.to(`tenant:${tenantId}`).emit('contact.merge_reverted', {
        mergeLogId: logId,
        survivorId: result.holderId,
        restoredContactId: result.restoredContactId,
      });

      await writeTenantAudit(request.tenantPrisma, {
        tenantId,
        actorId: request.agent.id,
        action: 'contact.merge_revert',
        targetType: 'contact',
        targetId: result.restoredContactId,
        payload: { mergeLogId: logId, survivorId: result.survivorId, source: result.source },
        ip: request.ip,
      });

      return reply.send(success(result));
    },
  );

  // GET /api/v1/contacts/identity-binding/status — 收件匣判斷是否顯示「傳送綁定連結」按鈕
  // （完整設定 API 需 settings.manage，一般客服讀不到；這裡只回是否啟用）
  fastify.get('/identity-binding/status', { preHandler: [perm.inboxReply] }, async (request, reply) => {
    const settings = await getIdentityBindingSettings(request.tenantPrisma, request.agent.tenantId);
    return reply.send(success({ enabled: settings.enabled, emailEnabled: settings.emailEnabled }));
  });

  // POST /api/v1/contacts/:id/binding-link — 客服代顧客在指定對話送出跨渠道綁定連結
  fastify.post<{ Params: { id: string } }>(
    '/:id/binding-link',
    { preHandler: [perm.inboxReply] },
    async (request, reply) => {
      const { id } = contactIdParamsSchema.parse(request.params);
      const { conversationId } = bindingLinkBodySchema.parse(request.body);
      const tenantId = request.agent.tenantId;

      // CM-173：送訊息進對話屬「回覆」層級，分店帳號不可對看不到或唯讀的渠道發綁定邀請
      await assertConversationChannelVisible(request, conversationId, 'reply_only');

      const db = request.tenantPrisma;
      const settings = await getIdentityBindingSettings(db, tenantId);
      if (!settings.enabled) {
        throw new AppError('尚未開啟跨渠道綁定，請先到「設定」啟用', 'BINDING_DISABLED', 400);
      }
      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, tenantId, contactId: id },
        select: { id: true, channelId: true, channel: { select: { channelType: true } } },
      });
      if (!conversation) throw new AppError('找不到此聯絡人的這個對話', 'NOT_FOUND', 404);
      const identity = await db.channelIdentity.findFirst({
        where: { contactId: id, channelId: conversation.channelId },
        select: { id: true, uid: true },
      });
      if (!identity) throw new AppError('此對話的渠道身分不存在，無法傳送綁定連結', 'NOT_FOUND', 404);

      // 不包在交易內：發碼會推播到 LINE/FB 並寫 Redis，外部呼叫放進交易會拖長交易、
      // 逾時回滾時顧客已收到代碼但對話紀錄消失
      const result = await issueBindingCode(db, { store: getBindingStore(), io: fastify.io }, {
        tenantId,
        channelId: conversation.channelId,
        channelType: conversation.channel.channelType,
        channelIdentityId: identity.id,
        uid: identity.uid,
        contactId: id,
        conversationId: conversation.id,
      }, 'agent');

      await writeTenantAudit(request.tenantPrisma, {
        tenantId,
        actorId: request.agent.id,
        action: 'contact.binding_link_send',
        targetType: 'contact',
        targetId: id,
        payload: { conversationId, status: result.status },
        ip: request.ip,
      });

      // 不回傳代碼本身：代碼即憑證，只該出現在顧客的對話裡
      return reply.send(success({ status: result.status, targets: result.status === 'sent' ? result.targets : 0 }));
    },
  );

  // POST /api/v1/contacts/:id/email-registration-link — 客服代顧客在指定對話送出 email 登記連結
  // （change add-email-identity-merge）。權限與渠道層級同傳送綁定連結
  fastify.post<{ Params: { id: string } }>(
    '/:id/email-registration-link',
    { preHandler: [perm.inboxReply] },
    async (request, reply) => {
      const { id } = contactIdParamsSchema.parse(request.params);
      const { conversationId } = bindingLinkBodySchema.parse(request.body);
      const tenantId = request.agent.tenantId;

      await assertConversationChannelVisible(request, conversationId, 'reply_only');

      const db = request.tenantPrisma;
      const settings = await getIdentityBindingSettings(db, tenantId);
      if (!settings.emailEnabled) {
        throw new AppError('尚未開啟 email 登記，請先到「設定」啟用', 'EMAIL_REGISTRATION_DISABLED', 400);
      }
      const actor = await findBindingActorForConversation(db, tenantId, id, conversationId);
      if (!actor) throw new AppError('找不到此聯絡人在這個對話的渠道身分', 'NOT_FOUND', 404);

      // 不包在交易內：推播到渠道是外部呼叫（同傳送綁定連結）
      const result = await issueEmailRegistrationLink(db, { store: getBindingStore(), io: fastify.io }, actor, 'agent');

      await writeTenantAudit(request.tenantPrisma, {
        tenantId,
        actorId: request.agent.id,
        action: 'contact.email_registration_link_send',
        targetType: 'contact',
        targetId: id,
        payload: { conversationId, status: result.status },
        ip: request.ip,
      });

      // 不回傳連結本身：連結即憑證，只該出現在顧客的對話裡
      return reply.send(success({ status: result.status }));
    },
  );

  // GET /api/v1/contacts/:id/merge-logs — 此聯絡人相關的合併紀錄（新到舊）
  fastify.get<{ Params: { id: string } }>('/:id/merge-logs', { preHandler: [perm.view] }, async (request, reply) => {
    const { id } = contactIdParamsSchema.parse(request.params);
    const logs = await listMergeLogs(request.tenantPrisma, request.agent.tenantId, id);
    return reply.send(success(logs));
  });

  // GET /api/v1/contacts/:id
  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: [perm.view] }, async (request, reply) => {
    const contact = await getContact(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
      await resolveChannelVisibility(request),
    );

    return reply.send(success(contact));
  });

  // PATCH /api/v1/contacts/:id
  fastify.patch<{ Params: { id: string } }>('/:id', { preHandler: [perm.update] }, async (request, reply) => {
    const data = updateContactSchema.parse(request.body);

    const contact = await updateContact(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
      data,
    );

    return reply.send(success(contact));
  });

  // GET /api/v1/contacts/:id/conversations
  fastify.get<{ Params: { id: string } }>('/:id/conversations', { preHandler: [perm.view, perm.inboxView] }, async (request, reply) => {
    const query = paginationQuerySchema.parse(request.query);

    const { conversations, total, hiddenCount } = await getContactConversations(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
      query.page,
      query.limit,
      // CM-173：與收件匣一致，分店帳號只看得到可見渠道的對話
      await resolveChannelVisibility(request),
    );

    return reply.send(
      success(conversations, {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(total / query.limit),
        hiddenCount,
      }),
    );
  });

  // GET /api/v1/contacts/:id/messages — 所有可見渠道的訊息，依時間排成一條（change add-email-identity-merge）
  fastify.get<{ Params: { id: string } }>('/:id/messages', { preHandler: [perm.view, perm.inboxView] }, async (request, reply) => {
    const { id } = contactIdParamsSchema.parse(request.params);
    const query = contactMessagesQuerySchema.parse(request.query);
    const result = await getContactMessages(
      request.tenantPrisma,
      id,
      request.agent.tenantId,
      await resolveChannelVisibility(request),
      query,
    );
    return reply.send(success(result));
  });

  // GET /api/v1/contacts/:id/cases
  fastify.get<{ Params: { id: string } }>('/:id/cases', { preHandler: [perm.view, perm.caseView] }, async (request, reply) => {
    const query = paginationQuerySchema.parse(request.query);

    const { cases, total } = await getContactCases(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
      query.page,
      query.limit,
      // CM-173：與案件列表一致，分店帳號只看得到可見渠道的案件
      await resolveChannelVisibility(request),
    );

    return reply.send(paginated(cases, total, query.page, query.limit));
  });

  // POST /api/v1/contacts/:id/tags
  fastify.post<{ Params: { id: string } }>('/:id/tags', { preHandler: [perm.update] }, async (request, reply) => {
    const body = addTagSchema.parse(request.body);

    const contactTag = await addContactTag(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
      body.tagId,
      request.agent.id,
    );

    return reply.status(201).send(success(contactTag));
  });

  // DELETE /api/v1/contacts/:id/tags/:tagId
  fastify.delete<{ Params: { id: string; tagId: string } }>(
    '/:id/tags/:tagId',
    { preHandler: [perm.update] },
    async (request, reply) => {
      await removeContactTag(
        request.tenantPrisma,
        request.params.id,
        request.agent.tenantId,
        request.params.tagId,
      );

      return reply.send(success({ deleted: true }));
    },
  );

  // GET /api/v1/contacts/:id/timeline
  fastify.get<{ Params: { id: string } }>('/:id/timeline', { preHandler: [perm.view] }, async (request, reply) => {
    const timeline = await getContactTimeline(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
      // CM-173：時間軸的對話與案件只列可見渠道
      await resolveChannelVisibility(request),
    );

    return reply.send(success(timeline));
  });
}
