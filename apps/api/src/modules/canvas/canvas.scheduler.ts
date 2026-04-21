import type { PrismaClient } from '@prisma/client';
import { processResumeQueue , logger } from '@open333crm/core';

const POLL_INTERVAL_MS = 60_000;

export function setupCanvasScheduler(prisma: PrismaClient) {
  let isPolling = false;

  async function pollResumeQueue() {
    if (isPolling) return;
    isPolling = true;

    try {
      await processResumeQueue();
    } catch (err) {
      logger.error('[CanvasScheduler] Failed to process resume queue:', err);
    } finally {
      isPolling = false;
    }
  }

  setInterval(pollResumeQueue, POLL_INTERVAL_MS);
  setTimeout(pollResumeQueue, 5000);

  logger.info(
    `[CanvasScheduler] Started WAIT resume poller (interval: ${Math.round(POLL_INTERVAL_MS / 1000)}s)`,
  );
}
