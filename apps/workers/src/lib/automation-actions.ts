import type { PrismaClient } from '@prisma/client';
import type IORedis from 'ioredis';
import type { ChannelPlugin } from '@open333crm/channel-plugins';
import { bumpSlaPriority } from '@open333crm/shared';
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

export async function executeWorkerAutomationActions(
  prisma: PrismaClient,
  redisPublisher: IORedis,
  actions: WorkerAutomationAction[],
  context: WorkerActionContext,
): Promise<void> {
  for (const action of actions) {
    try {
      const params = action.params ?? action.payload ?? {};

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

      logger.info(`[automation] Unsupported worker action "${action.type}" skipped`);
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
