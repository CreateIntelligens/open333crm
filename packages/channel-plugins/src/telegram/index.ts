import { ChannelPlugin, ParsedWebhookMessage, OutboundPayload } from '../index.js';
import { logger } from '@open333crm/core';
import { CHANNEL_TYPE } from '@open333crm/shared';

export class TelegramPlugin implements ChannelPlugin {
  readonly channelType = CHANNEL_TYPE.TELEGRAM;

  verifySignature(rawBody: Buffer, headers: Record<string, string>, secret: string): boolean {
    const token = headers['x-telegram-bot-api-secret-token'];
    return token === secret;
  }

  async parseWebhook(rawBody: Buffer, _headers: Record<string, string>): Promise<ParsedWebhookMessage[]> {
    const messages: ParsedWebhookMessage[] = [];
    const payload = JSON.parse(rawBody.toString('utf-8'));

    if (payload.message?.text) {
      const msg = payload.message;
      messages.push({
        channelMsgId: String(msg.message_id),
        contactUid: String(msg.from.id),
        timestamp: new Date(msg.date * 1000),
        contentType: 'text',
        content: { text: msg.text },
        rawPayload: payload,
      });
    } else if (payload.callback_query) {
      const cb = payload.callback_query;
      messages.push({
        contactUid: String(cb.from.id),
        timestamp: new Date(),
        contentType: 'postback',
        content: { text: cb.data ?? '' },
        rawPayload: payload,
      });
    }

    return messages;
  }

  async getProfile(uid: string, _credentials: Record<string, unknown>): Promise<{ uid: string; displayName: string; avatarUrl?: string }> {
    return { uid, displayName: `Telegram User ${uid}` };
  }

  async sendMessage(to: string, message: OutboundPayload, credentials: Record<string, unknown>): Promise<{ success: boolean; channelMsgId?: string; error?: string }> {
    const botToken = credentials.channelAccessToken as string;
    logger.info(`[TelegramPlugin] Executing sendMessage to ${to} with token ${botToken}`);
    return { success: true, channelMsgId: `msg_${Date.now()}` };
  }
}

