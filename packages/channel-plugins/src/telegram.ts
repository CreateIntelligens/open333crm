// TelegramPlugin — implements ChannelPlugin for Telegram Bot API
// v0.2.0 multi-channel-billing

import type {
  ChannelPlugin,
  ChannelCredentials,
  OutboundMessage,
  SendResult,
} from './index.js';
import type { UniversalMessage, ContactProfile } from '@open333crm/types';

interface TelegramCredentials extends ChannelCredentials {
  botToken: string;
  webhookSecret: string;
}

// Telegram Bot API base URL
const BASE_URL = 'https://api.telegram.org/bot';

export class TelegramPlugin implements ChannelPlugin {
  readonly channelType = 'TELEGRAM' as const;

  // ─── Task 1.4: verifySignature ────────────────────────────────────
  verifySignature(
    _rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): boolean {
    const token = headers['x-telegram-bot-api-secret-token'];
    return token === secret;
  }

  // ─── Task 1.6: parseWebhook ───────────────────────────────────────
  async parseWebhook(
    rawBody: Buffer,
    _headers: Record<string, string>,
  ): Promise<UniversalMessage[]> {
    const update = JSON.parse(rawBody.toString()) as TelegramUpdate;
    const msg = update.message ?? update.callback_query?.message;
    if (!msg) return [];

    const base: Omit<UniversalMessage, 'messageType' | 'content'> = {
      id:          crypto.randomUUID(),
      channelType: 'TELEGRAM',
      channelId:   '',  // filled by webhook router from URL param
      direction:   'inbound',
      contactUid:  String(update.message?.from?.id ?? update.callback_query?.from?.id ?? ''),
      timestamp:   new Date((msg.date ?? Date.now() / 1000) * 1000),
      rawPayload:  update,
    };

    // Callback query (button postback)
    if (update.callback_query) {
      return [{
        ...base,
        contactUid:  String(update.callback_query.from.id),
        messageType: 'postback',
        content:     { postbackData: update.callback_query.data },
      }];
    }

    const message = update.message!;

    // Text
    if (message.text) {
      return [{ ...base, messageType: 'text', content: { text: message.text } }];
    }
    // Photo
    if (message.photo) {
      const largest = message.photo[message.photo.length - 1];
      return [{ ...base, messageType: 'image', content: { mediaUrl: `file_id:${largest.file_id}` } }];
    }
    // Sticker
    if (message.sticker) {
      return [{ ...base, messageType: 'sticker', content: { text: message.sticker.emoji } }];
    }
    // Location
    if (message.location) {
      return [{
        ...base,
        messageType: 'location',
        content: {
          text: `${message.location.latitude},${message.location.longitude}`,
        },
      }];
    }

    return [{ ...base, messageType: 'unknown', content: {} }];
  }

  // ─── Task 1.8: getProfile ────────────────────────────────────────
  async getProfile(uid: string, credentials: ChannelCredentials): Promise<ContactProfile> {
    const creds = credentials as TelegramCredentials;
    // Telegram doesn't have a direct "get user by id" endpoint without interaction
    // We return a minimal profile; real profile data comes from webhook events
    return {
      uid,
      displayName: `Telegram User ${uid}`,
      pictureUrl:  undefined,
    };
    void creds; // suppress unused warning
  }

  // ─── Task 1.9: sendMessage ───────────────────────────────────────
  async sendMessage(
    to: string,
    message: OutboundMessage,
    credentials: ChannelCredentials,
  ): Promise<SendResult> {
    const creds = credentials as TelegramCredentials;
    const apiUrl = `${BASE_URL}${creds.botToken}`;

    try {
      let response: Response;

      if (message.type === 'text' && !message.quickReplies?.length) {
        // Plain text
        response = await fetch(`${apiUrl}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: to, text: message.text }),
        });
      } else if (message.type === 'text' && message.quickReplies?.length) {
        // Text with inline keyboard
        const inline_keyboard = [message.quickReplies.map((r) => ({
          text: r.label,
          callback_data: r.postbackData ?? r.text ?? r.label,
        }))];
        response = await fetch(`${apiUrl}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: to,
            text: message.text ?? '請選擇：',
            reply_markup: { inline_keyboard },
          }),
        });
      } else {
        // Fallback to plain text
        response = await fetch(`${apiUrl}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: to, text: message.text ?? '' }),
        });
      }

      const result = await response.json() as { ok: boolean; result?: { message_id: number }; description?: string };
      if (!result.ok) return { success: false, error: result.description };
      return { success: true, messageId: String(result.result?.message_id) };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  // ─── Task 1.9: setWebhook ────────────────────────────────────────
  async setWebhook(webhookUrl: string, credentials: ChannelCredentials): Promise<void> {
    const creds = credentials as TelegramCredentials;
    const apiUrl = `${BASE_URL}${creds.botToken}`;
    await fetch(`${apiUrl}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: creds.webhookSecret,
        allowed_updates: ['message', 'callback_query'],
      }),
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
