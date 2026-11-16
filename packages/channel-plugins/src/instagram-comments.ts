/**
 * IG 外掛（Instagram Login，graph.instagram.com）的留言擴充
 * （change add-comment-keyword-private-reply，design D5、「外掛契約」、spec threads-channel）。
 *
 * IG 私訊只能送文字、沒有素材；IG 留言事件沒有建立時間，以 entry.time 當留言時間（design D14）。
 */
import type {
  ChannelCommentExtension,
  CommentReplyCapabilities,
  CommentSubscriptionStatus,
  ParsedCommentEvent,
  RecentPost,
} from './index.js';
import { excerptOf, graphFetch, graphFetchOrThrow, hostIs, MetaApiError, parseGraphTime, parseUrl, RESOLVE_URL_MAX_PAGES, safeJsonParse } from './meta-graph.js';

const IG_GRAPH_API = 'https://graph.instagram.com/v21.0';
const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp';

interface IgCommentValue {
  id?: string;
  text?: string;
  parent_id?: string;
  from?: { id?: string | number; username?: string; self_ig_scoped_id?: string };
  media?: { id?: string; media_product_type?: string; ad_id?: string };
}

function tokenOf(credentials: Record<string, unknown>): string {
  return String(credentials.pageAccessToken ?? '');
}

/** entry.time：Messenger 慣例是毫秒，IG 文件範例是秒，兩種都接受 */
function entryTime(value: unknown): Date {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return new Date();
  return new Date(n < 1e12 ? n * 1000 : n);
}

function mediaTypeOf(m: Record<string, any>): RecentPost['mediaType'] {
  if (m.media_product_type === 'REELS') return 'reels';
  if (m.media_type === 'CAROUSEL_ALBUM') return 'carousel';
  if (m.media_type === 'VIDEO') return 'video';
  if (m.media_type === 'IMAGE') return 'image';
  return 'text';
}

function toRecentPost(m: Record<string, any>): RecentPost {
  return {
    postId: String(m.id),
    permalink: m.permalink ?? null,
    thumbnailUrl: m.thumbnail_url ?? m.media_url ?? null,
    excerpt: excerptOf(m.caption),
    mediaType: mediaTypeOf(m),
    publishedAt: parseGraphTime(m.timestamp) ?? new Date(0),
  };
}

/** IG 貼文網址的 shortcode（/p/<code>、/reel/<code>、/reels/<code>） */
function shortcodeOf(url: string): string | null {
  const u = parseUrl(url);
  if (!u || !hostIs(u, 'instagram.com')) return null;
  return /^\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/.exec(u.pathname)?.[1] ?? null;
}

