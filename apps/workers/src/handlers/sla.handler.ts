import type { Prisma, PrismaClient } from '@prisma/client';
import type { Redis as IORedis } from 'ioredis';
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

/**
 * 同一個期限的 SLA 結果只記錄一次（change fix-sla-outcome-repeat）。
 * 原本用「24 小時內有沒有同類事件」去重，逾期的工單每天重寫一次時間軸、重發一次通知（S01、S02）。
 * 改成看去重起點（期限、警告時間點或上次客服回覆）之後是否已有同類事件。
 */
async function hasCaseEventSince(
  prisma: PrismaClient | Prisma.TransactionClient,
  caseId: string,
  eventType: string,
  since: Date,
): Promise<boolean> {
  const existing = await prisma.caseEvent.findFirst({
    where: {
      caseId,
      eventType,
      createdAt: { gte: since },
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

async function getSlaBreachCount(prisma: PrismaClient | Prisma.TransactionClient, caseId: string): Promise<number> {
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
    /** 去重起點：這個時間點之後已有同類事件就略過（不寫事件、不通知、不跑規則） */
    dedupSince: Date;
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

  // 查重與寫入放在同一個交易，並以 advisory lock 鎖住「同一工單 + 同類事件」：
  // 兩次掃描重疊（例如 BullMQ 判定 stalled 後重跑）時，第二次會等第一次提交後再查，
  // 看到已寫入的事件就略過。只有真正寫入事件的那次才發 socket、通知與自動化規則。
  const recorded = await prisma.$transaction(async (tx) => {
    const lockKey = `sla:${c.id}:${eventType}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

    if (await hasCaseEventSince(tx, c.id, eventType, params.dedupSince)) return null;

    let nextPriority = c.priority;
    if (params.applyPriorityBump) {
      nextPriority = String(bumpSlaPriority(c.priority));
      if (nextPriority !== c.priority) {
        await tx.case.update({
          where: { id: c.id },
          data: { priority: nextPriority as any },
        });
      }
    }

    const breachCount = await getSlaBreachCount(tx, c.id);
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

    await tx.caseEvent.create({
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

    return { nextPriority, facts };
  });

  if (!recorded) return;
  const { nextPriority, facts } = recorded;

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
          dedupSince: firstResponseDeadline,
          defaultNotification: {
            type: 'first_response_breached',
            title: '首次回應已逾期',
            body: `工單「${c.title}」超過首次回應期限仍未回覆客戶。`,
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
          dedupSince: firstResponseWarningAt,
          defaultNotification: {
            type: 'first_response_warning',
            title: '首次回應即將逾期',
            body: `工單「${c.title}」即將超過首次回應期限，請盡快回覆客戶。`,
            notifySupervisors: false,
          },
        });
      }

      const resolutionWarningAt = c.slaDueAt
        ? new Date(c.slaDueAt.getTime() - policy.warningBeforeMinutes * 60_000)
        : null;

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
          dedupSince: c.slaDueAt,
          defaultNotification: {
            type: 'sla_breached',
            title: '解決期限已逾期',
            body: `工單「${c.title}」已超過解決期限。`,
            notifySupervisors: true,
          },
        });
      } else if (c.slaDueAt && resolutionWarningAt && now >= resolutionWarningAt) {
        await dispatchSlaOutcome(prisma, redisPublisher, {
          c,
          eventName: SLA_EVENT_NAMES.RESOLUTION_WARNING,
          eventType: 'sla_warning',
          kind: 'resolution',
          state: 'warning',
          dueAt: c.slaDueAt,
          warningBeforeMinutes: policy.warningBeforeMinutes,
          dedupSince: resolutionWarningAt,
          defaultNotification: {
            type: 'sla_warning',
            title: '解決期限即將逾期',
            body: `工單「${c.title}」即將超過解決期限。`,
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
          // 同一段等待只記一次：客服回覆後客戶又連續傳訊，才重新記錄
          dedupSince: customerWaiting.lastAgentReplyAt
            ? new Date(customerWaiting.lastAgentReplyAt.getTime() + 1)
            : new Date(0),
          defaultNotification: {
            type: 'customer_waiting_breached',
            title: '客戶等待過久',
            body: `工單「${c.title}」有 ${customerWaiting.count} 則客戶訊息尚未回覆。`,
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
