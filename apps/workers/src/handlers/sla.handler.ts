import type { PrismaClient } from '@prisma/client';
import type IORedis from 'ioredis';
import { evaluateRules } from '@open333crm/automation';
import {
  SLA_ACTIVE_CASE_STATUSES,
  SLA_EVENT_NAMES,
  buildSlaFacts,
  bumpSlaPriority,
  getSlaDeadlineFromCreatedAt,
  minutesOverdue,
  minutesUntil,
} from '@open333crm/shared';
import type { SlaEventName, SlaKind, SlaState } from '@open333crm/shared';
import { logger } from '@open333crm/core';
import { publishSocketEvent } from '../lib/socket-bridge.js';
import { enqueueNotification } from '../lib/notification-queue.js';
import {
  executeWorkerAutomationActions,
  getSupervisorAndAdminAgentIds,
} from '../lib/automation-actions.js';

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const CUSTOMER_WAITING_THRESHOLD = 3;

type RuleAction = { type: string; params: Record<string, unknown> };

interface SlaCase {
  id: string;
  tenantId: string;
  contactId: string;
  title: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  teamId: string | null;
  slaPolicy: string | null;
  slaDueAt: Date | null;
  firstResponseAt: Date | null;
  createdAt: Date;
  contact: {
    tags: Array<{ tag: { name: string } }>;
  };
  conversations: Array<{ id: string }>;
}

async function getActiveCases(prisma: PrismaClient): Promise<SlaCase[]> {
  return prisma.case.findMany({
    where: {
      status: { in: [...SLA_ACTIVE_CASE_STATUSES] as any[] },
      slaPolicy: { not: null },
    },
    select: {
      id: true,
      tenantId: true,
      contactId: true,
      title: true,
      status: true,
      priority: true,
      assigneeId: true,
      teamId: true,
      slaPolicy: true,
      slaDueAt: true,
      firstResponseAt: true,
      createdAt: true,
      contact: {
        select: {
          tags: { select: { tag: { select: { name: true } } } },
        },
      },
      conversations: { select: { id: true } },
    },
    take: 100,
  });
}

