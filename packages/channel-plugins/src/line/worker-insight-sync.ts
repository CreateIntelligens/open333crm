// worker-insight-sync.ts — Task 7.4
// Daily scheduled worker that syncs LINE Insight data (followers + demographics)
// Schedule: UTC 00:30 daily (run via cron or BullMQ repeat pattern)
// Data is stored in `insight_snapshots` table to outlive LINE's 14-day retention.

import { Worker, Queue } from 'bullmq';
import type { LineChannelCredentials } from './index.js';

export interface InsightSyncJob {
  channelId: string;
  credentials: LineChannelCredentials;
  /** YYYYMMDD — yesterday's date */
  date: string;
}

const LINE_API = 'https://api.line.me';

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export const insightSyncQueue = new Queue<InsightSyncJob>('line-insight-sync', {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  },
});

/** Schedule the daily sync job for a channel. Call this on app boot (or cron). */
export async function scheduleInsightSync(channelId: string, credentials: LineChannelCredentials) {
  await insightSyncQueue.add(
    'daily-sync',
    { channelId, credentials, date: yesterday() },
    {
      repeat: { pattern: '30 0 * * *' }, // UTC 00:30 daily
      jobId: `insight-sync-${channelId}`,
    },
  );
}

export function createInsightSyncWorker(
  saveSnapshot: (channelId: string, date: string, data: {
    followers: number;
    blocks: number;
    targetedReaches: number;
    demographicsJson?: unknown;
  }) => Promise<void>,
) {
  return new Worker<InsightSyncJob>(
    'line-insight-sync',
    async (job) => {
      const { channelId, credentials, date } = job.data;
      const token = credentials.channelAccessToken;

      const headers = { Authorization: `Bearer ${token}` };

      // Task 7.1: Follower stats
      const followerRes = await fetch(`${LINE_API}/v2/bot/insight/followers?date=${date}`, { headers });
      const followerData = followerRes.ok
        ? (await followerRes.json() as { followers?: number; blocks?: number; targetedReaches?: number })
        : {};

      // Task 7.3: Demographics
      const demoRes = await fetch(`${LINE_API}/v2/bot/insight/demographic`, { headers });
      const demoData = demoRes.ok ? await demoRes.json() : null;

      await saveSnapshot(channelId, date, {
        followers: followerData.followers ?? 0,
        blocks: followerData.blocks ?? 0,
        targetedReaches: followerData.targetedReaches ?? 0,
        demographicsJson: demoData,
      });
    },
    { concurrency: 5 },
  );
}
