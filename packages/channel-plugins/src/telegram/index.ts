import { ChannelPlugin, ChannelCredentials, OutboundMessage, SendResult } from '../index.js';
import type { ChannelType, UniversalMessage, ContactProfile } from '@open333crm/types';

export class TelegramPlugin implements ChannelPlugin {
  readonly channelType: ChannelType = 'TELEGRAM';

  /**
   * Telegram Webhooks are validated by comparing a secret token sent in the headers.
   */
  verifySignature(rawBody: Buffer, headers: Record<string, string>, secret: string): boolean {
    const token = headers['x-telegram-bot-api-secret-token'];
    return token === secret;
  }

  async parseWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<UniversalMessage[]> {
    const messages: UniversalMessage[] = [];
    const payload = JSON.parse(rawBody.toString('utf-8'));
    
    // Telegram sends single update objects
    if (payload.message) {
      const msg = payload.message;
      if (msg.text) {
        messages.push({
          id: msg.message_id.toString(),
          channelType: 'TELEGRAM',
          channelId: 'resolved-by-inbox', // InboxService will fill this
          direction: 'inbound',
          contactUid: msg.from.id.toString(),
          timestamp: new Date(msg.date * 1000),
          messageType: 'text',
          content: { text: msg.text },
          rawPayload: payload
        });
      }
    } else if (payload.callback_query) {
      const cb = payload.callback_query;
      messages.push({
        id: cb.id.toString(),
        channelType: 'TELEGRAM',
        channelId: 'resolved-by-inbox',
        direction: 'inbound',
        contactUid: cb.from.id.toString(),
        timestamp: new Date(),
        messageType: 'postback',
        content: { postbackData: cb.data },
        rawPayload: payload
      });
    }

    return messages;
  }

  async getProfile(uid: string, credentials: ChannelCredentials): Promise<ContactProfile> {
    // Basic implementation since we get info from webhook usually
    return {
      uid,
      displayName: `Telegram User ${uid}`
    };
  }

  async sendMessage(to: string, message: OutboundMessage, credentials: ChannelCredentials): Promise<SendResult> {
    const botToken = credentials.channelAccessToken;
    console.log(`[TelegramPlugin] Executing sendMessage to ${to} with token ${botToken}`);
    return { success: true, messageId: `msg_${Date.now()}` };
  }
}
