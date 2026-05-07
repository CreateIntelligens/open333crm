/**
 * Inactivity Close Worker — periodically closes BOT_HANDLED conversations
 * that have been idle longer than the per-tenant `botInactivityCloseHours`
 * threshold (default 1h). AGENT_HANDLED conversations are not touched —
 * agents may be working on them in the background.
 *
 * Polls every POLL_INTERVAL_MS, groups candidates by tenant, uses each
 * tenant's TenantSettings.botInactivityCloseHours. Skips closed conversations
 * (idempotent) and conversations with empty lastMessageAt.
 */

import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { logger } from '@open333crm/core';
import { closeConversation } from './conversation.service.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes (inactivity is hourly-scale)
const STARTUP_DELAY_MS = 30_000;

export function setupInactivityCloseWorker(prisma: PrismaClient, io: SocketIOServer) {
  async function pollInactivity() {
    try {
      // Group by tenant so each tenant's threshold applies independently.
      const tenantSettings = await prisma.tenantSettings.findMany({
        select: { tenantId: true, botInactivityCloseHours: true },
      });

      let closedCount = 0;
      for (const settings of tenantSettings) {
        const hours = settings.botInactivityCloseHours;
        if (!Number.isFinite(hours) || hours <= 0) continue; // disabled

        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

        const candidates = await prisma.conversation.findMany({
          where: {
            tenantId: settings.tenantId,
            status: 'BOT_HANDLED',
            lastMessageAt: { not: null, lt: cutoff },
          },
          select: { id: true },
        });

        for (const c of candidates) {
          try {
            await closeConversation(prisma, io, c.id, settings.tenantId, {
              source: 'inactivity',
              reason: `Auto-closed after ${hours}h of BOT inactivity`,
            });
            closedCount++;
          } catch (err) {
            logger.error(`[InactivityCloseWorker] Failed to close ${c.id}:`, err);
          }
        }
      }

      if (closedCount > 0) {
        logger.info(`[InactivityCloseWorker] Closed ${closedCount} inactive BOT conversations`);
      }
    } catch (err) {
      logger.error('[InactivityCloseWorker] Poll error:', err);
    }
  }

  setInterval(pollInactivity, POLL_INTERVAL_MS);
  setTimeout(pollInactivity, STARTUP_DELAY_MS);

  logger.info('[InactivityCloseWorker] Started — polling every 5min for inactive BOT conversations');
}
