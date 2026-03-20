// LinePlugin — implements ChannelPlugin for LINE Official Account
// Covers: Messaging API, Rich Menu API, Insight API, LIFF, Account Link
// ref: docs/03_CHANNEL_PLUGINS/LINE_OA.md

import * as crypto from 'node:crypto';
import type {
  ChannelPlugin,
  ChannelCredentials,
  ChannelUiExtension,
  ChannelAudienceExtension,
  ChannelAnalyticsExtension,
  OutboundMessage,
  SendResult,
} from '../index.js';
import type { UniversalMessage, ContactProfile } from '@open333crm/types';

// ─────────────────────────────────────────────────────────────────
// Credentials
// ─────────────────────────────────────────────────────────────────

// Note: We don't extend ChannelCredentials (which requires [key:string]:string index) to allow optional fields
export interface LineChannelCredentials {
  channelId: string;
  channelSecret: string;
  channelAccessToken: string;
  loginChannelId?: string;
  loginChannelSecret?: string;
  [key: string]: string | undefined;
}

// ─────────────────────────────────────────────────────────────────
// LINE API base URL helpers
// ─────────────────────────────────────────────────────────────────

const API = 'https://api.line.me';
const LIFF_API = 'https://api.line.me/liff/v1';

function lineHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function linePost(path: string, token: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: lineHeaders(token),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`LINE API POST ${path} failed: ${JSON.stringify(data)}`);
  return data;
}

async function lineGet(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method: 'GET',
    headers: lineHeaders(token),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`LINE API GET ${path} failed: ${JSON.stringify(data)}`);
  return data;
}

async function lineDelete(path: string, token: string): Promise<void> {
  const res = await fetch(`${API}${path}`, {
    method: 'DELETE',
    headers: lineHeaders(token),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`LINE API DELETE ${path} failed: ${JSON.stringify(data)}`);
  }
}

async function linePut(path: string, token: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method: 'PUT',
    headers: lineHeaders(token),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`LINE API PUT ${path} failed: ${JSON.stringify(data)}`);
  return data;
}

// ─────────────────────────────────────────────────────────────────
// Build LINE outbound message objects
// ─────────────────────────────────────────────────────────────────

function buildLineMessage(msg: OutboundMessage): unknown {
  const quickReply = msg.quickReplies?.length
    ? {
        items: msg.quickReplies.map((r) => ({
          type: 'action',
          ...(r.imageUrl ? { imageUrl: r.imageUrl } : {}),
          action: r.postbackData
            ? { type: 'postback', label: r.label, data: r.postbackData, displayText: r.text }
            : { type: 'message', label: r.label, text: r.text ?? r.label },
        })),
      }
    : undefined;

  const base = quickReply ? { quickReply } : {};

  switch (msg.type) {
    case 'text':
      return { type: 'text', text: msg.text ?? '', ...base };
    case 'image':
      return {
        type: 'image',
        originalContentUrl: msg.mediaUrl,
        previewImageUrl: msg.previewUrl ?? msg.mediaUrl,
        ...base,
      };
    case 'video':
      return {
        type: 'video',
        originalContentUrl: msg.mediaUrl,
        previewImageUrl: msg.previewUrl ?? msg.mediaUrl,
        ...(msg.trackingId ? { trackingId: msg.trackingId } : {}),
        ...base,
      };
    case 'audio':
      return { type: 'audio', originalContentUrl: msg.mediaUrl, duration: 0, ...base };
    case 'location':
      return {
        type: 'location',
        title: msg.text ?? 'Location',
        address: msg.address ?? '',
        latitude: msg.latitude ?? 0,
        longitude: msg.longitude ?? 0,
        ...base,
      };
    case 'sticker':
      return { type: 'sticker', packageId: msg.packageId ?? '1', stickerId: msg.stickerId ?? '1', ...base };
    case 'flex':
      return { type: 'flex', altText: msg.text ?? 'Message', contents: msg.flexJson, ...base };
    case 'imagemap':
      return { ...msg.imagemapJson, type: 'imagemap', ...base };
    case 'template':
      return { type: 'template', altText: msg.text ?? 'Message', template: msg.templateJson, ...base };
    default:
      return { type: 'text', text: msg.text ?? '', ...base };
  }
}

// ─────────────────────────────────────────────────────────────────
// LinePlugin
// ─────────────────────────────────────────────────────────────────

export class LinePlugin implements ChannelPlugin {
  readonly channelType = 'LINE' as const;

