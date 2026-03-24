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
    const existing = await prisma.case.findUnique({ where: { id: caseId } });
    if (!existing) throw new Error('Case not found');

    const validTransitions: Record<CaseStatus, CaseStatus[]> = {
      OPEN: [CaseStatus.IN_PROGRESS, CaseStatus.PENDING, CaseStatus.RESOLVED, CaseStatus.CLOSED],
      IN_PROGRESS: [CaseStatus.PENDING, CaseStatus.RESOLVED, CaseStatus.ESCALATED, CaseStatus.CLOSED],
      PENDING: [CaseStatus.IN_PROGRESS, CaseStatus.RESOLVED, CaseStatus.CLOSED],
      RESOLVED: [CaseStatus.CLOSED, CaseStatus.OPEN], // Can reopen
      ESCALATED: [CaseStatus.IN_PROGRESS, CaseStatus.RESOLVED, CaseStatus.CLOSED],
      CLOSED: [CaseStatus.OPEN], // Can reopen
    };

    if (existing.status !== status && !validTransitions[existing.status].includes(status)) {
      throw new Error(`Invalid transition from ${existing.status} to ${status}`);
    }

    const updatedCase = await prisma.case.update({
      where: { id: caseId },
      data: {
        status,
        resolvedAt: status === CaseStatus.RESOLVED && !existing.resolvedAt ? new Date() : existing.resolvedAt,
        closedAt: status === CaseStatus.CLOSED ? new Date() : undefined,
      },
    });

    await prisma.caseEvent.create({
      data: {
        caseId,
        actorType: actorId ? 'agent' : 'system',
        actorId,
        eventType: 'status_changed',
        payload: { oldStatus: existing.status, newStatus: status },
      },
    });

    return updatedCase;
  }

  static async mergeCases(tenantId: string, sourceId: string, targetId: string, actorId?: string) {
    if (sourceId === targetId) throw new Error('Cannot merge a case into itself');

    return prisma.$transaction(async (tx) => {
      const source = await tx.case.findUnique({ where: { id: sourceId, tenantId } });
      const target = await tx.case.findUnique({ where: { id: targetId, tenantId } });

      if (!source || !target) throw new Error('Source or target case not found');
      if (source.status === CaseStatus.CLOSED) throw new Error('Source case is already closed');

      // Update source to mark it merged and closed
      await tx.case.update({
        where: { id: sourceId },
        data: {
          mergedIntoId: targetId,
          status: CaseStatus.CLOSED,
          closedAt: new Date(),
        },
      });

      // Transfer Notes and Events (Optional, but good for consolidated views)
      await tx.caseNote.updateMany({
        where: { caseId: sourceId },
        data: { caseId: targetId },
      });

      await tx.caseEvent.updateMany({
        where: { caseId: sourceId },
        data: { caseId: targetId },
      });

      // Record merge event on target
      await tx.caseEvent.create({
        data: {
          caseId: targetId,
          actorType: actorId ? 'agent' : 'system',
          actorId,
          eventType: 'merged',
          payload: { sourceCaseId: sourceId },
        },
      });

      return targetId;
    });
  }

  static async assignToLeastLoadedAgent(tenantId: string, caseId: string, targetTeamId?: string) {
    // 1. Find all eligible agents
    const agents = await prisma.agent.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(targetTeamId ? { teams: { some: { teamId: targetTeamId } } } : {})
      },
      include: {
        assignedCases: {
          where: { status: { in: [CaseStatus.OPEN, CaseStatus.IN_PROGRESS, CaseStatus.PENDING] } }
        }
      }
    });

    if (agents.length === 0) return null; // No available agents

    // 2. Sort by lowest workload (cases count)
    agents.sort((a, b) => a.assignedCases.length - b.assignedCases.length);
    const selectedAgent = agents[0];

    // 3. Assign
    const updatedCase = await prisma.case.update({
      where: { id: caseId },
      data: {
        assigneeId: selectedAgent.id,
        teamId: targetTeamId,
        status: CaseStatus.IN_PROGRESS
      }
    });

    await prisma.caseEvent.create({
      data: {
        caseId,
        actorType: 'system',
        eventType: 'assigned',
        payload: { assigneeId: selectedAgent.id, teamId: targetTeamId },
      },
    });

    return updatedCase;
  }
}

// SLA Worker (for demonstration, would typically run in a separate worker process)
export const slaWorker = new Worker(
  'sla-monitoring',
  async (job) => {
    const { caseId, tenantId, type = 'first_response' } = job.data;
    const c = await prisma.case.findUnique({ where: { id: caseId } });

    if (!c) return;
    if (c.status === CaseStatus.RESOLVED || c.status === CaseStatus.CLOSED) return;

    if (type === 'first_response' && c.status === CaseStatus.OPEN && !c.assigneeId) {
      logger.info(`SLA First-Response Breach for case ${caseId}, escalating...`);
      await prisma.case.update({
        where: { id: caseId },
        data: { priority: Priority.HIGH },
      });
      await EventBus.publish({
        tenantId,
        type: 'case.sla_breach',
        payload: { caseId, breachType: 'first_response' },
        timestamp: Date.now(),
      });
    } else if (type === 'resolution') {
      logger.warn(`SLA Resolution Breach for case ${caseId}`);
      await prisma.case.update({
        where: { id: caseId },
        data: { priority: Priority.URGENT },
      });
      await EventBus.publish({
        tenantId,
        type: 'case.sla_breach',
        payload: { caseId, breachType: 'resolution' },
        timestamp: Date.now(),
      });
    }
  },
  { connection: redis as any }
);
