/**
 * Auto Round-Robin Agent Assignment
 *
 * When a case is created without an assignee, automatically assign it
 * to the agent with the fewest open/in-progress cases. Ties are broken
 * by an in-memory round-robin index.
 */

import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { eventBus } from '../../events/event-bus.js';

// In-memory round-robin index per tenant
const rrIndex = new Map<string, number>();

/**
 * Find the next agent to assign a case to.
 * Strategy: pick the active AGENT with the fewest open/in_progress cases.
 * On tie, use round-robin index.
 */
export async function getNextAgent(
  prisma: PrismaClient,
  tenantId: string,
  teamId?: string | null,
): Promise<{ id: string; name: string } | null> {
  // Build agent filter: must be active AGENT role
  const agentWhere: Record<string, unknown> = {
    tenantId,
    role: 'AGENT',
    isActive: true,
  };

  // If teamId specified, only consider agents in that team
  if (teamId) {
    agentWhere.teams = {
      some: { teamId },
    };
  }

  const agents = await prisma.agent.findMany({
    where: agentWhere as any,
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          assignedCases: {
            where: {
              status: { in: ['OPEN', 'IN_PROGRESS', 'PENDING', 'ESCALATED'] as any[] },
            },
          },
        },
      },
    },
  });

  if (agents.length === 0) return null;

  // Sort by case count ascending
  agents.sort((a, b) => a._count.assignedCases - b._count.assignedCases);

  // Find the minimum count
  const minCount = agents[0]._count.assignedCases;
  const candidates = agents.filter((a) => a._count.assignedCases === minCount);

  // Round-robin among tied candidates
  const key = teamId ? `${tenantId}:${teamId}` : tenantId;
  const currentIdx = rrIndex.get(key) ?? 0;
  const selected = candidates[currentIdx % candidates.length];
  rrIndex.set(key, currentIdx + 1);

  return { id: selected.id, name: selected.name };
}

/**
 * Auto-assign a case to the next available agent.
 * Updates case, creates CaseEvent, publishes events, emits WebSocket.
 */
export async function autoAssignCase(
  prisma: PrismaClient,
  io: SocketIOServer,
  caseId: string,
  tenantId: string,
  teamId?: string | null,
): Promise<boolean> {
  const agent = await getNextAgent(prisma, tenantId, teamId);
  if (!agent) {
    console.log(`[AutoAssign] No available agent for case ${caseId}`);
    return false;
  }

  // Update case
  const updated = await prisma.case.update({
    where: { id: caseId },
    data: {
      assigneeId: agent.id,
      status: 'IN_PROGRESS',
    },
  });

  // Create CaseEvent
  await prisma.caseEvent.create({
    data: {
      caseId,
      actorType: 'system',
      eventType: 'auto_assigned',
      payload: {
        assigneeId: agent.id,
        assigneeName: agent.name,
        method: 'round_robin',
      },
    },
  });

  // Emit WebSocket
  io.to(`tenant:${tenantId}`).emit('case.updated', {
    id: caseId,
    status: 'IN_PROGRESS',
    priority: updated.priority,
    assigneeId: agent.id,
    source: 'auto_assign',
  });

  // Publish case.assigned event for notifications
  eventBus.publish({
    name: 'case.assigned',
    tenantId,
    timestamp: new Date(),
    payload: {
      caseId,
      assigneeId: agent.id,
      title: updated.title,
      source: 'auto_assign',
    },
  });

  console.log(`[AutoAssign] Case ${caseId} → agent ${agent.name} (${agent.id})`);
  return true;
}
