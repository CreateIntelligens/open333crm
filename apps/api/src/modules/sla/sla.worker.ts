/**
 * SLA Worker — polls every 60s for SLA warnings, breaches, and first-response timeouts.
 *
 * Three tasks:
 * 1. SLA Warning: slaDueAt - warningBeforeMinutes <= now < slaDueAt (no duplicate event in 24h)
 * 2. SLA Breached: slaDueAt < now → auto-bump priority, create CaseEvent, publish sla.breached
 * 3. First Response Timeout: firstResponseAt IS NULL && createdAt + firstResponseMinutes < now
 */

import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { eventBus } from '../../events/event-bus.js';

const POLL_INTERVAL_MS = 60_000; // 60 seconds
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

const PRIORITY_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

function bumpPriority(current: string): string {
  const idx = PRIORITY_ORDER.indexOf(current as typeof PRIORITY_ORDER[number]);
  if (idx < 0 || idx >= PRIORITY_ORDER.length - 1) return current;
  return PRIORITY_ORDER[idx + 1];
}

export function setupSlaWorker(prisma: PrismaClient, io: SocketIOServer) {
  /**
   * Task 1: SLA Warning — cases approaching SLA deadline
   */
  async function pollSlaWarning() {
    try {
      const now = new Date();
      const dedupCutoff = new Date(now.getTime() - DEDUP_WINDOW_MS);

      // Find active cases with SLA due soon (within warningBeforeMinutes)
      // We need to join with SlaPolicy to get warningBeforeMinutes
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
          // Look up policy to get warningBeforeMinutes
          const policy = await prisma.slaPolicy.findFirst({
            where: { tenantId: c.tenantId, name: c.slaPolicy! },
            select: { warningBeforeMinutes: true },
          });

          if (!policy) continue;

          const warningThreshold = new Date(
            c.slaDueAt!.getTime() - policy.warningBeforeMinutes * 60 * 1000,
          );

          if (now < warningThreshold) continue; // Not yet in warning window

          // Dedup: check if sla_warning event already exists in 24h
          const existing = await prisma.caseEvent.findFirst({
            where: {
              caseId: c.id,
              eventType: 'sla_warning',
              createdAt: { gte: dedupCutoff },
            },
          });

          if (existing) continue;

          // Create CaseEvent
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

          // Publish event (notification.worker.ts handles sla.warning)
          eventBus.publish({
            name: 'sla.warning',
            tenantId: c.tenantId,
            timestamp: now,
            payload: {
              caseId: c.id,
              assigneeId: c.assigneeId,
              title: c.title,
              slaDueAt: c.slaDueAt!.toISOString(),
            },
          });

          console.log(`[SlaWorker] SLA warning for case ${c.id}`);
        } catch (err) {
          console.error(`[SlaWorker] Warning check failed for case ${c.id}:`, err);
        }
      }
    } catch (err) {
      console.error('[SlaWorker] Poll SLA warning error:', err);
    }
  }

  /**
   * Task 2: SLA Breached — cases past SLA deadline
   */
  async function pollSlaBreach() {
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
          // Dedup: check if sla_breached event already exists in 24h
          const existing = await prisma.caseEvent.findFirst({
            where: {
              caseId: c.id,
              eventType: 'sla_breached',
              createdAt: { gte: dedupCutoff },
            },
          });

          if (existing) continue;

          // Auto-bump priority one level
          const newPriority = bumpPriority(c.priority);
          if (newPriority !== c.priority) {
            await prisma.case.update({
              where: { id: c.id },
              data: { priority: newPriority as any },
            });
          }

          // Create CaseEvent
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

          // Emit WebSocket
          io.to(`tenant:${c.tenantId}`).emit('case.updated', {
            id: c.id,
            priority: newPriority,
            source: 'sla_worker',
          });

          // Publish event (notification.worker.ts handles sla.breached)
          eventBus.publish({
            name: 'sla.breached',
            tenantId: c.tenantId,
            timestamp: now,
            payload: {
              caseId: c.id,
              assigneeId: c.assigneeId,
              title: c.title,
              slaDueAt: c.slaDueAt!.toISOString(),
              previousPriority: c.priority,
              newPriority,
              type: 'resolution',
            },
          });

          console.log(`[SlaWorker] SLA breached for case ${c.id}, priority ${c.priority} → ${newPriority}`);
        } catch (err) {
          console.error(`[SlaWorker] Breach check failed for case ${c.id}:`, err);
        }
      }
    } catch (err) {
      console.error('[SlaWorker] Poll SLA breach error:', err);
    }
  }

  /**
   * Task 3: First Response Timeout — cases without firstResponseAt past firstResponseMinutes
   */
  async function pollFirstResponseTimeout() {
    try {
      const now = new Date();
      const dedupCutoff = new Date(now.getTime() - DEDUP_WINDOW_MS);

      // Find cases without firstResponseAt that have an SLA policy
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
          // Look up policy to get firstResponseMinutes
          const policy = await prisma.slaPolicy.findFirst({
            where: { tenantId: c.tenantId, name: c.slaPolicy! },
            select: { firstResponseMinutes: true },
          });

          if (!policy) continue;

          const deadline = new Date(
            c.createdAt.getTime() + policy.firstResponseMinutes * 60 * 1000,
          );

          if (now < deadline) continue; // Not yet timed out

          // Dedup: check if first_response_breached event already exists in 24h
          const existing = await prisma.caseEvent.findFirst({
            where: {
              caseId: c.id,
              eventType: 'first_response_breached',
              createdAt: { gte: dedupCutoff },
            },
          });

          if (existing) continue;

          // Create CaseEvent
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

          // Publish sla.breached event (notification.worker.ts handles it)
          eventBus.publish({
            name: 'sla.breached',
            tenantId: c.tenantId,
            timestamp: now,
            payload: {
              caseId: c.id,
              assigneeId: c.assigneeId,
              title: c.title,
              type: 'first_response',
            },
          });

          console.log(`[SlaWorker] First response breached for case ${c.id}`);
        } catch (err) {
          console.error(`[SlaWorker] First response check failed for case ${c.id}:`, err);
        }
      }
    } catch (err) {
      console.error('[SlaWorker] Poll first response timeout error:', err);
    }
  }

  // Poll every 60 seconds
  setInterval(pollSlaWarning, POLL_INTERVAL_MS);
  setInterval(pollSlaBreach, POLL_INTERVAL_MS);
  setInterval(pollFirstResponseTimeout, POLL_INTERVAL_MS);

  // Run once on startup with delay
  setTimeout(pollSlaWarning, 10_000);
  setTimeout(pollSlaBreach, 14_000);
  setTimeout(pollFirstResponseTimeout, 18_000);

  console.log('[SlaWorker] Started — polling every 60s for SLA warnings, breaches, and first response timeouts');
}
