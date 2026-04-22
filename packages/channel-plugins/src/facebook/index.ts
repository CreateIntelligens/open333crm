import { ChannelPlugin, ParsedWebhookMessage, OutboundPayload } from '../index.js';
import crypto from 'crypto';
import { CHANNEL_TYPE } from '@open333crm/shared';

const FB_GRAPH_API = 'https://graph.facebook.com/v21.0';

export class FbPlugin implements ChannelPlugin {
  readonly channelType = CHANNEL_TYPE.FB;

  verifySignature(rawBody: Buffer, headers: Record<string, string>, secret: string): boolean {
    const signature = headers['x-hub-signature-256'];
    if (!signature || !signature.startsWith('sha256=')) return false;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    return signature === `sha256=${expectedSignature}`;
  }

  async parseWebhook(rawBody: Buffer, _headers: Record<string, string>): Promise<ParsedWebhookMessage[]> {
    const messages: ParsedWebhookMessage[] = [];
    const payload = JSON.parse(rawBody.toString('utf-8'));

    if (payload.object === 'page') {
      for (const entry of payload.entry || []) {
        for (const event of entry.messaging || []) {
          // Skip echo messages
          if (event.message?.is_echo) continue;

          if (event.message) {
            const msg = event.message;
            let contentType = 'text';
            let content: Record<string, unknown> = { text: msg.text ?? '' };

            if (msg.attachments?.length) {
              const attachment = msg.attachments[0];
              switch (attachment.type) {
                case 'image':
                  contentType = 'image'; content = { text: '[圖片]', url: attachment.payload?.url }; break;
                case 'video':
                  contentType = 'video'; content = { text: '[影片]', url: attachment.payload?.url }; break;
                case 'audio':
                  contentType = 'audio'; content = { text: '[語音]', url: attachment.payload?.url }; break;
                case 'file':
                  contentType = 'file'; content = { text: '[檔案]', url: attachment.payload?.url }; break;
                case 'location':
                  contentType = 'location';
                  content = { text: '[位置]', latitude: attachment.payload?.coordinates?.lat, longitude: attachment.payload?.coordinates?.long };
                  break;
                default:
                  content = { text: msg.text || `[${attachment.type}]` };
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

          if (event.postback) {
            messages.push({
              channelMsgId: undefined,
              contactUid: event.sender?.id ?? '',
              timestamp: new Date(event.timestamp ?? Date.now()),
              contentType: 'postback',
              content: { text: event.postback.title || event.postback.payload || '[按鈕回應]' },
              rawPayload: event,
            });
          }
        }
      }
    }

    return messages;
  }

  async getProfile(uid: string, credentials: Record<string, unknown>): Promise<{ uid: string; displayName: string; avatarUrl?: string }> {
    const token = credentials.pageAccessToken as string;

    try {
      const response = await fetch(
        `${FB_GRAPH_API}/${uid}?fields=first_name,last_name,profile_pic&access_token=${token}`,
      );

      if (!response.ok) return { uid, displayName: `FB User ${uid.slice(-4)}` };

      const profile = await response.json() as { first_name?: string; last_name?: string; profile_pic?: string };
      const displayName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || `FB User ${uid.slice(-4)}`;
      return { uid, displayName, avatarUrl: profile.profile_pic };
    } catch {
      return { uid, displayName: `FB User ${uid.slice(-4)}` };
    }
  }

  async sendMessage(to: string, message: OutboundPayload, credentials: Record<string, unknown>): Promise<{ success: boolean; channelMsgId?: string; error?: string }> {
    const token = credentials.pageAccessToken as string;
    const { contentType, content } = message;

    const fbMessage = this.buildFbMessage(contentType, content);

    try {
      const response = await fetch(`${FB_GRAPH_API}/me/messages?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: to }, message: fbMessage }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({})) as { error?: { message?: string } };
        return { success: false, error: errBody.error?.message ?? `FB API error: ${response.status}` };
      }

      const result = await response.json() as { message_id?: string };
      return { success: true, channelMsgId: result.message_id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  private buildFbMessage(contentType: string, content: Record<string, unknown>): Record<string, unknown> {
    switch (contentType) {
      case 'image':
        return { attachment: { type: 'image', payload: { url: content.url as string, is_reusable: true } } };
      case 'video':
        return { attachment: { type: 'video', payload: { url: content.url as string, is_reusable: true } } };
      case 'audio':
        return { attachment: { type: 'audio', payload: { url: content.url as string, is_reusable: true } } };
      case 'file':
        return { attachment: { type: 'file', payload: { url: content.url as string, is_reusable: true } } };
      case 'text':
      default:
        return { text: (content.text as string) ?? '' };
    }
  }
}

export const fbPlugin = new FbPlugin();

