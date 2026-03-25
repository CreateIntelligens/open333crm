// worker-narrowcast-progress.ts — Task 6.3
// BullMQ worker that polls Narrowcast delivery progress every 5 minutes
// until sendingComplete. Updates Broadcast record status accordingly.

import { Worker, Queue } from 'bullmq';
import { redis } from '@open333crm/core';
import type { LineChannelCredentials } from './index.js';

export interface NarrowcastProgressJob {
  broadcastDbId: string;
  lineRequestId: string;
  credentials: LineChannelCredentials;
  polledCount?: number;
}

const LINE_API = 'https://api.line.me';
const MAX_POLLS = 144; // 144 × 5min = 12 hours max tracking

export const narrowcastProgressQueue = new Queue<NarrowcastProgressJob>('line-narrowcast-progress', {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 1, // polling re-queues itself
  },
});

export function createNarrowcastProgressWorker(
  getBroadcast: (id: string) => Promise<{ status: string } | null>,
  updateBroadcast: (id: string, status: string, stats?: Record<string, unknown>) => Promise<void>,
) {
  return new Worker<NarrowcastProgressJob>(
    'line-narrowcast-progress',
    async (job) => {
      const { broadcastDbId, lineRequestId, credentials, polledCount = 0 } = job.data;

      // Guard: stop if already completed/cancelled in DB
      const broadcast = await getBroadcast(broadcastDbId);
      if (!broadcast || broadcast.status === 'completed' || broadcast.status === 'cancelled') return;

      // Guard: max polling window reached
      if (polledCount >= MAX_POLLS) {
        await updateBroadcast(broadcastDbId, 'failed', { reason: 'polling_timeout' });
        return;
      }

      const res = await fetch(
        `${LINE_API}/v2/bot/message/progress/narrowcast?requestId=${lineRequestId}`,
        { headers: { Authorization: `Bearer ${credentials.channelAccessToken}` } },
      );

      if (!res.ok) {
        // Re-queue for retry on transient errors
        await narrowcastProgressQueue.add('poll', { ...job.data, polledCount: polledCount + 1 }, { delay: 5 * 60 * 1000 });
        return;
      }

      const data = await res.json() as Record<string, unknown>;
      const phase = String(data.phase ?? 'unknown');

      if (phase === 'succeeded' || phase === 'canceled') {
        await updateBroadcast(broadcastDbId, phase === 'succeeded' ? 'completed' : 'cancelled', {
          successCount: data.successCount,
          errorCount: data.errorCount,
        });
        return;
      }

      // Still in progress — re-enqueue after 5 minutes
      await narrowcastProgressQueue.add('poll', { ...job.data, polledCount: polledCount + 1 }, { delay: 5 * 60 * 1000 });
    },
    { connection: redis as any, concurrency: 20 },
  );
}
