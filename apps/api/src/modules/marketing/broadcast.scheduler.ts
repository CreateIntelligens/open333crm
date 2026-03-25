import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { executeBroadcast } from './marketing.service.js';

const POLL_INTERVAL_MS = 60_000; // 60 seconds

/**
 * Polls for scheduled broadcasts whose scheduledAt <= now and executes them.
 */
export function setupBroadcastScheduler(prisma: PrismaClient, io: SocketIOServer) {
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
          console.log(`[BroadcastScheduler] Executed broadcast ${broadcast.id} (${broadcast.name})`);
        } catch (err) {
          console.error(`[BroadcastScheduler] Failed broadcast ${broadcast.id}:`, err);
        }
      }
    } catch (err) {
      console.error('[BroadcastScheduler] Poll error:', err);
    }
  }

  // Poll every 60 seconds
  setInterval(pollScheduled, POLL_INTERVAL_MS);

  // Also run once on startup (with a short delay)
  setTimeout(pollScheduled, 5000);

  console.log(`[BroadcastScheduler] Started, polling every ${POLL_INTERVAL_MS / 1000}s`);
}
