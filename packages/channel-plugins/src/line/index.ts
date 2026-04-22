// LinePlugin — implements ChannelPlugin for LINE Official Account
// Covers: Messaging API, Rich Menu API, Insight API, LIFF, Account Link
// ref: docs/03_CHANNEL_PLUGINS/LINE_OA.md

import * as crypto from 'node:crypto';
import type {
  ChannelPlugin,
  ChannelUiExtension,
  ChannelAudienceExtension,
  ChannelAnalyticsExtension,
  ParsedWebhookMessage,
  OutboundPayload,
  MediaUploadFn,
} from '../index.js';

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

function buildLineMessage(contentType: string, content: Record<string, unknown>): unknown {
  const quickReplies = content.quickReplies as Array<{ label: string; text?: string; postbackData?: string; imageUrl?: string }> | undefined;
  const quickReply = quickReplies?.length
    ? {
        items: quickReplies.map((r) => ({
          type: 'action',
          ...(r.imageUrl ? { imageUrl: r.imageUrl } : {}),
          action: r.postbackData
            ? { type: 'postback', label: r.label, data: r.postbackData, displayText: r.text }
            : { type: 'message', label: r.label, text: r.text ?? r.label },
        })),
      }
    : undefined;

  const base = quickReply ? { quickReply } : {};

  switch (contentType) {
    case 'text':
      return { type: 'text', text: content.text ?? '', ...base };
    case 'image':
      return {
        type: 'image',
        originalContentUrl: content.mediaUrl,
        previewImageUrl: content.previewUrl ?? content.mediaUrl,
        ...base,
      };
    case 'video':
      return {
        type: 'video',
        originalContentUrl: content.mediaUrl,
        previewImageUrl: content.previewUrl ?? content.mediaUrl,
        ...(content.trackingId ? { trackingId: content.trackingId } : {}),
        ...base,
      };
    case 'audio':
      return { type: 'audio', originalContentUrl: content.mediaUrl, duration: 0, ...base };
    case 'location':
      return {
        type: 'location',
        title: content.text ?? 'Location',
        address: content.address ?? '',
        latitude: content.latitude ?? 0,
        longitude: content.longitude ?? 0,
        ...base,
      };
    case 'sticker':
      return { type: 'sticker', packageId: content.packageId ?? '1', stickerId: content.stickerId ?? '1', ...base };
    case 'flex':
      return { type: 'flex', altText: content.altText ?? content.text ?? 'Message', contents: content.flexJson ?? content.contents, ...base };
    case 'imagemap':
      return { ...(content.imagemapJson as object ?? {}), type: 'imagemap', ...base };
    case 'template':
      return { type: 'template', altText: content.text ?? 'Message', template: content.templateJson, ...base };
    default:
      return { type: 'text', text: content.text ?? '', ...base };
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

  // ─── parseWebhook ──────────────────────────────────────────────
  async parseWebhook(rawBody: Buffer, _headers: Record<string, string>): Promise<ParsedWebhookMessage[]> {
    const payload = JSON.parse(rawBody.toString()) as LineWebhookPayload;
    const results: ParsedWebhookMessage[] = [];

    for (const event of payload.events ?? []) {
      const contactUid = event.source?.userId ?? event.source?.groupId ?? '';
      const timestamp = new Date(event.timestamp);

      switch (event.type) {
        case 'message': {
          const m = event.message!;
          let contentType = m.type;
          let content: Record<string, unknown> = {};

          switch (m.type) {
            case 'text':
              content = { text: m.text };
              break;
            case 'image':
            case 'video': {
              const label = m.type === 'image' ? '圖片' : '影片';
              const cp = (m as any).contentProvider as { type?: string; originalContentUrl?: string; previewImageUrl?: string } | undefined;
              if (cp?.type === 'external' && cp.originalContentUrl) {
                content = {
                  text: `[${label}]`,
                  url: cp.originalContentUrl,
                  previewUrl: cp.previewImageUrl ?? cp.originalContentUrl,
                };
              } else {
                content = {
                  text: `[${label}]`,
                  contentId: m.id,
                  mediaUrl: `line-content:${m.id}`,
                };
              }
              break;
            }
            case 'location':
              content = {
                text: `[位置] ${(m as any).title ?? (m as any).address ?? ''}`.trim(),
                title: (m as any).title,
                address: (m as any).address,
                latitude: (m as any).latitude,
                longitude: (m as any).longitude,
              };
              break;
            case 'sticker':
              content = {
                text: '[貼圖]',
                packageId: (m as any).packageId,
                stickerId: (m as any).stickerId,
              };
              break;
            default:
              contentType = 'unknown';
              content = { text: `[${m.type}]` };
          }

          results.push({ channelMsgId: m.id, contactUid, timestamp, contentType, content, rawPayload: event });
          break;
        }

        case 'postback':
          results.push({
            channelMsgId: undefined,
            contactUid,
            timestamp,
            contentType: 'postback',
            content: { text: event.postback?.data ?? '' },
            rawPayload: event,
          });
          break;

        case 'follow':
        case 'unfollow':
        case 'join':
        case 'leave':
          results.push({ contactUid, timestamp, contentType: event.type, content: { systemEvent: event.type }, rawPayload: event });
          break;

        case 'memberJoined':
          results.push({ contactUid, timestamp, contentType: 'memberJoined', content: { systemEvent: 'memberJoined', members: event.joined?.members }, rawPayload: event });
          break;

        case 'memberLeft':
          results.push({ contactUid, timestamp, contentType: 'memberLeft', content: { systemEvent: 'memberLeft', members: event.left?.members }, rawPayload: event });
          break;

        case 'unsend':
          results.push({ contactUid, timestamp, contentType: 'unsend', content: { systemEvent: 'unsend', originalMessageId: event.unsend?.messageId }, rawPayload: event });
          break;

        case 'videoPlayComplete':
          results.push({ contactUid, timestamp, contentType: 'videoPlayComplete', content: { systemEvent: 'videoPlayComplete', trackingId: event.videoPlayComplete?.trackingId }, rawPayload: event });
          break;

        case 'accountLink':
          results.push({ contactUid, timestamp, contentType: 'accountLink', content: { systemEvent: 'accountLink', result: event.link?.result, nonce: event.link?.nonce }, rawPayload: event });
          break;

        case 'beacon':
          results.push({ contactUid, timestamp, contentType: 'beacon', content: { systemEvent: 'beacon', hwid: event.beacon?.hwid, beaconType: event.beacon?.type }, rawPayload: event });
          break;

        default:
          break;
      }
    }

    return results;
  }

  // ─── getProfile ──────────────────────────────────────────────
  async getProfile(uid: string, credentials: Record<string, unknown>): Promise<{ uid: string; displayName: string; avatarUrl?: string }> {
    const token = credentials.channelAccessToken as string;
    const data = await lineGet(`/v2/bot/profile/${uid}`, token) as Record<string, string>;
    return {
      uid: data.userId,
      displayName: data.displayName,
      avatarUrl: data.pictureUrl,
    };
  }

  // ─── sendMessage ─────────────────────────────────────────────
  async sendMessage(to: string, message: OutboundPayload, credentials: Record<string, unknown>): Promise<{ success: boolean; channelMsgId?: string; error?: string }> {
    const token = credentials.channelAccessToken as string;
    const { contentType, content } = message;
    const lineMsg = buildLineMessage(contentType, content);
    const messages = [lineMsg];
    const strategy = (content.strategy as string) ?? 'push';

    try {
      switch (strategy) {
        case 'reply':
          await linePost('/v2/bot/message/reply', token, { replyToken: content.replyToken, messages });
          break;
        case 'push':
          await linePost('/v2/bot/message/push', token, { to, messages });
          break;
        case 'multicast': {
          const uids = (content.recipientUids as string[]) ?? [to];
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
            ...(content.audienceGroupId
              ? { recipient: { type: 'audienceGroup', audienceGroupId: Number(content.audienceGroupId) } }
              : {}),
          });
          break;
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  // ─── setWebhook ──────────────────────────────────────────────
  async setWebhook(webhookUrl: string, credentials: Record<string, unknown>): Promise<void> {
    const token = credentials.channelAccessToken as string;
    await linePut('/v2/bot/channel/webhook/endpoint', token, { webhook: webhookUrl });
  }

  // ─── resolveInboundMedia ─────────────────────────────────────
  // Called for LINE-hosted media (contentProvider.type === 'line').
  // External-provider messages already carry a URL; they never have contentId, so this returns null for them.
  async resolveInboundMedia(
    content: Record<string, unknown>,
    contentType: string,
    credentials: Record<string, unknown>,
    uploadFn: MediaUploadFn,
  ): Promise<{ url: string; storageKey: string } | null> {
    const contentId = content.contentId as string | undefined;
    if (!contentId || !['image', 'video', 'audio', 'file'].includes(contentType)) return null;

    const token = credentials.channelAccessToken as string;
    const res = await fetch(`https://api-data.line.me/v2/bot/message/${contentId}/content`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type') || 'application/octet-stream';
    const extMap: Record<string, string> = { image: '.jpg', video: '.mp4', audio: '.m4a', file: '' };
    const filename = `line_${contentId}${extMap[contentType] ?? ''}`;

    const result = await uploadFn(buffer, filename, mimeType);
    return { url: result.url, storageKey: result.key };
  }


  readonly extensions = {
    ui: richMenuExtension,
    audience: audienceExtension,
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

export const linePlugin = new LinePlugin();
