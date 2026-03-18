import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ChannelPlugin, ParsedWebhookMessage, OutboundPayload } from '../base.plugin.js';

export class LinePlugin implements ChannelPlugin {
  readonly channelType = 'LINE';

  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): boolean {
    const signature = headers['x-line-signature'];
    if (!signature) return false;

    const hash = createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    try {
      return timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(hash),
      );
    } catch {
      return false;
    }
  }

  async parseWebhook(
    rawBody: Buffer,
    _headers: Record<string, string>,
  ): Promise<ParsedWebhookMessage[]> {
    const body = JSON.parse(rawBody.toString());
    const events = body.events ?? [];

    return events
      .filter((e: any) => e.type === 'message')
      .map((e: any) => {
        const msg = e.message;
        const contentType = msg?.type ?? 'text';
        let content: Record<string, unknown> = {};

        switch (contentType) {
          case 'text':
            content = { text: msg.text ?? '' };
            break;
          case 'image':
          case 'video':
          case 'audio':
          case 'file':
            content = {
              text: `[${contentType === 'image' ? '圖片' : contentType === 'video' ? '影片' : contentType === 'audio' ? '語音' : '檔案'}]`,
              contentId: msg.id,
              fileName: msg.fileName,
              fileSize: msg.fileSize,
            };
            break;
          case 'sticker':
            content = {
              text: '[貼圖]',
              packageId: msg.packageId,
              stickerId: msg.stickerId,
            };
            break;
          case 'location':
            content = {
              text: `[位置] ${msg.title ?? msg.address ?? ''}`.trim(),
              title: msg.title,
              address: msg.address,
              latitude: msg.latitude,
              longitude: msg.longitude,
            };
            break;
          default:
            content = { text: `[${contentType}]` };
        }

        return {
          channelMsgId: msg?.id,
          contactUid: e.source?.userId ?? '',
          timestamp: new Date(e.timestamp ?? Date.now()),
          contentType,
          content,
          rawPayload: e,
        };
      });
  }

  async getProfile(
    uid: string,
    credentials: Record<string, unknown>,
  ): Promise<{ uid: string; displayName: string; avatarUrl?: string }> {
    const token = credentials.channelAccessToken as string;

    try {
      const response = await fetch(`https://api.line.me/v2/bot/profile/${uid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        return {
          uid,
          displayName: `LINE User ${uid.slice(-4)}`,
          avatarUrl: undefined,
        };
      }

      const profile = (await response.json()) as {
        userId: string;
        displayName: string;
        pictureUrl?: string;
      };

      return {
        uid: profile.userId,
        displayName: profile.displayName,
        avatarUrl: profile.pictureUrl,
      };
    } catch {
      return {
        uid,
        displayName: `LINE User ${uid.slice(-4)}`,
        avatarUrl: undefined,
      };
    }
  }

  async sendMessage(
    to: string,
    message: OutboundPayload,
    credentials: Record<string, unknown>,
  ): Promise<{ success: boolean; channelMsgId?: string; error?: string }> {
    const token = credentials.channelAccessToken as string;

    const lineMessages = this.buildLineMessages(message);

    try {
      const response = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to,
          messages: lineMessages,
        }),
      });

      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        return {
          success: false,
          error: (errBody.message as string) ?? `LINE API error: ${response.status}`,
        };
      }

      return {
        success: true,
        channelMsgId: `line-push-${Date.now()}`,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  private buildLineMessages(payload: OutboundPayload): unknown[] {
    const { contentType, content } = payload;

    switch (contentType) {
      case 'text':
        return [{ type: 'text', text: (content.text as string) ?? '' }];
      default:
        return [{ type: 'text', text: (content.text as string) ?? '' }];
    }
  }
}

export const linePlugin = new LinePlugin();
