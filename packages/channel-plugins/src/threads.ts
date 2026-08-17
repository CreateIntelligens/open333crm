// ThreadsPlugin — implements ChannelPlugin for Instagram Threads / DM
// Uses Instagram Graph API (same as FB Messenger for DMs)
// v0.2.0 multi-channel-billing

import type {
  ChannelPlugin,
  ParsedWebhookMessage,
  OutboundPayload,
} from './index.js';
import { createHmac } from 'node:crypto';
import { CHANNEL_TYPE } from '@open333crm/shared';

interface ThreadsCredentials {
  appId: string;
  appSecret: string;
  pageAccessToken: string;
  [key: string]: unknown;
}

const GRAPH_URL = 'https://graph.instagram.com/v21.0';

export class ThreadsPlugin implements ChannelPlugin {
  readonly channelType = CHANNEL_TYPE.THREADS;

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

  async parseWebhook(
    rawBody: Buffer,
    _headers: Record<string, string>,
  ): Promise<ParsedWebhookMessage[]> {
    const payload = JSON.parse(rawBody.toString()) as InstagramWebhookPayload;
    const messages: ParsedWebhookMessage[] = [];

    for (const entry of payload.entry ?? []) {
      for (const messaging of entry.messaging ?? []) {
        // 非訊息事件（read 已讀回條、reaction、echo 等）沒有 sender，跳過避免 TypeError
        if (!messaging?.sender?.id) continue;
        const contactUid = messaging.sender.id;
        const timestamp = new Date(messaging.timestamp);
        // IG 訊息 id（mid），供 inbound 管線去重（Meta 可能重送同一事件）
        const channelMsgId = messaging.message?.mid;

        if (messaging.message?.reply_to?.story) {
          messages.push({ channelMsgId, contactUid, timestamp, contentType: 'text', content: { text: `[Story reply] ${messaging.message.text ?? ''}` }, rawPayload: messaging });
          continue;
        }
        if (messaging.message?.attachments?.some((a) => a.type === 'like_heart')) {
          messages.push({ channelMsgId, contactUid, timestamp, contentType: 'sticker', content: { text: '❤️' }, rawPayload: messaging });
          continue;
        }
        if (messaging.message?.attachments?.some((a) => a.type === 'image')) {
          const img = messaging.message.attachments.find((a) => a.type === 'image');
          messages.push({ channelMsgId, contactUid, timestamp, contentType: 'image', content: { mediaUrl: img?.payload?.url }, rawPayload: messaging });
          continue;
        }
        if (messaging.message?.text) {
          messages.push({ channelMsgId, contactUid, timestamp, contentType: 'text', content: { text: messaging.message.text }, rawPayload: messaging });
          continue;
        }
        messages.push({ channelMsgId, contactUid, timestamp, contentType: 'unknown', content: {}, rawPayload: messaging });
      }
    }

    return messages;
  }

  async getProfile(uid: string, credentials: Record<string, unknown>): Promise<{ uid: string; displayName: string; avatarUrl?: string }> {
    const creds = credentials as ThreadsCredentials;
    try {
      const res = await fetch(`${GRAPH_URL}/${uid}?fields=name,profile_pic&access_token=${creds.pageAccessToken}`);
      const data = await res.json() as { name?: string; profile_pic?: string };
      return { uid, displayName: data.name ?? `Instagram User ${uid}`, avatarUrl: data.profile_pic };
    } catch {
      return { uid, displayName: `Instagram User ${uid}` };
    }
  }

  async sendMessage(
    to: string,
    message: OutboundPayload,
    credentials: Record<string, unknown>,
  ): Promise<{ success: boolean; channelMsgId?: string; error?: string }> {
    const creds = credentials as ThreadsCredentials;
    const { content } = message;
    const quickReplies = content.quickReplies as Array<{ label: string; text?: string; postbackData?: string }> | undefined;
    // 圖片 URL（send-image 出口帶 mediaUrl；相容 content.url）
    const imageUrl = (content.mediaUrl ?? content.url) as string | undefined;

    try {
      let body: Record<string, unknown>;

      if (message.contentType === 'image' && imageUrl) {
        // IG 發圖：attachment image（同 FB 格式），限 PNG/JPEG、8MB
        body = {
          recipient: { id: to },
          message: { attachment: { type: 'image', payload: { url: imageUrl } } },
        };
      } else if (quickReplies?.length) {
        body = {
          recipient: { id: to },
          message: {
            text: content.text ?? '請選擇：',
            quick_replies: quickReplies.map((r) => ({
              content_type: 'text',
              title: r.label,
              payload: r.postbackData ?? r.text ?? r.label,
            })),
          },
        };
      } else {
        body = { recipient: { id: to }, message: { text: content.text ?? '' } };
      }

      const res = await fetch(`${GRAPH_URL}/me/messages?access_token=${creds.pageAccessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await res.json() as { message_id?: string; error?: { message: string } };
      if (result.error) return { success: false, error: result.error.message };
      return { success: true, channelMsgId: result.message_id };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
  // Note: Threads/Instagram does not support auto-setWebhook (manual webhook setup required)
}

// 對齊 fbPlugin / linePlugin：export 一個可註冊的 plugin 實例
export const threadsPlugin = new ThreadsPlugin();

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