export function createInstagramCommentExtension(): ChannelCommentExtension {
  const capabilities: CommentReplyCapabilities = {
    platform: 'ig',
    privateReplyContentTypes: ['text'],
    publicReply: true,
    materialChannelType: null,
    postLinkLabel: '在 Instagram 開啟',
  };

  async function listRecentPosts(credentials: Record<string, unknown>, cursor?: string) {
    const params = new URLSearchParams({ fields: MEDIA_FIELDS, limit: '25', access_token: tokenOf(credentials) });
    if (cursor) params.set('after', cursor);
    const body = await graphFetchOrThrow<{ data?: Record<string, any>[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      `${IG_GRAPH_API}/me/media?${params}`,
    );
    return {
      posts: (body.data ?? []).map(toRecentPost),
      nextCursor: body.paging?.next ? (body.paging.cursors?.after ?? null) : null,
    };
  }

  return {
    capabilities,

    parseCommentEvents(rawBody: Buffer): ParsedCommentEvent[] {
      const payload = safeJsonParse(rawBody);
      if (payload?.object !== 'instagram') return [];
      const events: ParsedCommentEvent[] = [];
      for (const entry of payload.entry ?? []) {
        const accountId = entry?.id != null ? String(entry.id) : '';
        if (!accountId) continue;
        for (const change of entry.changes ?? []) {
          // live_comments（直播留言）不處理
          if (change?.field !== 'comments') continue;
          const v = (change.value ?? {}) as IgCommentValue;
          const fromId = v.from?.id != null ? String(v.from.id) : '';
          if (!fromId || !v.id || !v.media?.id) continue;
          // 自己帳號的留言（含本功能的公開回覆）不處理，避免迴圈（Self Messaging 文件）
          if (fromId === accountId || v.from?.self_ig_scoped_id) continue;
          events.push({
            kind: 'add',
            accountId,
            commentId: String(v.id),
            postId: String(v.media.id),
            ...(v.parent_id ? { parentId: String(v.parent_id) } : {}),
            commenterId: fromId,
            ...(v.from?.username ? { commenterUsername: v.from.username } : {}),
            text: typeof v.text === 'string' ? v.text : '',
            createdAt: entryTime(entry.time),
            createdAtSource: 'notification',
            ...(v.media.ad_id ? { adId: String(v.media.ad_id) } : {}),
          });
        }
      }
      return events;
    },

    parsePostReference(input: string): string | null {
      const s = (input ?? '').trim();
      return /^\d+$/.test(s) ? s : null;
    },

    async sendPrivateReply(commentId, message, credentials) {
      // IG 留言私訊只能送文字：非文字內容不呼叫 Meta
      if (!capabilities.privateReplyContentTypes.includes(message.contentType)) {
        return { ok: false, error: { message: `Instagram 留言私訊只能送文字，不支援 ${message.contentType}`, reason: 'MATERIAL_UNSUPPORTED', transient: false } };
      }
      const text = typeof message.content.text === 'string' ? message.content.text : '';
      const res = await graphFetch<{ recipient_id?: string; message_id?: string }>(
        `${IG_GRAPH_API}/me/messages?access_token=${encodeURIComponent(tokenOf(credentials))}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
        },
      );
      if (!res.ok) return res;
      return { ok: true, recipientId: String(res.body.recipient_id ?? ''), messageId: String(res.body.message_id ?? '') };
    },

    async replyToComment(commentId, text, credentials) {
      const res = await graphFetch<{ id?: string }>(
        `${IG_GRAPH_API}/${encodeURIComponent(commentId)}/replies?access_token=${encodeURIComponent(tokenOf(credentials))}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) },
      );
      if (!res.ok) return res;
      return { ok: true, replyId: String(res.body.id ?? '') };
    },

    listRecentPosts,

    async resolvePostUrl(url, credentials) {
      // shortcode 不能換算成 media id：掃最近幾頁 media 比對 permalink。不 fetch 使用者給的網址（SEC-01）
      const code = shortcodeOf(url);
      if (!code) return null;
      let cursor: string | undefined;
      for (let i = 0; i < RESOLVE_URL_MAX_PAGES; i++) {
        const page = await listRecentPosts(credentials, cursor);
        const hit = page.posts.find((p) => p.permalink && shortcodeOf(p.permalink) === code);
        if (hit) return hit;
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return null;
    },

    async getSubscriptionStatus(credentials): Promise<CommentSubscriptionStatus> {
      // Instagram Login 是否提供 GET me/subscribed_apps 待實測（M7）；查不到時 subscribed 為 null。
      // Instagram 權杖沒有 debug_token，權限無法得知（design「其他未定細節」）
      const res = await graphFetch<{ data?: Array<{ subscribed_fields?: string[] }> }>(
        `${IG_GRAPH_API}/me/subscribed_apps?access_token=${encodeURIComponent(tokenOf(credentials))}`,
      );
      const subscribed = res.ok ? (res.body.data ?? []).some((a) => a.subscribed_fields?.includes('comments')) : null;
      return { subscribed, missingPermissions: null, canPrivateReply: null, canPublicReply: null };
    },

    async subscribeFields(credentials, ctx) {
      const params = new URLSearchParams({ subscribed_fields: ctx.fields.join(','), access_token: tokenOf(credentials) });
      const body = await graphFetchOrThrow<{ success?: boolean }>(`${IG_GRAPH_API}/me/subscribed_apps?${params}`, { method: 'POST' });
      if (body.success !== true) {
        throw new MetaApiError({ message: 'subscribed_apps 沒有回傳 success', reason: 'UNKNOWN', transient: false });
      }
    },
  };
}
