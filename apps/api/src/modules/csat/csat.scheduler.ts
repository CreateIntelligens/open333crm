import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { sendCsatSurvey } from './csat.service.js';
import { eventBus } from '../../events/event-bus.js';
import { logger } from '@open333crm/core';

const POLL_INTERVAL_MS = 60_000; // 60 seconds
const CSAT_DELAY_MINUTES = 5; // POC: 5 minutes after resolution (design doc: 30 min)
const AUTO_CLOSE_HOURS = 72; // auto-close after 72h without CSAT response

/**
 * Setup CSAT scheduler with two polling tasks:
 * 1. Send CSAT surveys for resolved cases after delay
 * 2. Auto-close cases that haven't received CSAT response within timeout
 */
export function setupCsatScheduler(prisma: PrismaClient, io: SocketIOServer) {
  /**
   * Poll for resolved cases that need CSAT survey sent.
   */
  async function pollSendCsat() {
    try {
      const cutoff = new Date(Date.now() - CSAT_DELAY_MINUTES * 60 * 1000);

      const cases = await prisma.case.findMany({
        where: {
          status: 'RESOLVED',
          csatSentAt: null,
          resolvedAt: { lte: cutoff },
          conversationId: { not: null },
        },
        orderBy: { resolvedAt: 'asc' },
        take: 10,
      });

      for (const c of cases) {
        try {
          const sent = await sendCsatSurvey(prisma, io, c.id);
          if (sent) {
            logger.info(`[CsatScheduler] Sent CSAT survey for case ${c.id}`);
          }
        } catch (err) {
          logger.error(`[CsatScheduler] Failed to send CSAT for case ${c.id}:`, err);
        }
      }
    } catch (err) {
      logger.error('[CsatScheduler] Poll send error:', err);
    }
  }

  /**
   * Poll for cases that sent CSAT but haven't received response, auto-close after timeout.
   */
  async function pollAutoClose() {
    try {
      const cutoff = new Date(Date.now() - AUTO_CLOSE_HOURS * 60 * 60 * 1000);

      const cases = await prisma.case.findMany({
        where: {
          status: 'RESOLVED',
          csatSentAt: { not: null, lte: cutoff },
          csatRespondedAt: null,
        },
        orderBy: { csatSentAt: 'asc' },
        take: 10,
      });

      for (const c of cases) {
        try {
          const now = new Date();
          await prisma.case.update({
            where: { id: c.id },
            data: {
              status: 'CLOSED',
              closedAt: now,
            },
          });

          // Publish case.closed event
          eventBus.publish({
            name: 'case.closed',
            tenantId: c.tenantId,
            timestamp: now,
            payload: {
              caseId: c.id,
              contactId: c.contactId,
              channelId: c.channelId,
              conversationId: c.conversationId,
              assigneeId: c.assigneeId,
              title: c.title,
              autoClosedNoResponse: true,
            },
          });

          io.to(`tenant:${c.tenantId}`).emit('case.updated', {
            id: c.id,
            status: 'CLOSED',
            priority: c.priority,
            assigneeId: c.assigneeId,
          });

          logger.info(`[CsatScheduler] Auto-closed case ${c.id} (no CSAT response after ${AUTO_CLOSE_HOURS}h)`);
        } catch (err) {
          logger.error(`[CsatScheduler] Failed to auto-close case ${c.id}:`, err);
        }
      }
    } catch (err) {
      logger.error('[CsatScheduler] Poll auto-close error:', err);
    }
  }

  // Poll every 60 seconds
  setInterval(pollSendCsat, POLL_INTERVAL_MS);
  setInterval(pollAutoClose, POLL_INTERVAL_MS);

  // Run once on startup with delay
  setTimeout(pollSendCsat, 8000);
  setTimeout(pollAutoClose, 12000);

  logger.info(`[CsatScheduler] Started — send delay: ${CSAT_DELAY_MINUTES}min, auto-close: ${AUTO_CLOSE_HOURS}h`);
}
