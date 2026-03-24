import { prisma, CaseStatus, Priority } from '@open333crm/database';
import { Queue, Worker } from 'bullmq';
import { redis } from '../redis/client';
import { logger } from '../logger';
import { EventBus } from '../event-bus/event-bus';

export class CaseService {
  private static slaQueue = new Queue('sla-monitoring', { connection: redis as any });

  static async create(data: {
    tenantId: string;
    contactId: string;
    channelId: string;
    conversationId?: string;
    title: string;
    description?: string;
    priority?: Priority;
  }) {
    try {
      const newCase = await prisma.case.create({
        data: {
          tenantId: data.tenantId,
          contactId: data.contactId,
          channelId: data.channelId,
          conversationId: data.conversationId,
          title: data.title,
          description: data.description,
          priority: data.priority || Priority.MEDIUM,
          status: CaseStatus.OPEN,
        },
      });

      // Record event
      await prisma.caseEvent.create({
        data: {
          caseId: newCase.id,
          actorType: 'system',
          eventType: 'created',
          payload: { title: data.title },
        },
      });

      // Schedule SLA check (e.g. in 2 hours if not handled)
      await this.slaQueue.add(
        'check-sla',
        { caseId: newCase.id, tenantId: data.tenantId },
        { delay: 2 * 60 * 60 * 1000, jobId: `sla-${newCase.id}` }
      );

      // Publish event
      await EventBus.publish({
        tenantId: data.tenantId,
        type: 'case.created',
        payload: { caseId: newCase.id },
        timestamp: Date.now(),
      });

      return newCase;
    } catch (err) {
      logger.error('Failed to create case:', err);
      throw err;
    }
  }

  static async updateStatus(caseId: string, status: CaseStatus, actorId?: string) {
    const updatedCase = await prisma.case.update({
      where: { id: caseId },
      data: {
        status,
        resolvedAt: status === CaseStatus.RESOLVED ? new Date() : undefined,
        closedAt: status === CaseStatus.CLOSED ? new Date() : undefined,
      },
    });

    await prisma.caseEvent.create({
      data: {
        caseId,
        actorType: actorId ? 'agent' : 'system',
        actorId,
        eventType: 'status_changed',
        payload: { status },
      },
    });

    // If resolved/closed, we might want to remove the SLA job, but BullMQ jobs are often left to expire or we can keep it and check status in worker.
    
    return updatedCase;
  }
}

// SLA Worker (for demonstration, would typically run in a separate worker process)
export const slaWorker = new Worker(
  'sla-monitoring',
  async (job) => {
    const { caseId, tenantId } = job.data;
    const c = await prisma.case.findUnique({ where: { id: caseId } });
    if (c && c.status === CaseStatus.OPEN && !c.assigneeId) {
      logger.info(`SLA Breach for case ${caseId}, escalating...`);
      await prisma.case.update({
        where: { id: caseId },
        data: { priority: Priority.HIGH },
      });
      await EventBus.publish({
        tenantId,
        type: 'case.sla_warning',
        payload: { caseId },
        timestamp: Date.now(),
      });
    }
  },
  { connection: redis as any }
);
