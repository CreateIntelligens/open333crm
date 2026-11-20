import { timingSafeEqual } from 'node:crypto';

import type {
  ChannelPlugin,
  ParsedWebhookMessage,
  OutboundPayload,
} from './index.js';
import { CHANNEL_TYPE } from '@open333crm/shared';

// Telegram Bot API base URL
const BASE_URL = 'https://api.telegram.org/bot';

export type TelegramApiOutcome = 'rejected' | 'unknown';
export type TelegramApiOperation = 'getMe' | 'getWebhookInfo' | 'setWebhook' | 'sendMessage';

export class TelegramApiError extends Error {
  constructor(
    readonly operation: TelegramApiOperation,
    readonly outcome: TelegramApiOutcome,
  ) {
    super(`Telegram ${operation} ${outcome === 'rejected' ? 'was rejected' : 'has an unknown result'}`);
    this.name = 'TelegramApiError';
  }
}

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramWebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  last_synchronization_error_date?: number;
  max_connections?: number;
  allowed_updates?: string[];
}


function isBotInfo(value: unknown): value is TelegramBotInfo {
  if (typeof value !== 'object' || value === null || !('id' in value) || !('is_bot' in value) || !('first_name' in value)) return false;
  return typeof value.id === 'number'
    && Number.isSafeInteger(value.id)
    && typeof value.is_bot === 'boolean'
    && typeof value.first_name === 'string'
    && (!('username' in value) || typeof value.username === 'string');
}

function isWebhookInfo(value: unknown): value is TelegramWebhookInfo {
  if (typeof value !== 'object' || value === null || !('url' in value) || !('has_custom_certificate' in value) || !('pending_update_count' in value)) return false;
  return typeof value.url === 'string'
    && typeof value.has_custom_certificate === 'boolean'
    && typeof value.pending_update_count === 'number'
    && Number.isInteger(value.pending_update_count);
}

export class TelegramPlugin implements ChannelPlugin {
  readonly channelType = CHANNEL_TYPE.TELEGRAM;

  // ─── Task 1.4: verifySignature ────────────────────────────────────
  verifySignature(
    _rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): boolean {
    const token = headers['x-telegram-bot-api-secret-token'];
    if (typeof token !== 'string' || !secret) return false;
    const actual = Buffer.from(token);
    const expected = Buffer.from(secret);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  async parseWebhook(
    rawBody: Buffer,
    _headers: Record<string, string>,
  ): Promise<ParsedWebhookMessage[]> {
    const update = JSON.parse(rawBody.toString()) as TelegramUpdate | null;
    const message = update?.message;
    if (!update || !message || message.chat?.type !== 'private') return [];
    if (typeof message.text !== 'string' || message.text.length === 0) return [];

    const senderId = message.from?.id;
    if (!Number.isSafeInteger(senderId) || !Number.isSafeInteger(message.chat.id)
      || !Number.isSafeInteger(update.update_id) || !Number.isSafeInteger(message.message_id)
      || !Number.isSafeInteger(message.date)) return [];

    const timestamp = new Date(message.date * 1000);
    if (Number.isNaN(timestamp.getTime())) return [];
    const externalId = String(senderId);
    const parsed = {
      providerEventId: String(update.update_id),
      channelMsgId: String(message.message_id),
      externalId,
      contactUid: externalId,
      replyDestination: String(message.chat.id),
      timestamp,
      contentType: 'text',
      content: { text: message.text },
    };
    return [parsed];
  }

  async getProfile(uid: string, credentials: Record<string, unknown>): Promise<{ uid: string; displayName: string; avatarUrl?: string }> {
    void credentials;
    return { uid, displayName: `Telegram User ${uid}` };
  }

  async sendMessage(
    to: string,
    message: OutboundPayload,
    credentials: Record<string, unknown>,
  ): Promise<{ success: boolean; outcome: 'accepted' | TelegramApiOutcome; channelMsgId?: string; error?: string }> {
    const text = message.content.text;
    if (!to || message.contentType !== 'text' || typeof text !== 'string' || !text.trim()) {
      return { success: false, outcome: 'rejected', error: 'Telegram requires a destination and non-empty text' };
    }

    try {
      const result = await this.callTelegram(
        'sendMessage',
        credentials,
        (value): value is { message_id: number } => typeof value === 'object' && value !== null
          && 'message_id' in value && Number.isSafeInteger(value.message_id),
        { chat_id: to, text },
      );
      return { success: true, outcome: 'accepted', channelMsgId: String(result.message_id) };
    } catch (error) {
      if (error instanceof TelegramApiError) {
        return { success: false, outcome: error.outcome, error: error.message };
      }
      return { success: false, outcome: 'unknown', error: 'Telegram sendMessage has an unknown result' };
    }
  }

  async getMe(credentials: Record<string, unknown>): Promise<TelegramBotInfo> {
    return this.callTelegram('getMe', credentials, isBotInfo);
  }

  async getWebhookInfo(credentials: Record<string, unknown>): Promise<TelegramWebhookInfo> {
    return this.callTelegram('getWebhookInfo', credentials, isWebhookInfo);
  }

  async setWebhook(webhookUrl: string, credentials: Record<string, unknown>): Promise<void> {
    const webhookSecret = credentials.webhookSecret;
    if (typeof webhookSecret !== 'string' || webhookSecret.length === 0) {
      throw new TelegramApiError('setWebhook', 'rejected');
    }

    await this.callTelegram(
      'setWebhook',
      credentials,
      (result): result is true => result === true,
      { url: webhookUrl, secret_token: webhookSecret, allowed_updates: ['message'] },
    );
  }

  private async callTelegram<T>(
    operation: TelegramApiOperation,
    credentials: Record<string, unknown>,
    isResult: (value: unknown) => value is T,
    body: Record<string, unknown> = {},
  ): Promise<T> {
    const botToken = credentials.botToken;
    if (typeof botToken !== 'string' || botToken.length === 0) {
      throw new TelegramApiError(operation, 'rejected');
    }

    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${botToken}/${operation}`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new TelegramApiError(operation, 'unknown');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new TelegramApiError(operation, 'unknown');
    }

    if (typeof payload !== 'object' || payload === null || !('ok' in payload)) {
      throw new TelegramApiError(operation, 'unknown');
    }
    if (payload.ok === false && response.status < 500) throw new TelegramApiError(operation, 'rejected');
    if (!response.ok || payload.ok !== true || !('result' in payload) || !isResult(payload.result)) {
      throw new TelegramApiError(operation, 'unknown');
    }

    return payload.result;
  }
}

// ── Internal Telegram types (minimal) ─────────────────────────────

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  from?: { id: number };
  chat: { id: number; type: string };
  date: number;
  text?: string;
}
