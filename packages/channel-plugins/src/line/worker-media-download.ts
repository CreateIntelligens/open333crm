// worker-media-download.ts — Task 3.2
// BullMQ worker that downloads LINE media content and uploads to Storage Layer
// Triggered by LinePlugin.parseWebhook() for image/video/audio/file messages

import { Worker, Queue } from 'bullmq';
import { redis } from '@open333crm/core';

export interface MediaDownloadJob {
  lineMessageId: string;
  channelId: string;
  messageDbId: string;
  channelAccessToken: string;
  mediaType: 'image' | 'video' | 'audio' | 'file';
}

const LINE_API = 'https://api.line.me';

// Queue export for producers (LinePlugin webhook handler)
export const mediaDownloadQueue = new Queue<MediaDownloadJob>('line-media-download', {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
});

/**
 * Create and start the worker.
 * @param storageUpload - function provided by the app that uploads Buffer and returns permanent URL
 * @param updateMessageUrl - function to update the Message record's mediaUrl in DB
 */
export function createMediaDownloadWorker(
  storageUpload: (buffer: Buffer, filename: string, contentType: string) => Promise<string>,
  updateMessageUrl: (messageDbId: string, permanentUrl: string) => Promise<void>,
) {
  return new Worker<MediaDownloadJob>(
    'line-media-download',
    async (job) => {
      const { lineMessageId, channelAccessToken, mediaType, messageDbId } = job.data;

      // Download from LINE Content API
      const res = await fetch(`${LINE_API}/v2/bot/message/${lineMessageId}/content`, {
        headers: { Authorization: `Bearer ${channelAccessToken}` },
      });
      if (!res.ok) throw new Error(`Failed to download media ${lineMessageId}: ${res.status}`);

      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
      const ext = contentType.split('/')[1] ?? mediaType;
      const filename = `line-${lineMessageId}.${ext}`;

      // Upload to Storage Layer (Task 3.3: permanent URL)
      const permanentUrl = await storageUpload(buffer, filename, contentType);

      // Update Message record
      await updateMessageUrl(messageDbId, permanentUrl);
    },
    {
      connection: redis as any,
      concurrency: 10,
    },
  );
}