async function hasRecentCaseEvent(
  prisma: PrismaClient,
  caseId: string,
  eventType: string,
  now: Date,
): Promise<boolean> {
  const dedupCutoff = new Date(now.getTime() - DEDUP_WINDOW_MS);
  const existing = await prisma.caseEvent.findFirst({
    where: {
      caseId,
      eventType,
      createdAt: { gte: dedupCutoff },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

async function getPolicy(
  prisma: PrismaClient,
  tenantId: string,
  name: string,
): Promise<{
  firstResponseMinutes: number;
  resolutionMinutes: number;
  warningBeforeMinutes: number;
} | null> {
  return prisma.slaPolicy.findFirst({
    where: { tenantId, name },
    select: {
      firstResponseMinutes: true,
      resolutionMinutes: true,
      warningBeforeMinutes: true,
    },
  });
}

async function getSlaBreachCount(prisma: PrismaClient, caseId: string): Promise<number> {
  return prisma.caseEvent.count({
    where: {
      caseId,
      eventType: {
        in: ['first_response_breached', 'sla_breached', 'customer_waiting_breached'],
      },
    },
  });
}

function contactTags(c: SlaCase): string[] {
  return c.contact.tags.map((tag) => tag.tag.name);
}

function isVip(c: SlaCase): boolean {
  return contactTags(c).some((tag) => tag.toLowerCase() === 'vip');
}

async function getCustomerWaitingFacts(
  prisma: PrismaClient,
  conversationIds: string[],
): Promise<{
  count: number;
  lastAgentReplyAt: Date | null;
  lastCustomerMessageAt: Date | null;
  sentimentLatest: string | null;
  sentimentNegativeCount: number;
}> {
  if (conversationIds.length === 0) {
    return {
      count: 0,
      lastAgentReplyAt: null,
      lastCustomerMessageAt: null,
      sentimentLatest: null,
      sentimentNegativeCount: 0,
    };
  }

  const lastAgentReply = await prisma.message.findFirst({
    where: {
      conversationId: { in: conversationIds },
      direction: 'OUTBOUND',
      senderType: { in: ['AGENT', 'SYSTEM'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  const customerMessages = await prisma.message.findMany({
    where: {
      conversationId: { in: conversationIds },
      direction: 'INBOUND',
      senderType: 'CONTACT',
      ...(lastAgentReply ? { createdAt: { gt: lastAgentReply.createdAt } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      createdAt: true,
      metadata: true,
    },
    take: 20,
  });

  const sentimentValues = customerMessages
    .map((message) => {
      const metadata = message.metadata as Record<string, unknown>;
      return metadata['sentiment'];
    })
    .filter((value): value is string => typeof value === 'string');

  return {
    count: customerMessages.length,
    lastAgentReplyAt: lastAgentReply?.createdAt ?? null,
    lastCustomerMessageAt: customerMessages[0]?.createdAt ?? null,
    sentimentLatest: sentimentValues[0] ?? null,
    sentimentNegativeCount: sentimentValues.filter((value) => value === 'negative').length,
  };
}

async function enqueueDefaultNotifications(
  prisma: PrismaClient,
  c: SlaCase,
  type: string,
  title: string,
  body: string,
  notifySupervisors: boolean,
): Promise<void> {
  const agentIds: string[] = [];
  if (c.assigneeId) agentIds.push(c.assigneeId);

  if (notifySupervisors) {
    const supervisorIds = await getSupervisorAndAdminAgentIds(prisma, c.tenantId);
    for (const id of supervisorIds) {
      if (!agentIds.includes(id)) agentIds.push(id);
    }
  }

  for (const agentId of agentIds) {
    await enqueueNotification({
      tenantId: c.tenantId,
      agentId,
      type,
      title,
      body,
      clickUrl: `/dashboard/cases/${c.id}`,
    });
  }
}

async function evaluateSlaAutomationRules(
  prisma: PrismaClient,
  redisPublisher: IORedis,
  eventName: SlaEventName,
  c: SlaCase,
  facts: Record<string, unknown>,
): Promise<void> {
  const rules = await prisma.automationRule.findMany({
    where: { tenantId: c.tenantId, eventType: eventName, isActive: true },
    orderBy: { priority: 'desc' },
  });

  if (rules.length === 0) return;

  const matched = await evaluateRules(
    rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      priority: rule.priority,
      stopOnMatch: rule.stopOnMatch,
      conditions: rule.conditions as any,
      actions: (rule.actions as RuleAction[]) ?? [],
    })),
    facts,
  );

  for (const match of matched) {
    await executeWorkerAutomationActions(prisma, redisPublisher, match.actions, {
      tenantId: c.tenantId,
      caseId: c.id,
      assigneeId: c.assigneeId,
      title: c.title,
    });
  }
}

async function dispatchSlaOutcome(
  prisma: PrismaClient,
  redisPublisher: IORedis,
  params: {
    c: SlaCase;
    eventName: SlaEventName;
    eventType: string;
    kind: SlaKind;
    state: SlaState;
    dueAt?: Date | null;
    warningBeforeMinutes?: number | null;
    customerWaiting?: Awaited<ReturnType<typeof getCustomerWaitingFacts>>;
    defaultNotification: {
      type: string;
      title: string;
      body: string;
      notifySupervisors: boolean;
    };
    applyPriorityBump?: boolean;
  },
): Promise<void> {
  const { c, eventName, eventType, kind, state } = params;
  const now = new Date();

  if (await hasRecentCaseEvent(prisma, c.id, eventType, now)) return;

  let nextPriority = c.priority;
  if (params.applyPriorityBump) {
    nextPriority = String(bumpSlaPriority(c.priority));
    if (nextPriority !== c.priority) {
      await prisma.case.update({
        where: { id: c.id },
        data: { priority: nextPriority as any },
      });
    }
  }

  const breachCount = await getSlaBreachCount(prisma, c.id);
  const dueAt = params.dueAt ?? null;
  const customerWaiting = params.customerWaiting;

  const facts = {
    ...buildSlaFacts({
      caseId: c.id,
      tenantId: c.tenantId,
      status: c.status,
      priority: nextPriority,
      assigneeId: c.assigneeId,
      teamId: c.teamId,
      kind,
      state,
      dueAt,
      remainingMinutes: dueAt ? Math.max(0, minutesUntil(dueAt, now)) : null,
      overdueMinutes: dueAt ? minutesOverdue(dueAt, now) : 0,
      warningBeforeMinutes: params.warningBeforeMinutes ?? null,
      breachCount,
      escalationLevel: breachCount,
      customerMessagesSinceLastAgentReply: customerWaiting?.count ?? 0,
      lastAgentReplyAt: customerWaiting?.lastAgentReplyAt ?? null,
      lastCustomerMessageAt: customerWaiting?.lastCustomerMessageAt ?? null,
      contactIsVip: isVip(c),
      contactTags: contactTags(c),
      sentimentLatest: customerWaiting?.sentimentLatest ?? null,
      sentimentNegativeCount: customerWaiting?.sentimentNegativeCount ?? 0,
    }),
    'event.type': eventName,
    'event.timestamp': now.toISOString(),
  };

  await prisma.caseEvent.create({
    data: {
      caseId: c.id,
      actorType: 'system',
      eventType,
      payload: {
        eventName,
        facts,
        previousPriority: c.priority,
        newPriority: nextPriority,
      },
    },
  });

  if (params.applyPriorityBump && nextPriority !== c.priority) {
    await publishSocketEvent(redisPublisher, `tenant:${c.tenantId}`, 'case.updated', {
      id: c.id,
      priority: nextPriority,
      source: 'sla_worker',
    });
  }

  await publishSocketEvent(redisPublisher, `tenant:${c.tenantId}`, 'sla.event', {
    name: eventName,
    caseId: c.id,
    assigneeId: c.assigneeId,
    title: c.title,
    facts,
  });

  await enqueueDefaultNotifications(
    prisma,
    c,
    params.defaultNotification.type,
    params.defaultNotification.title,
    params.defaultNotification.body,
    params.defaultNotification.notifySupervisors,
  );

  await evaluateSlaAutomationRules(prisma, redisPublisher, eventName, c, facts);
  logger.info(`[sla] ${eventName} for case ${c.id}`);
}

async function pollSlaCases(prisma: PrismaClient, redisPublisher: IORedis): Promise<void> {
  const now = new Date();
  const cases = await getActiveCases(prisma);

  for (const c of cases) {
    try {
      if (!c.slaPolicy) continue;

      const policy = await getPolicy(prisma, c.tenantId, c.slaPolicy);
      if (!policy) continue;

      const firstResponseDeadline = getSlaDeadlineFromCreatedAt(
        c.createdAt,
        policy.firstResponseMinutes,
      );
      const firstResponseWarningAt = new Date(
        firstResponseDeadline.getTime() - policy.warningBeforeMinutes * 60_000,
      );

      if (!c.firstResponseAt && now >= firstResponseDeadline) {
        await dispatchSlaOutcome(prisma, redisPublisher, {
          c,
          eventName: SLA_EVENT_NAMES.FIRST_RESPONSE_BREACHED,
          eventType: 'first_response_breached',
          kind: 'first_response',
          state: 'breached',
          dueAt: firstResponseDeadline,
          warningBeforeMinutes: policy.warningBeforeMinutes,
          defaultNotification: {
            type: 'first_response_breached',
            title: 'First response SLA breached',
            body: `Case "${c.title}" has not received a first response in time.`,
            notifySupervisors: true,
          },
        });
      } else if (!c.firstResponseAt && now >= firstResponseWarningAt) {
        await dispatchSlaOutcome(prisma, redisPublisher, {
          c,
          eventName: SLA_EVENT_NAMES.FIRST_RESPONSE_WARNING,
          eventType: 'first_response_warning',
          kind: 'first_response',
          state: 'warning',
          dueAt: firstResponseDeadline,
          warningBeforeMinutes: policy.warningBeforeMinutes,
          defaultNotification: {
            type: 'first_response_warning',
            title: 'First response SLA warning',
            body: `Case "${c.title}" needs a first response soon.`,
            notifySupervisors: false,
          },
        });
      }

      if (c.slaDueAt && now >= c.slaDueAt) {
        await dispatchSlaOutcome(prisma, redisPublisher, {
          c,
          eventName: SLA_EVENT_NAMES.RESOLUTION_BREACHED,
          eventType: 'sla_breached',
          kind: 'resolution',
          state: 'breached',
          dueAt: c.slaDueAt,
          warningBeforeMinutes: policy.warningBeforeMinutes,
          applyPriorityBump: true,
          defaultNotification: {
            type: 'sla_breached',
            title: 'Resolution SLA breached',
            body: `Case "${c.title}" is past its resolution SLA.`,
            notifySupervisors: true,
          },
        });
      } else if (
        c.slaDueAt &&
        now >= new Date(c.slaDueAt.getTime() - policy.warningBeforeMinutes * 60_000)
      ) {
        await dispatchSlaOutcome(prisma, redisPublisher, {
          c,
          eventName: SLA_EVENT_NAMES.RESOLUTION_WARNING,
          eventType: 'sla_warning',
          kind: 'resolution',
          state: 'warning',
          dueAt: c.slaDueAt,
          warningBeforeMinutes: policy.warningBeforeMinutes,
          defaultNotification: {
            type: 'sla_warning',
            title: 'Resolution SLA warning',
            body: `Case "${c.title}" is close to its resolution SLA.`,
            notifySupervisors: false,
          },
        });
      }

      const customerWaiting = await getCustomerWaitingFacts(
        prisma,
        c.conversations.map((conversation) => conversation.id),
      );
      if (customerWaiting.count >= CUSTOMER_WAITING_THRESHOLD) {
        await dispatchSlaOutcome(prisma, redisPublisher, {
          c,
          eventName: SLA_EVENT_NAMES.CUSTOMER_WAITING_BREACHED,
          eventType: 'customer_waiting_breached',
          kind: 'customer_waiting',
          state: 'breached',
          customerWaiting,
          defaultNotification: {
            type: 'customer_waiting_breached',
            title: 'Customer waiting SLA breached',
            body: `Case "${c.title}" has ${customerWaiting.count} customer messages without an agent reply.`,
            notifySupervisors: true,
          },
        });
      }
    } catch (err) {
      logger.error(`[sla] Scan failed for case ${c.id}`, { err });
    }
  }
}

export async function handleSlaPoll(
  prisma: PrismaClient,
  redisPublisher: IORedis,
): Promise<void> {
  await pollSlaCases(prisma, redisPublisher);
}
