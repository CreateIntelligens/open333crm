import type { PrismaClient } from '@prisma/client';
import type IORedis from 'ioredis';
import { bumpSlaPriority } from '@open333crm/shared';
import { logger } from '@open333crm/core';
import { publishSocketEvent } from './socket-bridge.js';
import { enqueueNotification } from './notification-queue.js';

export interface WorkerAutomationAction {
  type: string;
  params: Record<string, unknown>;
}

export interface WorkerActionContext {
  tenantId: string;
  caseId: string;
  assigneeId?: string | null;
  title?: string | null;
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
      if (action.type === 'assign_agent') {
        const agentId = action.params['agentId'];
        if (typeof agentId === 'string' && agentId) {
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

      if (action.type === 'update_case_status') {
        const status = action.params['status'];
        if (typeof status === 'string' && status) {
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
        const current = await prisma.case.findUnique({
          where: { id: context.caseId },
          select: { priority: true },
        });
        if (!current) continue;

        const configuredPriority = action.params['newPriority'] ?? action.params['priority'];
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
          body: String(action.params['message'] ?? 'A SLA rule matched.'),
          clickUrl: `/dashboard/cases/${context.caseId}`,
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
            body: String(action.params['message'] ?? 'A SLA rule matched.'),
            clickUrl: `/dashboard/cases/${context.caseId}`,
          });
        }
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
