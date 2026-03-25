/**
 * LINE Media Download Service — downloads media from LINE Content API and stores in S3.
 */

import type { PrismaClient } from '@prisma/client';
import { decryptCredentials } from '../channel/channel.service.js';
import { uploadFile } from './storage.service.js';

const CONTENT_TYPE_MAP: Record<string, { ext: string; mime: string }> = {
  image: { ext: '.jpg', mime: 'image/jpeg' },
  video: { ext: '.mp4', mime: 'video/mp4' },
  audio: { ext: '.m4a', mime: 'audio/mp4' },
  file: { ext: '', mime: 'application/octet-stream' },
};

export async function downloadAndStoreLineMedia(
  prisma: PrismaClient,
  channelId: string,
  tenantId: string,
  contentId: string,
  contentType: string,
  conversationId: string,
): Promise<{ url: string; storageKey: string } | null> {
  try {
    // 1. Get channel credentials
    const channel = await prisma.channel.findFirst({
      where: { id: channelId, tenantId },
    });

    if (!channel) {
      console.error('[LineMedia] Channel not found:', channelId);
      return null;
    }

    const credentials = decryptCredentials(channel.credentialsEncrypted);
    const accessToken = credentials.channelAccessToken as string;

    if (!accessToken) {
      console.error('[LineMedia] No access token for channel:', channelId);
      return null;
    }

    // 2. Fetch content from LINE Content API
    const contentUrl = `https://api-data.line.me/v2/bot/message/${contentId}/content`;
    const response = await fetch(contentUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      console.error(`[LineMedia] LINE Content API failed (${response.status}):`, await response.text());
      return null;
    }

    // 3. Read response body as buffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 4. Determine filename and mime type
    const typeInfo = CONTENT_TYPE_MAP[contentType] || CONTENT_TYPE_MAP.file;
    const filename = `line_${contentId}${typeInfo.ext}`;
    const mimeType = response.headers.get('content-type') || typeInfo.mime;

    // 5. Upload to S3 with organized path
    const result = await uploadFile(buffer, filename, mimeType, tenantId, 'media', conversationId);

    console.log(`[LineMedia] Stored LINE content ${contentId} → ${result.key}`);
    return { url: result.url, storageKey: result.key };
  } catch (err) {
    console.error('[LineMedia] Failed to download and store:', err);
    return null;
  }
}
