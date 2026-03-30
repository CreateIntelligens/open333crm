/**
 * Notification event-bus worker.
 *
 * Subscribes to application events and creates in-app notifications
 * for relevant agents (assignees, supervisors, etc.).
 */

import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { Queue } from 'bullmq';
import { eventBus } from '../../events/event-bus.js';
import type { AppEvent } from '../../events/event-bus.js';
import { createAndDispatch } from './notification.service.js';

const notificationQueue = new Queue('notification', {
  connection: { url: process.env.REDIS_URL! },
  defaultJobOptions: { removeOnComplete: 100, removeOnFail: 50 },
});

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

export function setupNotificationWorker(prisma: PrismaClient, io: Server) {
  // ── case.assigned ──────────────────────────────────────────────────────
  eventBus.subscribe('case.assigned', async (event: AppEvent) => {
    try {
      const { caseId, assigneeId, title } = event.payload as {
        caseId: string;
        assigneeId: string;
        title?: string;
      };

      if (!assigneeId) return;

      await createAndDispatch(prisma, io, {
        tenantId: event.tenantId,
        agentId: assigneeId,
        type: 'case_assigned',
        title: '工單已指派給您',
        body: title ? `工單「${title}」已指派給您處理` : '您有一張新的指派工單',
        clickUrl: `/dashboard/cases/${caseId}`,
      });

      await notificationQueue.add('notification:dispatch', {
        tenantId: event.tenantId,
        agentId: assigneeId,
        type: 'case_assigned',
        title: '工單已指派給您',
        body: title ? `工單「${title}」已指派給您處理` : '您有一張新的指派工單',
        clickUrl: `/dashboard/cases/${caseId}`,
      }).catch((err) => console.error('[NotificationWorker] Failed to enqueue case.assigned', err));

      console.log(`[NotificationWorker] case.assigned → agent ${assigneeId}`);
    } catch (err) {
      console.error('[NotificationWorker] Error handling case.assigned:', err);
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
        await createAndDispatch(prisma, io, {
          tenantId: event.tenantId,
          agentId,
          type: 'case_escalated',
          title: '工單已升級',
          body: reason
            ? `工單已升級：${reason}`
            : '有一張工單已升級，請注意處理',
          clickUrl: `/dashboard/cases/${caseId}`,
        });

        await notificationQueue.add('notification:dispatch', {
          tenantId: event.tenantId,
          agentId,
          type: 'case_escalated',
          title: '工單已升級',
          body: reason ? `工單已升級：${reason}` : '有一張工單已升級，請注意處理',
          clickUrl: `/dashboard/cases/${caseId}`,
        }).catch((err) => console.error('[NotificationWorker] Failed to enqueue case.escalated', err));
      }

      console.log(`[NotificationWorker] case.escalated → ${supervisorIds.length} supervisor(s)/admin(s)`);
    } catch (err) {
      console.error('[NotificationWorker] Error handling case.escalated:', err);
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

      await createAndDispatch(prisma, io, {
        tenantId: event.tenantId,
        agentId: assigneeId,
        type: 'sla_warning',
        title: 'SLA 即將到期',
        body: title
          ? `工單「${title}」的 SLA 即將到期，請加速處理`
          : '您有一張工單的 SLA 即將到期',
        clickUrl: `/dashboard/cases/${caseId}`,
      });

      await notificationQueue.add('notification:dispatch', {
        tenantId: event.tenantId,
        agentId: assigneeId,
        type: 'sla_warning',
        title: 'SLA 即將到期',
        body: title ? `工單「${title}」的 SLA 即將到期，請加速處理` : '您有一張工單的 SLA 即將到期',
        clickUrl: `/dashboard/cases/${caseId}`,
      }).catch((err) => console.error('[NotificationWorker] Failed to enqueue sla.warning', err));

      console.log(`[NotificationWorker] sla.warning → agent ${assigneeId}`);
    } catch (err) {
      console.error('[NotificationWorker] Error handling sla.warning:', err);
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
        await createAndDispatch(prisma, io, {
          tenantId: event.tenantId,
          agentId,
          type: 'sla_breached',
          title: 'SLA 已逾期',
          body: title
            ? `工單「${title}」的 SLA 已逾期，請立即處理`
            : '有一張工單的 SLA 已逾期',
          clickUrl: `/dashboard/cases/${caseId}`,
        });

        await notificationQueue.add('notification:dispatch', {
          tenantId: event.tenantId,
          agentId,
          type: 'sla_breached',
          title: 'SLA 已逾期',
          body: title ? `工單「${title}」的 SLA 已逾期，請立即處理` : '有一張工單的 SLA 已逾期',
          clickUrl: `/dashboard/cases/${caseId}`,
        }).catch((err) => console.error('[NotificationWorker] Failed to enqueue sla.breached', err));
      }

      console.log(`[NotificationWorker] sla.breached → ${notifyIds.length} agent(s)`);
    } catch (err) {
      console.error('[NotificationWorker] Error handling sla.breached:', err);
    }
  });

  // ── message.received ───────────────────────────────────────────────────
  eventBus.subscribe('message.received', async (event: AppEvent) => {
    try {
      const { conversationId } = event.payload as {
        conversationId?: string;
      };

      if (!conversationId) return;

      // Look up conversation to find assigned agent
      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, tenantId: event.tenantId },
        select: { assignedToId: true, contactId: true, contact: { select: { displayName: true } } },
      });

      if (!conversation?.assignedToId) return;

      await createAndDispatch(prisma, io, {
        tenantId: event.tenantId,
        agentId: conversation.assignedToId,
        type: 'new_message',
        title: '收到新訊息',
        body: `${conversation.contact.displayName} 傳來新訊息`,
        clickUrl: `/dashboard/inbox?conversationId=${conversationId}`,
      });

      await notificationQueue.add('notification:dispatch', {
        tenantId: event.tenantId,
        agentId: conversation.assignedToId,
        type: 'new_message',
        title: '收到新訊息',
        body: `${conversation.contact.displayName} 傳來新訊息`,
        clickUrl: `/dashboard/inbox?conversationId=${conversationId}`,
      }).catch((err) => console.error('[NotificationWorker] Failed to enqueue message.received', err));
    } catch (err) {
      console.error('[NotificationWorker] Error handling message.received:', err);
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

      await createAndDispatch(prisma, io, {
        tenantId: event.tenantId,
        agentId: assignedToId,
        type: 'new_message',
        title: '對話已指派給您',
        body: '您有一則新的對話指派',
        clickUrl: `/dashboard/inbox?conversationId=${conversationId}`,
      });

      await notificationQueue.add('notification:dispatch', {
        tenantId: event.tenantId,
        agentId: assignedToId,
        type: 'new_message',
        title: '對話已指派給您',
        body: '您有一則新的對話指派',
        clickUrl: `/dashboard/inbox?conversationId=${conversationId}`,
      }).catch((err) => console.error('[NotificationWorker] Failed to enqueue conversation.assigned', err));

      console.log(`[NotificationWorker] conversation.assigned → agent ${assignedToId}`);
    } catch (err) {
      console.error('[NotificationWorker] Error handling conversation.assigned:', err);
    }
  });

  console.log(
    '[NotificationWorker] Subscribed to events: case.assigned, case.escalated, sla.warning, sla.breached, message.received, conversation.assigned',
  );
}
