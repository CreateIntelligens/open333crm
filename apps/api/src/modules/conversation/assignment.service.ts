/**
 * Conversation Auto Round-Robin Assignment
 *
 * When a conversation handoff rule says "assign to team T (round-robin)",
 * pick the active AGENT in team T with the fewest open conversations.
 * Ties are broken by an in-memory round-robin index per (tenant, team).
 *
 * Mirrors apps/api/src/modules/case/assignment.service.ts but counts
 * Conversation rows (not Case) and operates on Conversation.assignedToId.
 */

import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { eventBus } from '../../events/event-bus.js';
import { logger } from '@open333crm/core';

// In-memory round-robin index per (tenant[, team]) for conversation assignment.
const rrIndex = new Map<string, number>();

export async function getNextAgentForConversation(
  prisma: PrismaClient,
  tenantId: string,
  teamId?: string | null,
): Promise<{ id: string; name: string } | null> {
  const agentWhere: Record<string, unknown> = {
    tenantId,
    role: 'AGENT',
    isActive: true,
  };
  if (teamId) {
    agentWhere.teams = { some: { teamId } };
  }

  const agents = await prisma.agent.findMany({
    where: agentWhere as any,
    select: { id: true, name: true },
  });
  if (agents.length === 0) return null;

  // Count open AGENT_HANDLED conversations per agent (least-load).
  const counts = await Promise.all(
    agents.map(async (a) => ({
      agent: a,
      count: await prisma.conversation.count({
        where: { tenantId, assignedToId: a.id, status: 'AGENT_HANDLED' },
      }),
    })),
  );
  counts.sort((a, b) => a.count - b.count);
  const minCount = counts[0].count;
  const candidates = counts
    .filter((c) => c.count === minCount)
    .map((c) => c.agent);

  const key = teamId ? `${tenantId}:${teamId}:conv` : `${tenantId}:conv`;
  const currentIdx = rrIndex.get(key) ?? 0;
  const selected = candidates[currentIdx % candidates.length];
  rrIndex.set(key, currentIdx + 1);

  return { id: selected.id, name: selected.name };
}

/**
 * Auto-assign a conversation to the next available agent in the given team.
 *
 * Uses a conditional update (`assignedToId IS NULL`) to avoid double-assignment
 * when concurrent rule executions race. Returns the agent if assigned, null if
 * no agent available or conversation was already assigned by another caller.
 */
export async function autoAssignConversationByTeam(
  prisma: PrismaClient,
  io: SocketIOServer,
  conversationId: string,
  tenantId: string,
  teamId: string,
): Promise<{ id: string; name: string } | null> {
  const agent = await getNextAgentForConversation(prisma, tenantId, teamId);
  if (!agent) {
    logger.info(`[ConvAutoAssign] No available agent for conversation ${conversationId} in team ${teamId}`);
    eventBus.publish({
      name: 'handoff.unassigned',
      tenantId,
      timestamp: new Date(),
      payload: { conversationId, teamId, reason: 'no_available_agent' },
    });
    return null;
  }

  // Conditional update — only assign if still unassigned.
  const result = await prisma.conversation.updateMany({
    where: { id: conversationId, tenantId, assignedToId: null },
    data: { assignedToId: agent.id, status: 'AGENT_HANDLED' },
  });
  if (result.count === 0) {
    logger.info(`[ConvAutoAssign] Conversation ${conversationId} already assigned, skipping`);
    return null;
  }

  io.to(`tenant:${tenantId}`).emit('conversation.updated', {
    id: conversationId,
    status: 'AGENT_HANDLED',
    assignedToId: agent.id,
    source: 'auto_assign',
  });

  eventBus.publish({
    name: 'conversation.assigned',
    tenantId,
    timestamp: new Date(),
    payload: {
      conversationId,
      assignedToId: agent.id,
      assigneeName: agent.name,
      method: 'team_round_robin',
      teamId,
    },
  });

  logger.info(`[ConvAutoAssign] Conversation ${conversationId} → agent ${agent.name} (${agent.id})`);
  return agent;
}
