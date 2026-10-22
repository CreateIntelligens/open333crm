/**
 * 通知訂閱者：處理 event-notification 佇列的事件，送出 notification:dispatch job。
 * 站內通知的寫入與推播由 apps/workers 處理（change outbox-event-delivery，design 決策 10）。
 * job 送不出時丟錯，由 BullMQ 重試這個事件；job id 是 <事件 id>__<收件人 id>，重試不會重複送出。
 */

import type { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { createEventRouter, type EventHandler, type SubscribedEvent } from '../../events/subscriber-workers.js';
import { logger, USAGE_ALERT_EMAIL_QUEUE } from '@open333crm/core';
import type { UsageAlertEmailJob } from './usage-alert-email.worker.js';
import { getConfig } from '../../config/env.js';
import { resolveEscalationRecipients } from './notification.service.js';

// Lazy init：避免在 dotenv 載入前讀到 undefined REDIS_URL，
// ioredis fallback default 6379 會噴一堆 ECONNREFUSED 噪音
let _notificationQueue: Queue | null = null;
function notificationQueue(): Queue {
  if (!_notificationQueue) {
    _notificationQueue = new Queue('notification', {
      connection: { url: process.env.REDIS_URL! },
      // job id 由事件 id 組成：完成的 job 保留 24 小時，事件重送時 BullMQ 不建立第二個 job
      defaultJobOptions: { removeOnComplete: { age: 86_400 }, removeOnFail: { age: 604_800 } },
    });
  }
  return _notificationQueue;
}

let _usageAlertEmailQueue: Queue | null = null;
function usageAlertEmailQueue(): Queue {
  if (!_usageAlertEmailQueue) {
    _usageAlertEmailQueue = new Queue(USAGE_ALERT_EMAIL_QUEUE, {
      connection: { url: process.env.REDIS_URL! },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 604_800 },
      },
    });
  }
  return _usageAlertEmailQueue;
}

type DispatchData = { tenantId: string; type: string; title: string; body: string; clickUrl?: string };

/**
 * 送出站內通知的 job。job id 是 <事件 id>__<客服人員 id>：同一個事件通知同一位客服人員只有一個 job
 * （standalone-worker-runtime「同一個事件不重複建立站內通知」）。
 */
