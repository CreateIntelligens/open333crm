/**
 * FB 外掛的留言擴充（change add-comment-keyword-private-reply，design D5、D6、「外掛契約」）。
 *
 * 私訊留言者與一般私訊共用 FbPlugin 的 postMessage()（組 body、站內路徑換公開網址），只差 recipient：
 * 一般私訊 `{ id: PSID }`，留言私訊 `{ comment_id }`。
 */
import type {
  ChannelCommentExtension,
  CommentReplyCapabilities,
  CommentSendResult,
  CommentSubscriptionStatus,
  OutboundPayload,
  ParsedCommentEvent,
  RecentPost,
} from '../index.js';
import {
  appSecretProof,
  excerptOf,
  graphFetch,
  graphFetchOrThrow,
  hostIs,
  MetaApiError,
  networkError,
  parseGraphTime,
  parseUrl,
  readGraphResponse,
  RESOLVE_URL_MAX_PAGES,
  safeJsonParse,
} from '../meta-graph.js';

const FB_GRAPH_API = 'https://graph.facebook.com/v21.0';

/**
 * FB 私訊可用的 contentType：buildFbMessage() 支援的型態。fb_receipt、fb_coupon、fb_feedback 是交易／回饋用途，
 * 未實測，第一版不開放（planning/02-architecture.md §2.3）。
 */
export const FB_PRIVATE_REPLY_CONTENT_TYPES = [
  'fb_text', 'fb_image', 'fb_video', 'fb_button', 'fb_generic', 'fb_media', 'text', 'image', 'video', 'file',
] as const;

/** 私訊、公開回覆、列貼文所需的粉專權限（planning/04-meta-app-review.md） */
const PRIVATE_REPLY_SCOPES = ['pages_messaging'];
const PUBLIC_REPLY_SCOPES = ['pages_manage_engagement', 'pages_read_engagement'];
const REQUIRED_SCOPES = ['pages_show_list', 'pages_manage_metadata', ...PRIVATE_REPLY_SCOPES, ...PUBLIC_REPLY_SCOPES];

const POST_FIELDS = 'id,message,created_time,permalink_url,full_picture,attachments{media_type}';

export type PostMessageResult = { sitePathError: string } | { response: Response };

export interface FbCommentDeps {
  /** FbPlugin 的共用送訊息函式（fetch 丟錯會往外丟） */
  postMessage(recipient: Record<string, string>, message: OutboundPayload, credentials: Record<string, unknown>): Promise<PostMessageResult>;
}

interface FbFeedValue {
  item?: string;
  verb?: string;
  comment_id?: string;
  post_id?: string;
  parent_id?: string;
  from?: { id?: string | number; name?: string };
  message?: string;
  created_time?: number | string;
}

function tokenOf(credentials: Record<string, unknown>): string {
  return String(credentials.pageAccessToken ?? '');
}

function mediaTypeOf(post: Record<string, any>): RecentPost['mediaType'] {
  const t = String(post.attachments?.data?.[0]?.media_type ?? '').toLowerCase();
  if (t === 'photo') return 'image';
  if (t === 'album') return 'carousel';
  if (t === 'video') return 'video';
  return 'text';
}

function toRecentPost(post: Record<string, any>): RecentPost {
  return {
    postId: String(post.id),
    permalink: post.permalink_url ?? null,
    thumbnailUrl: post.full_picture ?? null,
    excerpt: excerptOf(post.message),
    mediaType: mediaTypeOf(post),
    publishedAt: parseGraphTime(post.created_time) ?? new Date(0),
  };
}

/** 比對 permalink 用：去掉 query、結尾斜線，host 不分 www／m */
function normalizePermalink(url: string): string | null {
  const u = parseUrl(url);
  if (!u) return null;
  return `${u.hostname.replace(/^(www|m|web)\./, '')}${u.pathname.replace(/\/+$/, '')}`;
}

/** Unix 秒（數字或數字字串）轉 Date */
function fromUnixSeconds(value: unknown): Date | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(n) ? new Date(n * 1000) : null;
}

