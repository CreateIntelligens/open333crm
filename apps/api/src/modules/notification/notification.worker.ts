/**
 * Notification event-bus worker.
 *
 * Subscribes to application events and enqueues notification jobs.
 * Actual DB persistence and socket delivery are handled by apps/workers.
 */

import type { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { eventBus } from '../../events/event-bus.js';
import type { AppEvent } from '../../events/event-bus.js';
import { logger } from '@open333crm/core';
import { sendQuotaWarningEmail, sendQuotaCriticalEmail } from '../trial/usage-alert-emails.js';

// Lazy init：避免在 dotenv 載入前讀到 undefined REDIS_URL，
// ioredis fallback default 6379 會噴一堆 ECONNREFUSED 噪音
let _notificationQueue: Queue | null = null;
function notificationQueue(): Queue {
  if (!_notificationQueue) {
    _notificationQueue = new Queue('notification', {
      connection: { url: process.env.REDIS_URL! },
    });
  }
  return _notificationQueue;
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
  return agents.map((a) => a.id);
}

export function setupNotificationWorker(prisma: PrismaClient) {
  // ── case.assigned ──────────────────────────────────────────────────────
  eventBus.subscribe('case.assigned', async (event: AppEvent) => {
    try {
      const { caseId, assigneeId, title } = event.payload as {
        caseId: string;
        assigneeId: string;
        title?: string;
      };

      if (!assigneeId) return;

      await notificationQueue().add('notification:dispatch', {
        tenantId: event.tenantId,
        agentId: assigneeId,
        type: 'case_assigned',
        title: '工單已指派給您',
        body: title ? `工單「${title}」已指派給您處理` : '您有一張新的指派工單',
        clickUrl: `/dashboard/cases/${caseId}`,
      }).catch((err) => logger.error('[NotificationWorker] Failed to enqueue case.assigned', err));

      logger.info(`[NotificationWorker] case.assigned → agent ${assigneeId}`);
    } catch (err) {
      logger.error('[NotificationWorker] Error handling case.assigned:', err);
    }
  });

  // ── case.escalated ─────────────────────────────────────────────────────
  eventBus.subscribe('case.escalated', async (event: AppEvent) => {
    try {
      const { caseId, reason } = event.payload as {
        caseId: string;
        reason?: string;
      };

      const supervisorIds = await getSupervisorAndAdminIds(prisma, event.tenantId);

      for (const agentId of supervisorIds) {
        await notificationQueue().add('notification:dispatch', {
          tenantId: event.tenantId,
          agentId,
          type: 'case_escalated',
          title: '工單已升級',
          body: reason ? `工單已升級：${reason}` : '有一張工單已升級，請注意處理',
          clickUrl: `/dashboard/cases/${caseId}`,
        }).catch((err) => logger.error('[NotificationWorker] Failed to enqueue case.escalated', err));
      }

      logger.info(`[NotificationWorker] case.escalated → ${supervisorIds.length} supervisor(s)/admin(s)`);
    } catch (err) {
      logger.error('[NotificationWorker] Error handling case.escalated:', err);
    }
  });

  // ── sla.warning ────────────────────────────────────────────────────────
  eventBus.subscribe('sla.warning', async (event: AppEvent) => {
    try {
      const { caseId, assigneeId, title } = event.payload as {
        caseId: string;
        assigneeId?: string;
        title?: string;
      };

      if (!assigneeId) return;

      await notificationQueue().add('notification:dispatch', {
        tenantId: event.tenantId,
        agentId: assigneeId,
        type: 'sla_warning',
        title: 'SLA 即將到期',
        body: title ? `工單「${title}」的 SLA 即將到期，請加速處理` : '您有一張工單的 SLA 即將到期',
        clickUrl: `/dashboard/cases/${caseId}`,
      }).catch((err) => logger.error('[NotificationWorker] Failed to enqueue sla.warning', err));

      logger.info(`[NotificationWorker] sla.warning → agent ${assigneeId}`);
    } catch (err) {
      logger.error('[NotificationWorker] Error handling sla.warning:', err);
    }
  });

  // ── sla.breached ───────────────────────────────────────────────────────
  eventBus.subscribe('sla.breached', async (event: AppEvent) => {
    try {
      const { caseId, assigneeId, title } = event.payload as {
        caseId: string;
        assigneeId?: string;
        title?: string;
      };

      const notifyIds: string[] = [];
      if (assigneeId) notifyIds.push(assigneeId);

      // Also notify supervisors and admins
      const supervisorIds = await getSupervisorAndAdminIds(prisma, event.tenantId);
      for (const sid of supervisorIds) {
        if (!notifyIds.includes(sid)) notifyIds.push(sid);
      }

      for (const agentId of notifyIds) {
        await notificationQueue().add('notification:dispatch', {
          tenantId: event.tenantId,
          agentId,
          type: 'sla_breached',
          title: 'SLA 已逾期',
          body: title ? `工單「${title}」的 SLA 已逾期，請立即處理` : '有一張工單的 SLA 已逾期',
          clickUrl: `/dashboard/cases/${caseId}`,
        }).catch((err) => logger.error('[NotificationWorker] Failed to enqueue sla.breached', err));
      }

      logger.info(`[NotificationWorker] sla.breached → ${notifyIds.length} agent(s)`);
    } catch (err) {
      logger.error('[NotificationWorker] Error handling sla.breached:', err);
    }
  });

  // ── message.received ───────────────────────────────────────────────────
  eventBus.subscribe('message.received', async (event: AppEvent) => {
    try {
      const { conversationId } = event.payload as {
        conversationId?: string;
      };

      if (!conversationId) return;

      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, tenantId: event.tenantId },
        select: { assignedToId: true, contactId: true, contact: { select: { displayName: true } } },
      });

      if (!conversation) return;

      const contactName = conversation.contact.displayName;
      const notifPayload = {
        tenantId: event.tenantId,
        type: 'new_message',
        title: '收到新訊息',
        body: `${contactName} 傳來新訊息`,
        clickUrl: `/dashboard/inbox?conv=${conversationId}`,
      };

      if (conversation.assignedToId) {
        // Assigned → notify the assigned agent only
        await notificationQueue().add('notification:dispatch', {
          ...notifPayload,
          agentId: conversation.assignedToId,
        }).catch((err) => logger.error('[NotificationWorker] Failed to enqueue message.received', err));
      } else {
        // Unassigned → notify all ADMIN and SUPERVISOR agents
        const adminAndSupervisorIds = await getSupervisorAndAdminIds(prisma, event.tenantId);
        for (const agentId of adminAndSupervisorIds) {
          await notificationQueue().add('notification:dispatch', {
            ...notifPayload,
            agentId,
          }).catch((err) => logger.error('[NotificationWorker] Failed to enqueue message.received (unassigned)', err));
        }
        logger.info(`[NotificationWorker] message.received (unassigned) → ${adminAndSupervisorIds.length} admin(s)/supervisor(s)`);
      }
    } catch (err) {
      logger.error('[NotificationWorker] Error handling message.received:', err);
    }
  });

  // ── conversation.assigned ──────────────────────────────────────────────
  eventBus.subscribe('conversation.assigned', async (event: AppEvent) => {
    try {
      const { conversationId, assignedToId } = event.payload as {
        conversationId?: string;
        assignedToId?: string;
      };

      if (!assignedToId || !conversationId) return;

      await notificationQueue().add('notification:dispatch', {
        tenantId: event.tenantId,
        agentId: assignedToId,
        type: 'new_message',
        title: '對話已指派給您',
        body: '您有一則新的對話指派',
        clickUrl: `/dashboard/inbox?conv=${conversationId}`,
      }).catch((err) => logger.error('[NotificationWorker] Failed to enqueue conversation.assigned', err));

      logger.info(`[NotificationWorker] conversation.assigned → agent ${assignedToId}`);
    } catch (err) {
      logger.error('[NotificationWorker] Error handling conversation.assigned:', err);
    }
  });

  // ── usage.quota.threshold（AI 用量達 80%/100% 告警給租戶 ADMIN）──────────
  eventBus.subscribe('usage.quota.threshold', async (event: AppEvent) => {
    try {
      const { level, usedTokens, limitTokens, monthKey } = event.payload as {
        level: 'warning' | 'critical';
        usedTokens: number;
        limitTokens: number;
        monthKey: string;
      };

      // 查該租戶 ADMIN（id+email）+ 租戶名（email 標題用）
      const [admins, tenant] = await Promise.all([
        prisma.agent.findMany({
          where: { tenantId: event.tenantId, role: 'ADMIN', isActive: true },
          select: { id: true, email: true },
        }),
        prisma.tenant.findUnique({ where: { id: event.tenantId }, select: { name: true } }),
      ]);
      if (admins.length === 0) {
        logger.warn(`[NotificationWorker] usage.quota.threshold: tenant ${event.tenantId} 無 ADMIN，跳過`);
        return;
      }

      const siteName = tenant?.name ?? '您的站台';
      const isCritical = level === 'critical';
      const emailVars = {
        siteName,
        usedTokens: usedTokens.toLocaleString(),
        limitTokens: limitTokens.toLocaleString(),
        monthKey,
        usageUrl: '/dashboard/plan',
      };

      // 逐 ADMIN 隔離：站內通知 + email，任一失敗不影響其他
      for (const admin of admins) {
        // 站內通知（複用既有 notification:dispatch job/handler）
        await notificationQueue()
          .add('notification:dispatch', {
            tenantId: event.tenantId,
            agentId: admin.id,
            type: isCritical ? 'usage_quota_critical' : 'usage_quota_warning',
            title: isCritical ? 'AI 用量已達上限' : 'AI 用量已達 80%',
            body: isCritical
              ? `本月 AI 用量已達上限（${emailVars.usedTokens}/${emailVars.limitTokens} tokens），AI 自動回覆暫停，真人回覆不受影響。`
              : `本月 AI 用量已達 80%（${emailVars.usedTokens}/${emailVars.limitTokens} tokens），額度用盡後 AI 自動回覆將暫停。`,
            clickUrl: '/dashboard/plan',
          })
          .catch((err) => logger.error('[NotificationWorker] Failed to enqueue usage.quota notification', err));

        // email（fire-and-forget，失敗只 log）
        const sendEmailFn = isCritical ? sendQuotaCriticalEmail : sendQuotaWarningEmail;
        sendEmailFn(admin.email, emailVars).catch((err) =>
          logger.error('[NotificationWorker] usage.quota email failed', err),
        );
      }

      logger.info(
        `[NotificationWorker] usage.quota.threshold(${level}) → ${admins.length} admin(s) of tenant ${event.tenantId}`,
      );
    } catch (err) {
      logger.error('[NotificationWorker] Error handling usage.quota.threshold:', err);
    }
  });

  logger.info(
    '[NotificationWorker] Subscribed to events: case.assigned, case.escalated, sla.warning, sla.breached, message.received, conversation.assigned, usage.quota.threshold',
  );
}
