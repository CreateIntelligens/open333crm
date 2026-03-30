import type { PrismaClient } from '@prisma/client';
import type IORedis from 'ioredis';
import { logger } from '@open333crm/core';
import { publishSocketEvent } from '../lib/socket-bridge.js';

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

const PRIORITY_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

function bumpPriority(current: string): string {
  const idx = PRIORITY_ORDER.indexOf(current as (typeof PRIORITY_ORDER)[number]);
  if (idx < 0 || idx >= PRIORITY_ORDER.length - 1) return current;
  return PRIORITY_ORDER[idx + 1];
}

async function pollSlaWarning(prisma: PrismaClient, redisPublisher: IORedis): Promise<void> {
  try {
    const now = new Date();
    const dedupCutoff = new Date(now.getTime() - DEDUP_WINDOW_MS);

    const activeCases = await prisma.case.findMany({
      where: {
        status: { in: ['OPEN', 'IN_PROGRESS', 'PENDING', 'ESCALATED'] as any[] },
        slaDueAt: { not: null, gt: now },
        slaPolicy: { not: null },
      },
      select: {
        id: true,
        tenantId: true,
        title: true,
        assigneeId: true,
        slaPolicy: true,
        slaDueAt: true,
      },
      take: 50,
    });

    for (const c of activeCases) {
      try {
        const policy = await prisma.slaPolicy.findFirst({
          where: { tenantId: c.tenantId, name: c.slaPolicy! },
          select: { warningBeforeMinutes: true },
        });

        if (!policy) continue;

        const warningThreshold = new Date(
          c.slaDueAt!.getTime() - policy.warningBeforeMinutes * 60 * 1000,
        );

        if (now < warningThreshold) continue;

        const existing = await prisma.caseEvent.findFirst({
          where: {
            caseId: c.id,
            eventType: 'sla_warning',
            createdAt: { gte: dedupCutoff },
          },
        });

        if (existing) continue;

        await prisma.caseEvent.create({
          data: {
            caseId: c.id,
            actorType: 'system',
            eventType: 'sla_warning',
            payload: {
              slaDueAt: c.slaDueAt!.toISOString(),
              warningBeforeMinutes: policy.warningBeforeMinutes,
            },
          },
        });

        await publishSocketEvent(redisPublisher, `tenant:${c.tenantId}`, 'sla.event', {
          name: 'sla.warning',
          caseId: c.id,
          assigneeId: c.assigneeId,
          title: c.title,
          slaDueAt: c.slaDueAt!.toISOString(),
        });

        logger.info(`[sla] SLA warning for case ${c.id}`);
      } catch (err) {
        logger.error(`[sla] Warning check failed for case ${c.id}`, { err });
      }
    }
  } catch (err) {
    logger.error('[sla] Poll SLA warning error', { err });
  }
}

async function pollSlaBreach(prisma: PrismaClient, redisPublisher: IORedis): Promise<void> {
  try {
    const now = new Date();
    const dedupCutoff = new Date(now.getTime() - DEDUP_WINDOW_MS);

    const breachedCases = await prisma.case.findMany({
      where: {
        status: { in: ['OPEN', 'IN_PROGRESS', 'PENDING', 'ESCALATED'] as any[] },
        slaDueAt: { lt: now },
      },
      select: {
        id: true,
        tenantId: true,
        title: true,
        assigneeId: true,
        priority: true,
        slaDueAt: true,
      },
      take: 50,
    });

    for (const c of breachedCases) {
      try {
        const existing = await prisma.caseEvent.findFirst({
          where: {
            caseId: c.id,
            eventType: 'sla_breached',
            createdAt: { gte: dedupCutoff },
          },
        });

        if (existing) continue;

        const newPriority = bumpPriority(c.priority);
        if (newPriority !== c.priority) {
          await prisma.case.update({
            where: { id: c.id },
            data: { priority: newPriority as any },
          });
        }

        await prisma.caseEvent.create({
          data: {
            caseId: c.id,
            actorType: 'system',
            eventType: 'sla_breached',
            payload: {
              slaDueAt: c.slaDueAt!.toISOString(),
              previousPriority: c.priority,
              newPriority,
              type: 'resolution',
            },
          },
        });

        await publishSocketEvent(
          redisPublisher,
          `tenant:${c.tenantId}`,
          'case.updated',
          { id: c.id, priority: newPriority, source: 'sla_worker' },
        );

        await publishSocketEvent(redisPublisher, `tenant:${c.tenantId}`, 'sla.event', {
          name: 'sla.breached',
          caseId: c.id,
          assigneeId: c.assigneeId,
          title: c.title,
          slaDueAt: c.slaDueAt!.toISOString(),
          previousPriority: c.priority,
          newPriority,
          type: 'resolution',
        });

        logger.info(`[sla] SLA breached for case ${c.id}, priority ${c.priority} → ${newPriority}`);
      } catch (err) {
        logger.error(`[sla] Breach check failed for case ${c.id}`, { err });
      }
    }
  } catch (err) {
    logger.error('[sla] Poll SLA breach error', { err });
  }
}

async function pollFirstResponseTimeout(
  prisma: PrismaClient,
  redisPublisher: IORedis,
): Promise<void> {
  try {
    const now = new Date();
    const dedupCutoff = new Date(now.getTime() - DEDUP_WINDOW_MS);

    const cases = await prisma.case.findMany({
      where: {
        status: { in: ['OPEN', 'IN_PROGRESS', 'PENDING', 'ESCALATED'] as any[] },
        firstResponseAt: null,
        slaPolicy: { not: null },
      },
      select: {
        id: true,
        tenantId: true,
        title: true,
        assigneeId: true,
        slaPolicy: true,
        createdAt: true,
      },
      take: 50,
    });

    for (const c of cases) {
      try {
        const policy = await prisma.slaPolicy.findFirst({
          where: { tenantId: c.tenantId, name: c.slaPolicy! },
          select: { firstResponseMinutes: true },
        });

        if (!policy) continue;

        const deadline = new Date(
          c.createdAt.getTime() + policy.firstResponseMinutes * 60 * 1000,
        );

        if (now < deadline) continue;

        const existing = await prisma.caseEvent.findFirst({
          where: {
            caseId: c.id,
            eventType: 'first_response_breached',
            createdAt: { gte: dedupCutoff },
          },
        });

        if (existing) continue;

        await prisma.caseEvent.create({
          data: {
            caseId: c.id,
            actorType: 'system',
            eventType: 'first_response_breached',
            payload: {
              firstResponseMinutes: policy.firstResponseMinutes,
              createdAt: c.createdAt.toISOString(),
              deadline: deadline.toISOString(),
              type: 'first_response',
            },
          },
        });

        await publishSocketEvent(redisPublisher, `tenant:${c.tenantId}`, 'sla.event', {
          name: 'sla.breached',
          caseId: c.id,
          assigneeId: c.assigneeId,
          title: c.title,
          type: 'first_response',
        });

        logger.info(`[sla] First response breached for case ${c.id}`);
      } catch (err) {
        logger.error(`[sla] First response check failed for case ${c.id}`, { err });
      }
    }
  } catch (err) {
    logger.error('[sla] Poll first response timeout error', { err });
  }
}

export async function handleSlaPoll(
  prisma: PrismaClient,
  redisPublisher: IORedis,
): Promise<void> {
  await Promise.all([
    pollSlaWarning(prisma, redisPublisher),
    pollSlaBreach(prisma, redisPublisher),
    pollFirstResponseTimeout(prisma, redisPublisher),
  ]);
}
