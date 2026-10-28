/**
 * Auto Round-Robin Agent Assignment
 *
 * When a case is created without an assignee, automatically assign it
 * to the agent with the fewest open/in-progress cases. Ties are broken
 * by an in-memory round-robin index.
 */

import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { logger } from '@open333crm/core';

// In-memory round-robin index per tenant
const rrIndex = new Map<string, number>();

/**
 * Find the next agent to assign a case to.
 * Strategy: pick the active AGENT with the fewest open/in_progress cases.
 * On tie, use round-robin index.
 */
export async function getNextAgent(
  ctx: TenantCtx,
  teamId?: string | null,
  /** 工單的渠道：只派給看得到、而且能回覆這個渠道的成員（渠道可見範圍是 fail-closed） */
  channelId?: string | null,
): Promise<{ id: string; name: string } | null> {
  // Build agent filter: must be active AGENT role
  const { tx, tenantId } = ctx;
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

  // 只派給直綁或所屬團隊被授權該渠道、層級能回覆的成員：派給看不到的成員，工單會從他的
  // 收件匣消失、打開回 404，卻還算在工作量裡（change channel-visibility-fail-closed）
  if (channelId) {
    const canReply = { in: ['reply_only', 'full'] };
    agentWhere.OR = [
      { channelAccesses: { some: { channelId, accessLevel: canReply } } },
      { teams: { some: { team: { channelAccesses: { some: { channelId, accessLevel: canReply } } } } } },
    ];
  }

  const agents = await tx.agent.findMany({
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
 * Updates case and creates CaseEvent. 推播與 case.assigned 事件由 flow 依回傳結果送出（case-effects.ts）。
 * 沒有可派的成員時回傳 null。
 */
export async function autoAssignCase(
  ctx: TenantCtx,
  caseId: string,
  teamId?: string | null,
  channelId?: string | null,
) {
  const agent = await getNextAgent(ctx, teamId, channelId);
  if (!agent) {
    logger.info(`[AutoAssign] No available agent for case ${caseId}`);
    return null;
  }

  // Update case
  const updated = await ctx.tx.case.update({
    where: { id: caseId },
    data: {
      assigneeId: agent.id,
      status: 'IN_PROGRESS',
    },
  });

  // Create CaseEvent
  await ctx.tx.caseEvent.create({
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

  logger.info(`[AutoAssign] Case ${caseId} → agent ${agent.name} (${agent.id})`);
  return { agent, updated };
}
