import type { PrismaClient } from '@prisma/client';
import type IORedis from 'ioredis';
import type { ChannelPlugin } from '@open333crm/channel-plugins';
import { bumpSlaPriority, CASE_CATEGORIES } from '@open333crm/shared';
import { logger } from '@open333crm/core';
import { publishSocketEvent, publishDomainEvent } from './socket-bridge.js';
import { enqueueNotification } from './notification-queue.js';
import { deliverToChannelFromWorker, renderTemplateBody } from './channel-delivery.js';

export interface WorkerAutomationAction {
  type: string;
  params?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

export interface WorkerActionContext {
  tenantId: string;
  caseId?: string | null;
  conversationId?: string | null;
  contactId?: string | null;
  trigger?: string | null;
  replyToken?: string | null;
  receivedAt?: string | null;
  assigneeId?: string | null;
  title?: string | null;
  // 送 channel 訊息（send_message / send_material）需要 plugin registry + redis
  pluginRegistry?: Map<string, ChannelPlugin>;
}

function keywordReplyDelivery(context: WorkerActionContext) {
  return context.trigger === 'keyword.matched' && context.replyToken
    ? { strategy: 'reply' as const, replyToken: context.replyToken, receivedAt: context.receivedAt ?? undefined }
    : undefined;
}

async function getSupervisorAndAdminIds(
  prisma: PrismaClient,
  tenantId: string,
): Promise<string[]> {
  const agents = await prisma.agent.findMany({
    where: {
      tenantId,
      role: { in: ['SUPERVISOR', 'ADMIN'] },
      isActive: true,
    },
    select: { id: true },
  });
  return agents.map((agent) => agent.id);
}

const CASE_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
/** 已結案的工單：對話上掛的是這種工單時，自動化可以開新單並改關聯 */
const CLOSED_CASE_STATUSES = new Set(['RESOLVED', 'CLOSED']);

/**
 * create_case：條件命中時自動建立工單（AUDIT AUTO-01 補實作）。行為與手動「由對話建立工單」一致：
 * 依優先度套 SLA 政策、對話關聯到新工單、寫入工單事件（actorType automation）、即時推播，
 * 並經 domain event 橋接發出 case.created，讓通知與「工單建立」觸發的規則照常運作。
 *
 * 不建立的情況（皆留 warn）：
 *   - 觸發事件是工單或 SLA 相關：工單已存在，而且「工單建立 → 建立工單」會無限迴圈
 *   - 沒有對話：工單的渠道取自對話
 *   - 對話已關聯未結案的工單：不重複開，避免顧客一直傳訊息就開一堆工單
 * 成功時回傳新工單 id，呼叫端寫回 context.caseId。目前契約不允許訊息類事件使用工單動作（指派、改狀態需要 case 範圍），
 * 寫回只是讓日後開放時，後續動作能作用在新工單上。
 */
async function createCaseFromAutomation(
  prisma: PrismaClient,
  redisPublisher: IORedis,
  params: Record<string, unknown>,
  context: WorkerActionContext,
): Promise<string | null> {
  const { tenantId } = context;
  if (context.trigger && /^(case|sla)\./.test(context.trigger)) {
    logger.warn(`[automation] create_case skipped: trigger "${context.trigger}" is a case/SLA event`);
    return null;
  }
  const title = typeof params['title'] === 'string' ? params['title'].trim() : '';
  if (!title || !context.conversationId) {
    logger.warn('[automation] create_case skipped: missing title or conversation', { tenantId });
    return null;
  }

  // worker 走 BYPASSRLS 連線：每個查詢都要自帶 tenantId
  const conversation = await prisma.conversation.findFirst({
    where: { id: context.conversationId, tenantId },
    select: { id: true, contactId: true, channelId: true, caseId: true },
  });
  if (!conversation) {
    logger.warn('[automation] create_case skipped: conversation not found in tenant', { tenantId });
    return null;
  }
  if (conversation.caseId) {
    const existing = await prisma.case.findFirst({
      where: { id: conversation.caseId, tenantId },
      select: { id: true, status: true },
    });
    if (existing && !CLOSED_CASE_STATUSES.has(existing.status)) {
      logger.info(`[automation] create_case skipped: conversation already has open case ${existing.id}`);
      return existing.id;
    }
  }

  const priority =
    typeof params['priority'] === 'string' && CASE_PRIORITIES.has(params['priority']) ? params['priority'] : 'MEDIUM';
  // 分類只收系統清單內的值（與手動建單的驗證一致）；不合法就不寫分類，工單照開
  const rawCategory = typeof params['category'] === 'string' ? params['category'].trim() : '';
  const category = (CASE_CATEGORIES as readonly string[]).includes(rawCategory) ? rawCategory : null;
  if (rawCategory && !category) logger.warn(`[automation] create_case: unknown category "${rawCategory}" ignored`);
  const slaPolicy = await prisma.slaPolicy.findFirst({ where: { tenantId, priority: priority as any } });
  const slaDueAt = slaPolicy ? new Date(Date.now() + slaPolicy.resolutionMinutes * 60_000) : null;

  // 建單、關聯對話、寫事件放在同一個交易；關聯用條件式更新（對話仍是讀取時的狀態才寫入）：
  // 多個 worker 同時處理同一段對話（例如 message.received 與 keyword.matched 兩個 job）時，
  // 後到的會因條件不成立而回滾，不會開出兩張工單，也不會留下沒有對話的孤兒工單
  const RACED = 'create_case_raced';
  let created: { id: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      const c = await tx.case.create({
        data: {
          tenantId,
          contactId: conversation.contactId,
          channelId: conversation.channelId,
          title,
          priority: priority as any,
          category,
          status: 'OPEN',
          slaPolicy: slaPolicy?.name ?? null,
          slaDueAt,
        },
      });
      const linked = await tx.conversation.updateMany({
        where: { id: conversation.id, tenantId, OR: [{ caseId: conversation.caseId }] },
        data: { caseId: c.id },
      });
      if (linked.count !== 1) throw new Error(RACED);
      await tx.caseEvent.create({
        data: {
          caseId: c.id,
          actorType: 'automation',
          actorId: null,
          eventType: 'created',
          payload: { title, priority, category, trigger: context.trigger ?? null },
        },
      });
      return c;
    });
  } catch (err) {
    if (err instanceof Error && err.message === RACED) {
      logger.info('[automation] create_case skipped: conversation was linked to a case concurrently');
      return null;
    }
    throw err;
  }

  await publishSocketEvent(redisPublisher, `tenant:${tenantId}`, 'case.created', {
    id: created.id,
    status: 'OPEN',
    priority,
    assigneeId: null,
    title,
  });
  await publishDomainEvent(redisPublisher, 'case.created', tenantId, {
    caseId: created.id,
    contactId: conversation.contactId,
    channelId: conversation.channelId,
    title,
    priority,
    status: 'OPEN',
    conversationId: conversation.id,
  }).catch((err) => logger.warn('[automation] publish case.created bridge failed:', err));
  return created.id;
}