export function createFbCommentExtension(deps: FbCommentDeps): ChannelCommentExtension {
  const capabilities: CommentReplyCapabilities = {
    platform: 'fb',
    privateReplyContentTypes: FB_PRIVATE_REPLY_CONTENT_TYPES,
    publicReply: true,
    materialChannelType: 'fb',
    postLinkLabel: '在 Facebook 開啟',
  };

  function parsePostReference(input: string, ctx: { accountId: string }): string | null {
    const s = (input ?? '').trim();
    if (!s || !ctx.accountId) return null;
    if (/^\d+$/.test(s)) return `${ctx.accountId}_${s}`;
    const composite = /^(\d+)_(\d+)$/.exec(s);
    if (composite) return composite[1] === ctx.accountId ? s : null;

    const url = parseUrl(s);
    if (!url || !(hostIs(url, 'facebook.com') || hostIs(url, 'fb.com'))) return null;
    const fromPath = /\/posts\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1];
    const fromQuery = [url.searchParams.get('story_fbid'), url.searchParams.get('fbid')].find((v) => v && /^\d+$/.test(v));
    const id = fromPath ?? fromQuery;
    return id ? `${ctx.accountId}_${id}` : null;
  }

  /** 憑證沒有 pageId 時以粉專權杖的 /me 取得 */
  async function pageIdOf(credentials: Record<string, unknown>): Promise<string> {
    if (credentials.pageId) return String(credentials.pageId);
    const me = await graphFetchOrThrow<{ id?: string }>(`${FB_GRAPH_API}/me?fields=id&access_token=${encodeURIComponent(tokenOf(credentials))}`);
    if (!me.id) throw new MetaApiError({ message: '無法取得粉專 ID', reason: 'UNKNOWN', transient: false });
    return String(me.id);
  }

  async function listRecentPosts(credentials: Record<string, unknown>, cursor?: string) {
    const pageId = credentials.pageId ? String(credentials.pageId) : 'me';
    const params = new URLSearchParams({ fields: POST_FIELDS, limit: '25', access_token: tokenOf(credentials) });
    if (cursor) params.set('after', cursor);
    if (credentials.appSecret) params.set('appsecret_proof', appSecretProof(tokenOf(credentials), String(credentials.appSecret)));
    const body = await graphFetchOrThrow<{ data?: Record<string, any>[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      `${FB_GRAPH_API}/${pageId}/published_posts?${params}`,
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
      if (payload?.object !== 'page') return [];
      const events: ParsedCommentEvent[] = [];
      for (const entry of payload.entry ?? []) {
        const accountId = entry?.id != null ? String(entry.id) : '';
        if (!accountId) continue;
        for (const change of entry.changes ?? []) {
          if (change?.field !== 'feed') continue;
          const v = (change.value ?? {}) as FbFeedValue;
          if (v.item !== 'comment' || (v.verb !== 'add' && v.verb !== 'remove')) continue;
          if (!v.comment_id || !v.post_id) continue;
          const fromId = v.from?.id != null ? String(v.from.id) : '';
          // 粉專自己的留言（含本功能的公開回覆）不處理，避免迴圈
          if (fromId === accountId) continue;
          // 新留言缺 from 無法私訊，整則略過（待實測 M8 是否會發生）；刪除事件仍回傳，讓紀錄標記為已刪除
          if (!fromId && v.verb === 'add') continue;
          const commentAt = fromUnixSeconds(v.created_time);
          const parentId = v.parent_id && v.parent_id !== v.post_id ? String(v.parent_id) : undefined;
          events.push({
            kind: v.verb,
            accountId,
            commentId: String(v.comment_id),
            postId: String(v.post_id),
            ...(parentId ? { parentId } : {}),
            commenterId: fromId,
            ...(v.from?.name ? { commenterName: v.from.name } : {}),
            text: typeof v.message === 'string' ? v.message : '',
            createdAt: commentAt ?? new Date(Number(entry.time) || Date.now()),
            createdAtSource: commentAt ? 'comment' : 'notification',
          });
        }
      }
      return events;
    },

    parsePostReference,

    async sendPrivateReply(commentId, message, credentials): Promise<CommentSendResult> {
      if (!(FB_PRIVATE_REPLY_CONTENT_TYPES as readonly string[]).includes(message.contentType)) {
        return { ok: false, error: { message: `Facebook 留言私訊不支援 ${message.contentType}`, reason: 'MATERIAL_UNSUPPORTED', transient: false } };
      }
      let r: PostMessageResult;
      try {
        r = await deps.postMessage({ comment_id: commentId }, message, credentials);
      } catch (err) {
        return { ok: false, error: networkError(err) };
      }
      if ('sitePathError' in r) return { ok: false, error: { message: r.sitePathError, reason: 'UNKNOWN', transient: false } };
      const res = await readGraphResponse<{ recipient_id?: string; message_id?: string }>(r.response);
      if (!res.ok) return res;
      return { ok: true, recipientId: String(res.body.recipient_id ?? ''), messageId: String(res.body.message_id ?? '') };
    },

    async replyToComment(commentId, text, credentials) {
      const res = await graphFetch<{ id?: string }>(
        `${FB_GRAPH_API}/${encodeURIComponent(commentId)}/comments?access_token=${encodeURIComponent(tokenOf(credentials))}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) },
      );
      if (!res.ok) return res;
      return { ok: true, replyId: String(res.body.id ?? '') };
    },

    listRecentPosts,

    async resolvePostUrl(input, credentials) {
      const url = parseUrl(input);
      // 只接受 facebook.com 的網址；不 fetch 使用者給的網址（SEC-01）
      if (!url || !(hostIs(url, 'facebook.com') || hostIs(url, 'fb.com'))) return null;
      const pageId = await pageIdOf(credentials);
      const postId = parsePostReference(input, { accountId: pageId });
      if (postId) {
        const params = new URLSearchParams({ fields: POST_FIELDS, access_token: tokenOf(credentials) });
        const res = await graphFetch(`${FB_GRAPH_API}/${postId}?${params}`);
        if (res.ok) return toRecentPost({ id: postId, ...res.body });
        if (res.error.code === 100) return null;
        throw new MetaApiError(res.error);
      }
      // pfbid 等無法離線換算的網址：掃最近幾頁貼文比對 permalink_url
      const target = normalizePermalink(input);
      let cursor: string | undefined;
      for (let i = 0; i < RESOLVE_URL_MAX_PAGES; i++) {
        const page = await listRecentPosts({ ...credentials, pageId }, cursor);
        const hit = page.posts.find((p) => p.permalink && normalizePermalink(p.permalink) === target);
        if (hit) return hit;
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return null;
    },

    async getSubscriptionStatus(credentials, ctx): Promise<CommentSubscriptionStatus> {
      const token = tokenOf(credentials);
      const appId = ctx.appId ?? (credentials.appId ? String(credentials.appId) : undefined);
      const appSecret = ctx.appSecret ?? (credentials.appSecret ? String(credentials.appSecret) : undefined);

      const subParams = new URLSearchParams();
      if (appSecret) subParams.set('appsecret_proof', appSecretProof(token, appSecret));
      const sub = await graphFetch<{ data?: Array<{ id?: string; subscribed_fields?: string[] }> }>(
        `${FB_GRAPH_API}/${encodeURIComponent(ctx.accountId)}/subscribed_apps?${subParams}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      let subscribed: boolean | null = null;
      if (sub.ok) {
        const apps = sub.body.data ?? [];
        const mine = appId ? apps.find((a) => String(a.id) === appId) : apps[0];
        subscribed = Boolean(mine?.subscribed_fields?.includes('feed'));
      }

      let scopes: string[] | null = null;
      if (appId && appSecret) {
        const dbg = await graphFetch<{ data?: { scopes?: string[] } }>(
          `${FB_GRAPH_API}/debug_token?${new URLSearchParams({ input_token: token, access_token: `${appId}|${appSecret}` })}`,
        );
        if (dbg.ok && Array.isArray(dbg.body.data?.scopes)) scopes = dbg.body.data.scopes;
      }
      const has = (list: string[]) => (scopes ? list.every((s) => scopes!.includes(s)) : null);
      return {
        subscribed,
        missingPermissions: scopes ? REQUIRED_SCOPES.filter((s) => !scopes!.includes(s)) : null,
        canPrivateReply: has(PRIVATE_REPLY_SCOPES),
        canPublicReply: has(PUBLIC_REPLY_SCOPES),
      };
    },

    async subscribeFields(credentials, ctx) {
      const token = tokenOf(credentials);
      const appSecret = ctx.appSecret ?? (credentials.appSecret ? String(credentials.appSecret) : undefined);
      // POST subscribed_apps 是整份取代：fields 原樣送出，不自己增減（design D19）
      const form = new URLSearchParams({ subscribed_fields: ctx.fields.join(',') });
      if (appSecret) form.set('appsecret_proof', appSecretProof(token, appSecret));
      const body = await graphFetchOrThrow<{ success?: boolean }>(`${FB_GRAPH_API}/${encodeURIComponent(ctx.accountId)}/subscribed_apps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (body.success !== true) {
        throw new MetaApiError({ message: 'subscribed_apps 沒有回傳 success', reason: 'UNKNOWN', transient: false });
      }
    },
  };
}
