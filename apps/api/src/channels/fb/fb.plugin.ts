import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ChannelPlugin, ParsedWebhookMessage, OutboundPayload } from '../base.plugin.js';

const FB_GRAPH_API = 'https://graph.facebook.com/v21.0';

export class FbPlugin implements ChannelPlugin {
  readonly channelType = 'FB';

  /**
   * Verify Facebook webhook signature using HMAC-SHA256.
   * Facebook sends the signature in the `x-hub-signature-256` header.
   * The secret used is the App Secret.
   */
  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): boolean {
    const signature = headers['x-hub-signature-256'];
    if (!signature) return false;

    const expectedHash = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const expected = `sha256=${expectedHash}`;

    try {
      return timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected),
      );
    } catch {
      return false;
    }
  }

  /**
   * Parse Facebook Messenger webhook payload.
   * Handles text messages and attachments (image, video, audio, file).
   */
  async parseWebhook(
    rawBody: Buffer,
    _headers: Record<string, string>,
  ): Promise<ParsedWebhookMessage[]> {
    const body = JSON.parse(rawBody.toString());
    const entries = body.entry ?? [];
    const messages: ParsedWebhookMessage[] = [];

    for (const entry of entries) {
      const messaging = entry.messaging ?? [];
      for (const event of messaging) {
        // Skip echo messages (sent by the page itself)
        if (event.message?.is_echo) continue;

        if (event.message) {
          const msg = event.message;
          let contentType = 'text';
          let content: Record<string, unknown> = { text: msg.text ?? '' };

          // Handle attachments
          if (msg.attachments && msg.attachments.length > 0) {
            const attachment = msg.attachments[0];
            const type = attachment.type; // image, video, audio, file, location, fallback

            switch (type) {
              case 'image':
                contentType = 'image';
                content = {
                  text: '[圖片]',
                  url: attachment.payload?.url,
                };
                break;
              case 'video':
                contentType = 'video';
                content = {
                  text: '[影片]',
                  url: attachment.payload?.url,
                };
                break;
              case 'audio':
                contentType = 'audio';
                content = {
                  text: '[語音]',
                  url: attachment.payload?.url,
                };
                break;
              case 'file':
                contentType = 'file';
                content = {
                  text: '[檔案]',
                  url: attachment.payload?.url,
                };
                break;
              case 'location':
                contentType = 'location';
                content = {
                  text: '[位置]',
                  latitude: attachment.payload?.coordinates?.lat,
                  longitude: attachment.payload?.coordinates?.long,
                };
                break;
              default:
                contentType = 'text';
                content = { text: msg.text || `[${type}]` };
            }
          }

          messages.push({
            channelMsgId: msg.mid,
            contactUid: event.sender?.id ?? '',
            timestamp: new Date(event.timestamp ?? Date.now()),
            contentType,
            content,
            rawPayload: event,
          });
        }

        // Handle postback events (button clicks)
        if (event.postback) {
          messages.push({
            channelMsgId: undefined,
            contactUid: event.sender?.id ?? '',
            timestamp: new Date(event.timestamp ?? Date.now()),
            contentType: 'text',
            content: {
              text: event.postback.title || event.postback.payload || '[按鈕回應]',
            },
            rawPayload: event,
          });
        }
      }
    }

    return messages;
  }

  /**
   * Fetch user profile from Facebook Graph API.
   */
  async getProfile(
    uid: string,
    credentials: Record<string, unknown>,
  ): Promise<{ uid: string; displayName: string; avatarUrl?: string }> {
    const token = credentials.pageAccessToken as string;

    try {
      const response = await fetch(
        `${FB_GRAPH_API}/${uid}?fields=first_name,last_name,profile_pic&access_token=${token}`,
      );

      if (!response.ok) {
        return {
          uid,
          displayName: `FB User ${uid.slice(-4)}`,
          avatarUrl: undefined,
        };
      }

      const profile = (await response.json()) as {
        first_name?: string;
        last_name?: string;
        profile_pic?: string;
      };

      const displayName = [profile.first_name, profile.last_name]
        .filter(Boolean)
        .join(' ') || `FB User ${uid.slice(-4)}`;

      return {
        uid,
        displayName,
        avatarUrl: profile.profile_pic,
      };
    } catch {
      return {
        uid,
        displayName: `FB User ${uid.slice(-4)}`,
        avatarUrl: undefined,
      };
    }
  }

  /**
   * Send a message via Facebook Send API.
   */
  async sendMessage(
    to: string,
    message: OutboundPayload,
    credentials: Record<string, unknown>,
  ): Promise<{ success: boolean; channelMsgId?: string; error?: string }> {
    const token = credentials.pageAccessToken as string;

    const fbMessage = this.buildFbMessage(message);

    try {
      const response = await fetch(`${FB_GRAPH_API}/me/messages?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: to },
          message: fbMessage,
        }),
      });

      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        return {
          success: false,
          error: errBody.error?.message ?? `FB API error: ${response.status}`,
        };
      }

      const result = (await response.json()) as { message_id?: string };
      return {
        success: true,
        channelMsgId: result.message_id,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  private buildFbMessage(payload: OutboundPayload): Record<string, unknown> {
    const { contentType, content } = payload;

    switch (contentType) {
      case 'image':
        return {
          attachment: {
            type: 'image',
            payload: { url: content.url as string, is_reusable: true },
          },
        };
      case 'video':
        return {
          attachment: {
            type: 'video',
            payload: { url: content.url as string, is_reusable: true },
          },
        };
      case 'audio':
        return {
          attachment: {
            type: 'audio',
            payload: { url: content.url as string, is_reusable: true },
          },
        };
      case 'file':
        return {
          attachment: {
            type: 'file',
            payload: { url: content.url as string, is_reusable: true },
          },
        };
      case 'text':
      default:
        return { text: (content.text as string) ?? '' };
    }
  }
}

export const fbPlugin = new FbPlugin();