export async function executeWorkerAutomationActions(
  prisma: PrismaClient,
  redisPublisher: IORedis,
  actions: WorkerAutomationAction[],
  context: WorkerActionContext,
): Promise<void> {
  for (const action of actions) {
    try {
      const params = action.params ?? action.payload ?? {};

      if (action.type === 'create_case') {
        const caseId = await createCaseFromAutomation(prisma, redisPublisher, params, context);
        if (caseId) context.caseId = caseId;
        continue;
      }

      if (action.type === 'assign_agent') {
        const agentId = params['agentId'];
        if (typeof agentId === 'string' && agentId && context.caseId) {
          await prisma.case.update({
            where: { id: context.caseId },
            data: { assigneeId: agentId },
          });
          await publishSocketEvent(redisPublisher, `tenant:${context.tenantId}`, 'case.updated', {
            id: context.caseId,
            assigneeId: agentId,
            source: 'sla_worker',
          });
        }
        continue;
      }

      if (action.type === 'add_tag') {
        // 對觸發對象（聯絡人）加標籤。前端存 tagName（標籤名稱），也相容 tagId。
        // 缺 contactId 或標籤資訊則安全跳過。
        const rawTagId = params['tagId'];
        const rawTagName = params['tagName'];
        const tagId = typeof rawTagId === 'string' && rawTagId ? rawTagId : null;
        const tagName = typeof rawTagName === 'string' && rawTagName.trim() ? rawTagName.trim() : null;
        if (!tagId && !tagName) {
          logger.info('[automation] Worker action "add_tag" skipped: missing tagId/tagName');
          continue;
        }
        if (!context.contactId) {
          logger.info('[automation] Worker action "add_tag" skipped: no contact in context');
          continue;
        }
        // 解析出本租戶的 tag：優先用 tagId，否則依名稱找、找不到則建立（同租戶自動化常態）
        let tag = tagId
          ? await prisma.tag.findFirst({ where: { id: tagId, tenantId: context.tenantId }, select: { id: true, name: true } })
          : await prisma.tag.findFirst({ where: { name: tagName!, tenantId: context.tenantId }, select: { id: true, name: true } });
        if (!tag && tagName) {
          tag = await prisma.tag.create({
            data: { tenantId: context.tenantId, name: tagName },
            select: { id: true, name: true },
          });
        }
        if (!tag) {
          logger.info('[automation] Worker action "add_tag" skipped: tag not found in tenant');
          continue;
        }
        // 冪等貼標（upsert，對齊 tagging.service 語意；worker 跨 process 無法 import api service）
        await prisma.contactTag.upsert({
          where: { contactId_tagId: { contactId: context.contactId, tagId: tag.id } },
          update: {},
          create: { contactId: context.contactId, tagId: tag.id, addedBy: 'automation' },
        });
        logger.info(`[automation] add_tag: tagged contact ${context.contactId} with ${tag.id}`);
        // 橋接 contact.tagged 回 api eventBus（source='automation'，供下游規則；迴圈防護在 api 端）
        await publishDomainEvent(redisPublisher, 'contact.tagged', context.tenantId, {
          contactId: context.contactId,
          tagId: tag.id,
          tagName: tag.name,
          source: 'automation',
        }).catch((err) => logger.warn('[automation] publish contact.tagged bridge failed:', err));
        continue;
      }

      if (action.type === 'remove_tag') {
        // 移除觸發對象（聯絡人）的標籤。和 add_tag 不同：找不到標籤時略過、不建立，
        // 並只找 CONTACT scope，避免名稱相同的工單、對話標籤（AUDIT AUTO-03 是 add_tag 的同類問題）
        const rawTagId = params['tagId'];
        const rawTagName = params['tagName'];
        const tagId = typeof rawTagId === 'string' && rawTagId ? rawTagId : null;
        const tagName = typeof rawTagName === 'string' && rawTagName.trim() ? rawTagName.trim() : null;
        if (!tagId && !tagName) {
          logger.info('[automation] Worker action "remove_tag" skipped: missing tagId/tagName');
          continue;
        }
        if (!context.contactId) {
          logger.info('[automation] Worker action "remove_tag" skipped: no contact in context');
          continue;
        }
        const tag = await prisma.tag.findFirst({
          where: tagId
            ? { id: tagId, tenantId: context.tenantId, scope: 'CONTACT' }
            : { name: tagName!, tenantId: context.tenantId, scope: 'CONTACT' },
          select: { id: true },
        });
        if (!tag) {
          logger.info('[automation] Worker action "remove_tag" skipped: tag not found in tenant');
          continue;
        }
        const removed = await prisma.contactTag.deleteMany({
          where: { contactId: context.contactId, tagId: tag.id },
        });
        logger.info(`[automation] remove_tag: removed ${removed.count} tag ${tag.id} from contact ${context.contactId}`);
        continue;
      }

      if (action.type === 'update_case_status') {
        const status = params['status'];
        if (typeof status === 'string' && status && context.caseId) {
          await prisma.case.update({
            where: { id: context.caseId },
            data: { status: status as any },
          });
          await publishSocketEvent(redisPublisher, `tenant:${context.tenantId}`, 'case.updated', {
            id: context.caseId,
            status,
            source: 'sla_worker',
          });
        }
        continue;
      }

      if (action.type === 'escalate_case' || action.type === 'set_case_priority') {
        if (!context.caseId) {
          logger.info(`[automation] Worker action "${action.type}" skipped: missing caseId`);
          continue;
        }

        const current = await prisma.case.findUnique({
          where: { id: context.caseId },
          select: { priority: true },
        });
        if (!current) continue;

        const configuredPriority = params['newPriority'] ?? params['priority'];
        const newPriority =
          typeof configuredPriority === 'string' && configuredPriority
            ? configuredPriority
            : bumpSlaPriority(current.priority);

        await prisma.case.update({
          where: { id: context.caseId },
          data: { priority: newPriority as any },
        });
        await publishSocketEvent(redisPublisher, `tenant:${context.tenantId}`, 'case.updated', {
          id: context.caseId,
          priority: newPriority,
          source: 'sla_worker',
        });
        continue;
      }

      if (action.type === 'notify' && context.assigneeId) {
        await enqueueNotification({
          tenantId: context.tenantId,
          agentId: context.assigneeId,
          type: 'sla_rule',
          title: 'SLA rule matched',
          body: String(params['message'] ?? 'A SLA rule matched.'),
          clickUrl: context.caseId ? `/dashboard/cases/${context.caseId}` : undefined,
        });
        continue;
      }

      if (action.type === 'notify_supervisor') {
        const agentIds = await getSupervisorAndAdminIds(prisma, context.tenantId);
        for (const agentId of agentIds) {
          await enqueueNotification({
            tenantId: context.tenantId,
            agentId,
            type: 'sla_rule',
            title: 'SLA rule matched',
            body: String(params['message'] ?? 'A SLA rule matched.'),
            clickUrl: context.caseId ? `/dashboard/cases/${context.caseId}` : undefined,
          });
        }
        continue;
      }

      // ── OUTBOUND actions（需 conversationId + pluginRegistry，主要用於 keyword.matched 對話回覆）──

      if (action.type === 'send_message') {
        if (!context.conversationId || !context.pluginRegistry) {
          logger.info('[automation] send_message skipped: missing conversationId/pluginRegistry');
          continue;
        }
        const text = String(params['text'] ?? params['message'] ?? '');
        if (!text) {
          logger.info('[automation] send_message skipped: empty text');
          continue;
        }
        await deliverToChannelFromWorker(
          prisma,
          redisPublisher,
          context.pluginRegistry,
          context.conversationId,
          { contentType: 'text', content: { text }, delivery: keywordReplyDelivery(context) },
        );
        continue;
      }

      if (action.type === 'send_material') {
        if (!context.conversationId || !context.pluginRegistry) {
          logger.info('[automation] send_material skipped: missing conversationId/pluginRegistry');
          continue;
        }
        const materialId = params['materialId'];
        if (typeof materialId !== 'string' || !materialId) {
          logger.info('[automation] send_material skipped: missing materialId');
          continue;
        }
        const material = await prisma.material.findFirst({
          where: { id: materialId, tenantId: context.tenantId },
          select: { contentType: true, body: true, channelType: true },
        });
        if (!material) {
          logger.warn(`[automation] send_material skipped: material ${materialId} not found`);
          continue;
        }

        // channel 防呆：素材 channelType 與對話 channel 不符就 skip（避免 FB 對話送 line_* 空訊息）
        const conv = await prisma.conversation.findFirst({
          where: { id: context.conversationId, tenantId: context.tenantId },
          include: { channel: { select: { channelType: true } } },
        });
        const convChannelType = conv?.channel?.channelType?.toLowerCase();
        const matChannelType = material.channelType?.toLowerCase();
        if (convChannelType && matChannelType && convChannelType !== matChannelType) {
          logger.warn(
            `[automation] send_material skipped: material channel "${matChannelType}" != conversation channel "${convChannelType}"`,
          );
          continue;
        }

        const variables = (params['variables'] as Record<string, string> | undefined) ?? {};
        const renderedBody = renderTemplateBody(
          material.body as Record<string, unknown>,
          variables,
        );
        await deliverToChannelFromWorker(
          prisma,
          redisPublisher,
          context.pluginRegistry,
          context.conversationId,
          { contentType: material.contentType, content: renderedBody, delivery: keywordReplyDelivery(context) },
        );
        continue;
      }

      // 規則編輯頁與列表會標示含不支援動作的規則（AUDIT AUTO-01）；這裡留 warn 供追查
      logger.warn(`[automation] Unsupported worker action "${action.type}" skipped`);
    } catch (err) {
      logger.error(`[automation] Worker action "${action.type}" failed`, { err });
    }
  }
}

export async function getSupervisorAndAdminAgentIds(
  prisma: PrismaClient,
  tenantId: string,
): Promise<string[]> {
  return getSupervisorAndAdminIds(prisma, tenantId);
}