  // ─── Task 2.1: verifySignature ───────────────────────────────────
  verifySignature(rawBody: Buffer, headers: Record<string, string>, secret: string): boolean {
    const signature = headers['x-line-signature'];
    if (!signature) return false;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(rawBody);
    const digest = hmac.digest('base64');
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  }

  // ─── Task 2.2: parseWebhook ─────────────────────────────────────
  async parseWebhook(rawBody: Buffer, _headers: Record<string, string>): Promise<UniversalMessage[]> {
    const payload = JSON.parse(rawBody.toString()) as LineWebhookPayload;
    const results: UniversalMessage[] = [];

    for (const event of payload.events ?? []) {
      const base: Omit<UniversalMessage, 'messageType' | 'content'> = {
        id: crypto.randomUUID(),
        channelType: 'LINE',
        channelId: '',           // filled by webhook router from URL :channelId param
        direction: 'inbound',
        contactUid: event.source?.userId ?? event.source?.groupId ?? '',
        timestamp: new Date(event.timestamp),
        rawPayload: event,
      };

      switch (event.type) {
        case 'message': {
          const m = event.message!;
          switch (m.type) {
            case 'text':
              results.push({ ...base, messageType: 'text', content: { text: m.text } });
              break;
            case 'image':
            case 'video':
            case 'audio':
            case 'file':
              // mediaUrl will be resolved by media-download BullMQ worker (Task 3.x)
              results.push({ ...base, messageType: m.type as UniversalMessage['messageType'], content: { mediaUrl: `line-content:${m.id}` } });
              break;
            case 'location':
              results.push({ ...base, messageType: 'location', content: { text: `${m.latitude},${m.longitude}`, templateData: { address: m.address, title: m.title } } });
              break;
            case 'sticker':
              results.push({ ...base, messageType: 'sticker', content: { templateData: { packageId: m.packageId, stickerId: m.stickerId } } });
              break;
            default:
              results.push({ ...base, messageType: 'unknown', content: {} });
          }
          break;
        }

        case 'postback':
          results.push({ ...base, messageType: 'postback', content: { postbackData: event.postback?.data } });
          break;

        // Tasks 2.3, 2.5, 2.6 — system events (returned as synthetic messages for event bus)
        case 'follow':
          results.push({ ...base, messageType: 'unknown', content: { templateData: { systemEvent: 'follow' } } });
          break;
        case 'unfollow':
          results.push({ ...base, messageType: 'unknown', content: { templateData: { systemEvent: 'unfollow' } } });
          break;
        case 'join':
          results.push({ ...base, messageType: 'unknown', content: { templateData: { systemEvent: 'join' } } });
          break;
        case 'leave':
          results.push({ ...base, messageType: 'unknown', content: { templateData: { systemEvent: 'leave' } } });
          break;
        case 'memberJoined':
          results.push({ ...base, messageType: 'unknown', content: { templateData: { systemEvent: 'memberJoined', members: event.joined?.members } } });
          break;
        case 'memberLeft':
          results.push({ ...base, messageType: 'unknown', content: { templateData: { systemEvent: 'memberLeft', members: event.left?.members } } });
          break;
        case 'unsend':
          // Task 2.4: mark message recalled — embed original messageId for downstream handler
          results.push({ ...base, messageType: 'unknown', content: { templateData: { systemEvent: 'unsend', originalMessageId: event.unsend?.messageId } } });
          break;
        case 'videoPlayComplete':
          // Task 2.5: Automation trigger
          results.push({ ...base, messageType: 'unknown', content: { templateData: { systemEvent: 'videoPlayComplete', trackingId: event.videoPlayComplete?.trackingId } } });
          break;
        case 'accountLink':
          results.push({ ...base, messageType: 'unknown', content: { templateData: { systemEvent: 'accountLink', result: event.link?.result, nonce: event.link?.nonce } } });
          break;
        case 'beacon':
          results.push({ ...base, messageType: 'unknown', content: { templateData: { systemEvent: 'beacon', hwid: event.beacon?.hwid, beaconType: event.beacon?.type } } });
          break;
        default:
          // Ignore unknown event types gracefully
          break;
      }
    }

    return results;
  }

