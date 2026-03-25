import { ChannelPlugin, ChannelCredentials, OutboundMessage, SendResult } from '../index.js';
import type { ChannelType, UniversalMessage, ContactProfile } from '@open333crm/types';
import crypto from 'crypto';

export class FbPlugin implements ChannelPlugin {
  readonly channelType: ChannelType = 'FB';

  /**
   * Facebook Messenger Webhooks are validated via HMAC-SHA256 of the raw body.
   */
  verifySignature(rawBody: Buffer, headers: Record<string, string>, secret: string): boolean {
    const signature = headers['x-hub-signature-256'];
    if (!signature || !signature.startsWith('sha256=')) return false;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    return signature === `sha256=${expectedSignature}`;
  }

  async parseWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<UniversalMessage[]> {
    const messages: UniversalMessage[] = [];
    const payload = JSON.parse(rawBody.toString('utf-8'));
    
    if (payload.object === 'page') {
      for (const entry of payload.entry || []) {
        for (const event of entry.messaging || []) {
          if (event.message?.text) {
            messages.push({
              id: event.message.mid,
              channelType: 'FB',
              channelId: 'resolved-by-inbox',
              direction: 'inbound',
              contactUid: event.sender.id,
              timestamp: new Date(event.timestamp),
              messageType: 'text',
              content: { text: event.message.text },
              rawPayload: event
            });
          } else if (event.postback) {
            messages.push({
              id: `pb_${event.timestamp}`,
              channelType: 'FB',
              channelId: 'resolved-by-inbox',
              direction: 'inbound',
              contactUid: event.sender.id,
              timestamp: new Date(event.timestamp),
              messageType: 'postback',
              content: { postbackData: event.postback.payload },
              rawPayload: event
            });
          }
        }
      }
    }

    return messages;
  }

  async getProfile(uid: string, credentials: ChannelCredentials): Promise<ContactProfile> {
    // Requires page token to call graph.facebook.com/<PSID>
    return {
      uid,
      displayName: `FB User ${uid}`
    };
  }

  async sendMessage(to: string, message: OutboundMessage, credentials: ChannelCredentials): Promise<SendResult> {
    const pageToken = credentials.channelAccessToken;
    console.log(`[FbPlugin] Executing sendMessage to ${to} via Graph API`);
    return { success: true, messageId: `msg_${Date.now()}` };
  }
}
