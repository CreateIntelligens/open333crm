// TelegramPlugin — implements ChannelPlugin for Telegram Bot API
// v0.2.0 multi-channel-billing

import type {
  ChannelPlugin,
  ParsedWebhookMessage,
  OutboundPayload,
} from './index.js';
import { CHANNEL_TYPE } from '@open333crm/shared';

interface TelegramCredentials {
  botToken: string;
  webhookSecret: string;
  [key: string]: unknown;
}

// Telegram Bot API base URL
const BASE_URL = 'https://api.telegram.org/bot';

export class TelegramPlugin implements ChannelPlugin {
  readonly channelType = CHANNEL_TYPE.TELEGRAM;

  // ─── Task 1.4: verifySignature ────────────────────────────────────
  verifySignature(
    _rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): boolean {
    const token = headers['x-telegram-bot-api-secret-token'];
    return token === secret;
  }

  async parseWebhook(
    rawBody: Buffer,
    _headers: Record<string, string>,
  ): Promise<ParsedWebhookMessage[]> {
    const update = JSON.parse(rawBody.toString()) as TelegramUpdate;
    const msg = update.message ?? update.callback_query?.message;
    if (!msg) return [];

    const contactUid = String(update.message?.from?.id ?? update.callback_query?.from?.id ?? '');
    const timestamp = new Date((msg.date ?? Date.now() / 1000) * 1000);

    // Callback query (button postback)
    if (update.callback_query) {
      return [{
        contactUid: String(update.callback_query.from.id),
        timestamp,
        contentType: 'postback',
        content: { text: update.callback_query.data ?? '' },
        rawPayload: update,
      }];
    }

    const message = update.message!;

    if (message.text) {
      return [{ contactUid, timestamp, contentType: 'text', content: { text: message.text }, rawPayload: update }];
    }
    if (message.photo) {
      const largest = message.photo[message.photo.length - 1];
      return [{ contactUid, timestamp, contentType: 'image', content: { mediaUrl: `file_id:${largest.file_id}` }, rawPayload: update }];
    }
    if (message.sticker) {
      return [{ contactUid, timestamp, contentType: 'sticker', content: { text: message.sticker.emoji ?? '[sticker]' }, rawPayload: update }];
    }
    if (message.location) {
      return [{ contactUid, timestamp, contentType: 'location', content: { text: `${message.location.latitude},${message.location.longitude}` }, rawPayload: update }];
    }

    return [{ contactUid, timestamp, contentType: 'unknown', content: {}, rawPayload: update }];
  }

  async getProfile(uid: string, credentials: Record<string, unknown>): Promise<{ uid: string; displayName: string; avatarUrl?: string }> {
    void credentials;
    return { uid, displayName: `Telegram User ${uid}` };
  }

  async sendMessage(
    to: string,
    message: OutboundPayload,
    credentials: Record<string, unknown>,
  ): Promise<{ success: boolean; channelMsgId?: string; error?: string }> {
    const creds = credentials as TelegramCredentials;
    const apiUrl = `${BASE_URL}${creds.botToken}`;
    const { contentType, content } = message;
    const quickReplies = content.quickReplies as Array<{ label: string; text?: string; postbackData?: string }> | undefined;

    try {
      let response: Response;

      if (contentType === 'text' && quickReplies?.length) {
        const inline_keyboard = [quickReplies.map((r) => ({
          text: r.label,
          callback_data: r.postbackData ?? r.text ?? r.label,
        }))];
        response = await fetch(`${apiUrl}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: to, text: content.text ?? '請選擇：', reply_markup: { inline_keyboard } }),
        });
      } else {
        response = await fetch(`${apiUrl}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: to, text: content.text ?? '' }),
        });
      }

      const result = await response.json() as { ok: boolean; result?: { message_id: number }; description?: string };
      if (!result.ok) return { success: false, error: result.description };
      return { success: true, channelMsgId: String(result.result?.message_id) };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async setWebhook(webhookUrl: string, credentials: Record<string, unknown>): Promise<void> {
    const creds = credentials as TelegramCredentials;
    const apiUrl = `${BASE_URL}${creds.botToken}`;
    await fetch(`${apiUrl}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl, secret_token: creds.webhookSecret, allowed_updates: ['message', 'callback_query'] }),
    });
  }
}

// ── Internal Telegram types (minimal) ─────────────────────────────

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data?: string;
  };
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number };
  date: number;
  text?: string;
  photo?: Array<{ file_id: string; width: number; height: number }>;
  sticker?: { file_id: string; emoji?: string };
  location?: { latitude: number; longitude: number };
}

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}