  // ─── Task 10.4: getProfile ──────────────────────────────────────
  async getProfile(uid: string, credentials: ChannelCredentials): Promise<ContactProfile> {
    const creds = credentials as LineChannelCredentials;
    const data = await lineGet(`/v2/bot/profile/${uid}`, creds.channelAccessToken) as Record<string, string>;
    return {
      uid: data.userId,
      displayName: data.displayName,
      pictureUrl: data.pictureUrl,
      language: data.language,
    };
  }

  // ─── Tasks 4.1–4.5: sendMessage ─────────────────────────────────
  async sendMessage(to: string, message: OutboundMessage, credentials: ChannelCredentials): Promise<SendResult> {
    const creds = credentials as LineChannelCredentials;
    const token = creds.channelAccessToken;
    const lineMsg = buildLineMessage(message);
    const messages = [lineMsg];
    const strategy = message.strategy ?? 'push';

    try {
      switch (strategy) {
        case 'reply':
          await linePost('/v2/bot/message/reply', token, { replyToken: message.replyToken, messages });
          break;
        case 'push':
          await linePost('/v2/bot/message/push', token, { to, messages });
          break;
        case 'multicast': {
          // Task 4.4: batch into chunks of 500
          const uids = message.recipientUids ?? [to];
          for (let i = 0; i < uids.length; i += 500) {
            await linePost('/v2/bot/message/multicast', token, { to: uids.slice(i, i + 500), messages });
          }
          break;
        }
        case 'broadcast':
          await linePost('/v2/bot/message/broadcast', token, { messages });
          break;
        case 'narrowcast':
          await linePost('/v2/bot/message/narrowcast', token, {
            messages,
            ...(message.audienceGroupId
              ? { recipient: { type: 'audienceGroup', audienceGroupId: Number(message.audienceGroupId) } }
              : {}),
          });
          break;
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  // ─── Task 10.3: setWebhook ──────────────────────────────────────
  async setWebhook(webhookUrl: string, credentials: ChannelCredentials): Promise<void> {
    const creds = credentials as LineChannelCredentials;
    await linePut('/v2/bot/channel/webhook/endpoint', creds.channelAccessToken, { webhook: webhookUrl });
  }

  // ─── Extensions ─────────────────────────────────────────────────
  readonly extensions = {
    // Tasks 5.1–5.6: Rich Menu Extension
    ui: richMenuExtension,
    // Tasks 6.1–6.4: Audience Extension
    audience: audienceExtension,
    // Tasks 7.1–7.3: Analytics Extension
    analytics: analyticsExtension,
  };
}

// ─────────────────────────────────────────────────────────────────
// Rich Menu Extension  (Task 5.x)
// ─────────────────────────────────────────────────────────────────

const richMenuExtension: ChannelUiExtension = {
  async upsertMenu(menuConfig, credentials) {
    const creds = credentials as LineChannelCredentials;
    const data = await linePost('/v2/bot/richmenu', creds.channelAccessToken, menuConfig) as { richMenuId: string };
    return data.richMenuId;
  },
  async getMenu(menuId, credentials) {
    const creds = credentials as LineChannelCredentials;
    return lineGet(`/v2/bot/richmenu/${menuId}`, creds.channelAccessToken);
  },
  async listMenus(credentials) {
    const creds = credentials as LineChannelCredentials;
    const data = await lineGet('/v2/bot/richmenu/list', creds.channelAccessToken) as { richmenus: unknown[] };
    return data.richmenus;
  },
  async deleteMenu(menuId, credentials) {
    const creds = credentials as LineChannelCredentials;
    await lineDelete(`/v2/bot/richmenu/${menuId}`, creds.channelAccessToken);
  },
  async setDefaultMenu(menuId, credentials) {
    const creds = credentials as LineChannelCredentials;
    await linePost(`/v2/bot/user/all/richmenu/${menuId}`, creds.channelAccessToken, {});
  },
  async cancelDefaultMenu(credentials) {
    const creds = credentials as LineChannelCredentials;
    await lineDelete('/v2/bot/user/all/richmenu', creds.channelAccessToken);
  },
  async linkMenuToUser(uid, menuId, credentials) {
    const creds = credentials as LineChannelCredentials;
    await linePost(`/v2/bot/user/${uid}/richmenu/${menuId}`, creds.channelAccessToken, {});
  },
  async unlinkMenuFromUser(uid, credentials) {
    const creds = credentials as LineChannelCredentials;
    await lineDelete(`/v2/bot/user/${uid}/richmenu`, creds.channelAccessToken);
  },
  async linkMenuToUsers(uids, menuId, credentials) {
    // Task 5.5: Batch rate limited — caller must enqueue via rich-menu-batch queue
    const creds = credentials as LineChannelCredentials;
    for (let i = 0; i < uids.length; i += 500) {
      await linePost('/v2/bot/richmenu/bulk/link', creds.channelAccessToken, {
        richMenuId: menuId,
        userIds: uids.slice(i, i + 500),
      });
    }
  },
  async unlinkMenuFromUsers(uids, credentials) {
    const creds = credentials as LineChannelCredentials;
    for (let i = 0; i < uids.length; i += 500) {
      await linePost('/v2/bot/richmenu/bulk/unlink', creds.channelAccessToken, {
        userIds: uids.slice(i, i + 500),
      });
    }
  },
  async getUserMenu(uid, credentials) {
    const creds = credentials as LineChannelCredentials;
    try {
      const data = await lineGet(`/v2/bot/user/${uid}/richmenu`, creds.channelAccessToken) as { richMenuId: string };
      return data.richMenuId;
    } catch {
      return null;
    }
  },
  async uploadMenuImage(menuId, imageBuffer, contentType, credentials) {
    const creds = credentials as LineChannelCredentials;
    const res = await fetch(`${API}/v2/bot/richmenu/${menuId}/content`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.channelAccessToken}`,
        'Content-Type': contentType,
      },
      body: imageBuffer,
    });
    if (!res.ok) throw new Error(`Upload Rich Menu image failed: ${res.status}`);
  },
  async createMenuAlias(aliasId, menuId, credentials) {
    const creds = credentials as LineChannelCredentials;
    await linePost('/v2/bot/richmenu/alias', creds.channelAccessToken, { richMenuAliasId: aliasId, richMenuId: menuId });
  },
  async updateMenuAlias(aliasId, menuId, credentials) {
    const creds = credentials as LineChannelCredentials;
    await linePut(`/v2/bot/richmenu/alias/${aliasId}`, creds.channelAccessToken, { richMenuId: menuId });
  },
  async deleteMenuAlias(aliasId, credentials) {
    const creds = credentials as LineChannelCredentials;
    await lineDelete(`/v2/bot/richmenu/alias/${aliasId}`, creds.channelAccessToken);
  },
};

// ─────────────────────────────────────────────────────────────────
// Audience Extension  (Task 6.x)
// ─────────────────────────────────────────────────────────────────

const audienceExtension: ChannelAudienceExtension = {
  async syncAudience(_audienceId, uids, credentials) {
    const creds = credentials as LineChannelCredentials;
    const audiences = uids.map((u) => ({ id: u }));
    const data = await linePost('/v2/bot/audienceGroup/upload', creds.channelAccessToken, {
      description: `Segment sync ${Date.now()}`,
      audiences,
    }) as { audienceGroupId: number };
    return String(data.audienceGroupId);
  },
  async createInteractionAudience(requestId, type, credentials) {
    const creds = credentials as LineChannelCredentials;
    const endpoint = type === 'click' ? '/v2/bot/audienceGroup/click' : '/v2/bot/audienceGroup/impression';
    const data = await linePost(endpoint, creds.channelAccessToken, {
      description: `Interaction audience ${requestId}`,
      requestId,
    }) as { audienceGroupId: number };
    return String(data.audienceGroupId);
  },
  async addUsersToAudience(audienceGroupId, uids, credentials) {
    const creds = credentials as LineChannelCredentials;
    await linePost(`/v2/bot/audienceGroup/${audienceGroupId}/users`, creds.channelAccessToken, {
      audiences: uids.map((id) => ({ id })),
    });
  },
  async deleteAudience(audienceGroupId, credentials) {
    const creds = credentials as LineChannelCredentials;
    await lineDelete(`/v2/bot/audienceGroup/${audienceGroupId}`, creds.channelAccessToken);
  },
  async getNarrowcastProgress(requestId, credentials) {
    const creds = credentials as LineChannelCredentials;
    const data = await lineGet(`/v2/bot/message/progress/narrowcast?requestId=${requestId}`, creds.channelAccessToken) as Record<string, unknown>;
    return {
      phase: String(data.phase ?? 'unknown'),
      successCount: typeof data.successCount === 'number' ? data.successCount : undefined,
      errorCount: typeof data.errorCount === 'number' ? data.errorCount : undefined,
    };
  },
  async cancelNarrowcast(requestId, credentials) {
    const creds = credentials as LineChannelCredentials;
    await lineDelete(`/v2/bot/message/narrowcast?requestId=${requestId}`, creds.channelAccessToken);
  },
};

// ─────────────────────────────────────────────────────────────────
// Analytics Extension  (Task 7.x)
// ─────────────────────────────────────────────────────────────────

const analyticsExtension: ChannelAnalyticsExtension = {
  async getFollowerStats(date, credentials) {
    const creds = credentials as LineChannelCredentials;
    const data = await lineGet(`/v2/bot/insight/followers?date=${date}`, creds.channelAccessToken) as Record<string, number>;
    return {
      followers: data.followers ?? 0,
      blocks: data.blocks ?? 0,
      targetedReaches: data.targetedReaches,
    };
  },
  async getDemographics(credentials) {
    const creds = credentials as LineChannelCredentials;
    return lineGet('/v2/bot/insight/demographic', creds.channelAccessToken);
  },
  async getDeliveryStats(requestId, credentials) {
    const creds = credentials as LineChannelCredentials;
    const data = await lineGet(`/v2/bot/insight/message/event?requestId=${requestId}`, creds.channelAccessToken) as Record<string, unknown>;
    const overview = (data.overview as Record<string, number>) ?? {};
    return {
      delivered: overview.delivered,
      read: overview.uniqueImpression,
      clicked: overview.uniqueClick,
    };
  },
  async getMessageQuota(credentials) {
    const creds = credentials as LineChannelCredentials;
    const quota = await lineGet('/v2/bot/message/quota', creds.channelAccessToken) as { value?: number };
    const consumption = await lineGet('/v2/bot/message/quota/consumption', creds.channelAccessToken) as { totalUsage: number };
    return {
      totalUsage: consumption.totalUsage,
      maxMessages: quota.value,
    };
  },
};

// ─────────────────────────────────────────────────────────────────
// LIFF helpers  (Task 8.x) — exported for direct use by LIFF router
// ─────────────────────────────────────────────────────────────────

export async function listLiffApps(token: string): Promise<unknown[]> {
  const res = await fetch(`${LIFF_API}/apps`, { headers: lineHeaders(token) });
  const data = await res.json() as { apps: unknown[] };
  return data.apps ?? [];
}

export async function createLiffApp(token: string, config: unknown): Promise<string> {
  const res = await fetch(`${LIFF_API}/apps`, {
    method: 'POST',
    headers: lineHeaders(token),
    body: JSON.stringify(config),
  });
  const data = await res.json() as { liffId: string };
  return data.liffId;
}

export async function updateLiffApp(token: string, liffId: string, config: unknown): Promise<void> {
  await fetch(`${LIFF_API}/apps/${liffId}`, {
    method: 'PUT',
    headers: lineHeaders(token),
    body: JSON.stringify(config),
  });
}

export async function deleteLiffApp(token: string, liffId: string): Promise<void> {
  await fetch(`${LIFF_API}/apps/${liffId}`, { method: 'DELETE', headers: lineHeaders(token) });
}

// ─────────────────────────────────────────────────────────────────
// Account Link helpers  (Task 9.x)
// ─────────────────────────────────────────────────────────────────

export async function issueAccountLinkToken(token: string, userId: string): Promise<string> {
  const res = await fetch(`${API}/v2/bot/user/${userId}/linkToken`, {
    method: 'POST',
    headers: lineHeaders(token),
  });
  const data = await res.json() as { linkToken: string };
  return data.linkToken;
}

// ─────────────────────────────────────────────────────────────────
// Internal LINE Webhook payload types
// ─────────────────────────────────────────────────────────────────

interface LineWebhookPayload {
  destination: string;
  events: LineEvent[];
}

interface LineEvent {
  type: string;
  timestamp: number;
  source?: { type: string; userId?: string; groupId?: string; roomId?: string };
  replyToken?: string;
  // message event
  message?: {
    id: string;
    type: string;
    text?: string;
    latitude?: number;
    longitude?: number;
    title?: string;
    address?: string;
    packageId?: string;
    stickerId?: string;
  };
  // postback event
  postback?: { data: string; params?: Record<string, string> };
  // unsend event
  unsend?: { messageId: string };
  // videoPlayComplete event
  videoPlayComplete?: { trackingId: string };
  // accountLink event
  link?: { result: string; nonce: string };
  // beacon event
  beacon?: { hwid: string; type: string };
  // group member events
  joined?: { members: unknown[] };
  left?: { members: unknown[] };
}
