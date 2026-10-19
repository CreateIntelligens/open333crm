import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { executeBroadcast } from './marketing.service.js';
import { logger } from '@open333crm/core';
import type { JobScheduler } from '../../lib/job-scheduler.js';

const POLL_INTERVAL_MS = 60_000; // 60 seconds

/**
 * Polls for scheduled broadcasts whose scheduledAt <= now and executes them.
 */
export function setupBroadcastScheduler(scheduler: JobScheduler, prisma: PrismaClient, io: SocketIOServer) {
  async function pollScheduled() {
    try {
      const due = await prisma.broadcast.findMany({
        where: {
          status: 'scheduled',
          scheduledAt: { lte: new Date() },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 10,
      });

      for (const broadcast of due) {
        try {
          await executeBroadcast(prisma, io, broadcast.id);
          logger.info(`[BroadcastScheduler] Executed broadcast ${broadcast.id} (${broadcast.name})`);
        } catch (err) {
          logger.error(`[BroadcastScheduler] Failed broadcast ${broadcast.id}:`, err);
        }
      }
    } catch (err) {
      logger.error('[BroadcastScheduler] Poll error:', err);
    }
  }

  scheduler.registerSchedule({ id: 'broadcast-scheduled', every: POLL_INTERVAL_MS, run: pollScheduled });
}