function enqueueDispatch(event: SubscribedEvent, agentId: string, data: DispatchData) {
  return notificationQueue().add('notification:dispatch', { ...data, agentId }, { jobId: `${event.id}__${agentId}` });
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

export function setupNotificationWorker(prisma: PrismaClient): EventHandler {
  const events = createEventRouter();

  // ── case.assigned ──────────────────────────────────────────────────────
  events.on('case.assigned', async (event: SubscribedEvent) => {
    try {
      const { caseId, assigneeId, title } = event.payload as {
        caseId: string;
        assigneeId: string;
        title?: string;
      };

      if (!assigneeId) return;

      await enqueueDispatch(event, assigneeId, {
        tenantId: event.tenantId,
        type: 'case_assigned',
        title: '工單已指派給您',
        body: title ? `工單「${title}」已指派給您處理` : '您有一張新的指派工單',
        clickUrl: `/dashboard/cases/${caseId}`,
      });

      logger.info(`[NotificationWorker] case.assigned → agent ${assigneeId}`);
    } catch (err) {
      logger.error('[NotificationWorker] Error handling case.assigned:', err);
      throw err;
    }
  });

  // ── case.escalated ─────────────────────────────────────────────────────
  events.on('case.escalated', async (event: SubscribedEvent) => {
    try {
      const { caseId, reason, notifyTargets, previousAssigneeId, actorId } = event.payload as {
        caseId: string;
        reason?: string;
        notifyTargets?: string[];
        previousAssigneeId?: string | null;
        actorId?: string | null;
      };

      // 依升級視窗的勾選決定通知誰（主管與管理員／升級前的指派人）
      const recipientIds = await resolveEscalationRecipients(prisma, event.tenantId, {
        notifyTargets,
        previousAssigneeId,
        actorId,
      });

      for (const agentId of recipientIds) {
        await enqueueDispatch(event, agentId, {
          tenantId: event.tenantId,
          type: 'case_escalated',
          title: '工單已升級',
          body: reason ? `工單已升級：${reason}` : '有一張工單已升級，請注意處理',
          clickUrl: `/dashboard/cases/${caseId}`,
        });
      }

      logger.info(`[NotificationWorker] case.escalated → ${recipientIds.length} recipient(s)`);
    } catch (err) {
      logger.error('[NotificationWorker] Error handling case.escalated:', err);
      throw err;
    }
  });

  // ── sla.warning ────────────────────────────────────────────────────────
  events.on('sla.warning', async (event: SubscribedEvent) => {
    try {
      const { caseId, assigneeId, title } = event.payload as {
        caseId: string;
        assigneeId?: string;
        title?: string;
      };

      if (!assigneeId) return;

      await enqueueDispatch(event, assigneeId, {
        tenantId: event.tenantId,
        type: 'sla_warning',
        title: 'SLA 即將到期',
        body: title ? `工單「${title}」的 SLA 即將到期，請加速處理` : '您有一張工單的 SLA 即將到期',
        clickUrl: `/dashboard/cases/${caseId}`,
      });

      logger.info(`[NotificationWorker] sla.warning → agent ${assigneeId}`);
    } catch (err) {
      logger.error('[NotificationWorker] Error handling sla.warning:', err);
      throw err;
    }
  });

  // ── sla.breached ───────────────────────────────────────────────────────
  events.on('sla.breached', async (event: SubscribedEvent) => {
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
        await enqueueDispatch(event, agentId, {
          tenantId: event.tenantId,
          type: 'sla_breached',
          title: 'SLA 已逾期',
          body: title ? `工單「${title}」的 SLA 已逾期，請立即處理` : '有一張工單的 SLA 已逾期',
          clickUrl: `/dashboard/cases/${caseId}`,
        });
      }

      logger.info(`[NotificationWorker] sla.breached → ${notifyIds.length} agent(s)`);
    } catch (err) {
      logger.error('[NotificationWorker] Error handling sla.breached:', err);
      throw err;
    }
  });

  // ── message.received ───────────────────────────────────────────────────
  events.on('message.received', async (event: SubscribedEvent) => {
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
        await enqueueDispatch(event, conversation.assignedToId, notifPayload);
      } else {
        // Unassigned → notify all ADMIN and SUPERVISOR agents
        const adminAndSupervisorIds = await getSupervisorAndAdminIds(prisma, event.tenantId);
        for (const agentId of adminAndSupervisorIds) {
          await enqueueDispatch(event, agentId, notifPayload);
        }
        logger.info(`[NotificationWorker] message.received (unassigned) → ${adminAndSupervisorIds.length} admin(s)/supervisor(s)`);
      }
    } catch (err) {
      logger.error('[NotificationWorker] Error handling message.received:', err);
      throw err;
    }
  });

  // ── conversation.assigned ──────────────────────────────────────────────
  events.on('conversation.assigned', async (event: SubscribedEvent) => {
    try {
      const { conversationId, assignedToId } = event.payload as {
        conversationId?: string;
        assignedToId?: string;
      };

      if (!assignedToId || !conversationId) return;

      await enqueueDispatch(event, assignedToId, {
        tenantId: event.tenantId,
        type: 'new_message',
        title: '對話已指派給您',
        body: '您有一則新的對話指派',
        clickUrl: `/dashboard/inbox?conv=${conversationId}`,
      });

      logger.info(`[NotificationWorker] conversation.assigned → agent ${assignedToId}`);
    } catch (err) {
      logger.error('[NotificationWorker] Error handling conversation.assigned:', err);
      throw err;
    }
  });

  // ── usage.quota.threshold（AI 用量達 80%/100% 告警給租戶 ADMIN）──────────
  events.on('usage.quota.threshold', async (event: SubscribedEvent) => {
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
        // 信件在郵件客戶端開啟，要用絕對網址；站內通知的 clickUrl 維持相對路徑
        usageUrl: `${getConfig().WEB_BASE_URL}/dashboard/plan`,
      };

      // 每位 ADMIN 一則站內通知、一封 email。任一 job 送不出時丟錯，BullMQ 重試整個事件；
      // job id 固定，已送出的 job 不會重複
      for (const admin of admins) {
        // 站內通知（複用既有 notification:dispatch job/handler）
        await enqueueDispatch(event, admin.id, {
          tenantId: event.tenantId,
          type: isCritical ? 'usage_quota_critical' : 'usage_quota_warning',
          title: isCritical ? 'AI 用量已達上限' : 'AI 用量已達 80%',
          body: isCritical
            ? `本月 AI 用量已達上限（${emailVars.usedTokens}/${emailVars.limitTokens} tokens），AI 自動回覆暫停，真人回覆不受影響。`
            : `本月 AI 用量已達 80%（${emailVars.usedTokens}/${emailVars.limitTokens} tokens），額度用盡後 AI 自動回覆將暫停。`,
          clickUrl: '/dashboard/plan',
        });

        // email 經 usage-alert-email 佇列寄出：job id 是 <事件 id>__<管理員 id>，
        // 事件重送時不重寄；寄送失敗由 BullMQ 重試（usage-quota-alerts「事件重送時不重複寄出告警信」）
        const emailJob: UsageAlertEmailJob = { level, to: admin.email, vars: emailVars };
        await usageAlertEmailQueue()
          .add('usage-alert:send', emailJob, { jobId: `${event.id}__${admin.id}` });
      }

      logger.info(
        `[NotificationWorker] usage.quota.threshold(${level}) → ${admins.length} admin(s) of tenant ${event.tenantId}`,
      );
    } catch (err) {
      logger.error('[NotificationWorker] Error handling usage.quota.threshold:', err);
      throw err;
    }
  });

  return events.handle;
}
