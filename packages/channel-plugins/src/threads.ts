// ThreadsPlugin — implements ChannelPlugin for Instagram Threads / DM
// Uses Instagram Graph API (same as FB Messenger for DMs)
// v0.2.0 multi-channel-billing

import type {
  ChannelPlugin,
  ChannelCredentials,
  OutboundMessage,
  SendResult,
} from './index.js';
import type { UniversalMessage, ContactProfile } from '@open333crm/types';
import { createHmac } from 'node:crypto';

interface ThreadsCredentials extends ChannelCredentials {
  appId: string;
  appSecret: string;
  pageAccessToken: string;
}

const GRAPH_URL = 'https://graph.instagram.com/v21.0';

export class ThreadsPlugin implements ChannelPlugin {
  readonly channelType = 'THREADS' as const;

  // ─── Task 1.5: verifySignature ────────────────────────────────────
  // Instagram uses X-Hub-Signature-256: sha256=<hmac>
  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): boolean {
    const sig = headers['x-hub-signature-256'];
    if (!sig) return false;
    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
    return sig === expected;
  }

  // ─── Task 1.7: parseWebhook ───────────────────────────────────────
  async parseWebhook(
    rawBody: Buffer,
    _headers: Record<string, string>,
  ): Promise<UniversalMessage[]> {
    const payload = JSON.parse(rawBody.toString()) as InstagramWebhookPayload;
    const messages: UniversalMessage[] = [];

    for (const entry of payload.entry ?? []) {
      for (const messaging of entry.messaging ?? []) {
        const base: Omit<UniversalMessage, 'messageType' | 'content'> = {
          id:          crypto.randomUUID(),
          channelType: 'THREADS',
          channelId:   '',
          direction:   'inbound',
          contactUid:  messaging.sender.id,
          timestamp:   new Date(messaging.timestamp),
          rawPayload:  messaging,
        };

        // Story reply
        if (messaging.message?.reply_to?.story) {
          messages.push({
            ...base,
            messageType: 'text',
            content: {
              text: `[Story reply] ${messaging.message.text ?? ''}`,
            },
          });
          continue;
        }

        // Like / Heart reaction
        if (messaging.message?.attachments?.some((a) => a.type === 'like_heart')) {
          messages.push({ ...base, messageType: 'sticker', content: { text: '❤️' } });
          continue;
        }

        // Image attachment
        if (messaging.message?.attachments?.some((a) => a.type === 'image')) {
          const img = messaging.message.attachments.find((a) => a.type === 'image');
          messages.push({
            ...base,
            messageType: 'image',
            content: { mediaUrl: img?.payload?.url },
          });
          continue;
        }

        // Text
        if (messaging.message?.text) {
          messages.push({
            ...base,
            messageType: 'text',
            content: { text: messaging.message.text },
          });
          continue;
        }

        messages.push({ ...base, messageType: 'unknown', content: {} });
      }
    }

    return messages;
  }

  // ─── Task 1.8: getProfile ────────────────────────────────────────
  async getProfile(uid: string, credentials: ChannelCredentials): Promise<ContactProfile> {
    const creds = credentials as ThreadsCredentials;
    try {
      const res = await fetch(
        `${GRAPH_URL}/${uid}?fields=name,profile_pic&access_token=${creds.pageAccessToken}`,
      );
      const data = await res.json() as { name?: string; profile_pic?: string };
      return {
        uid,
        displayName: data.name ?? `Instagram User ${uid}`,
        pictureUrl:  data.profile_pic,
      };
    } catch {
      return { uid, displayName: `Instagram User ${uid}` };
    }
  }

  // ─── Task 1.9: sendMessage ───────────────────────────────────────
  async sendMessage(
    to: string,
    message: OutboundMessage,
    credentials: ChannelCredentials,
  ): Promise<SendResult> {
    const creds = credentials as ThreadsCredentials;

    try {
      let body: Record<string, unknown>;

      if (message.type === 'text' && message.quickReplies?.length) {
        body = {
          recipient:  { id: to },
          message: {
            text:          message.text ?? '請選擇：',
            quick_replies: message.quickReplies.map((r) => ({
              content_type: 'text',
              title:        r.label,
              payload:      r.postbackData ?? r.text ?? r.label,
            })),
          },
        };
      } else {
        body = {
          recipient: { id: to },
          message:   { text: message.text ?? '' },
        };
      }

      const res = await fetch(
        `${GRAPH_URL}/me/messages?access_token=${creds.pageAccessToken}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        },
      );

      const result = await res.json() as { message_id?: string; error?: { message: string } };
      if (result.error) return { success: false, error: result.error.message };
      return { success: true, messageId: result.message_id };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
  // Note: Threads/Instagram does not support auto-setWebhook (manual webhook setup required)
}

// ── Internal Instagram Webhook types (minimal) ─────────────────────

interface InstagramWebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    time: number;
    messaging?: InstagramMessaging[];
  }>;
}

interface InstagramMessaging {
  sender:    { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid?:   string;
    text?:  string;
    reply_to?: { story?: { url: string; id: string } };
    attachments?: Array<{
      type:    string;
      payload?: { url?: string };
    }>;
  };
}
