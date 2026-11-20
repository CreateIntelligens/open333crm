/**
 * 留言自動私訊呼叫 Meta 的部分（交易外）：前置條件的訂閱查詢、留言接收的訂閱、最近貼文與網址解析
 * （change add-comment-keyword-private-reply design「API」、D19、D25；spec comment-reply-meta-subscription）。
 *
 * 本檔的函式呼叫外掛（HTTP）並使用 Redis 快取，不碰資料庫，所以不放在 .service.ts（結構規則 2：
 * service 只用 ctx.tx，不呼叫外部服務、不用 Redis）。flow 先在交易內以 comment-reply-channel.service
 * 讀出渠道，交易結束後再呼叫本檔（design D1：Meta 呼叫一律在交易外）。外掛差異一律經 extensions.comments（結構規則 5）。
 */
import type { ChannelCommentExtension, CommentSubscriptionStatus, RecentPost } from '@open333crm/channel-plugins';
import { MetaApiError } from '@open333crm/channel-plugins';
import type { Redis } from 'ioredis';
import { AppError } from '../../shared/utils/response.js';
import type { CommentChannelHandle, ReadinessBase } from './comment-reply-channel.service.js';
import { capabilityName, type CommentReplyPlatformSettings } from './comment-reply-platform-settings.js';

/** readiness 查 Meta 的結果快取 5 分鐘、每渠道最多等 3 秒（design D25） */
export const READINESS_CACHE_SECONDS = 300;
export const READINESS_META_TIMEOUT_MS = 3000;
export const readinessCacheKey = (channelId: string) => `cr:readiness:${channelId}`;
/** 最近貼文快取 60 秒（spec「最近貼文清單」） */
export const POSTS_CACHE_SECONDS = 60;
const postsCacheKey = (channelId: string, cursor: string | undefined) => `cr:posts:${channelId}:${cursor ?? ''}`;

// ─── 前置條件（GET /readiness） ──────────────────────────────────────────

/** Instagram 留言私訊需要的權限（權杖沒有時要重新產生後貼回渠道） */
export const IG_COMMENT_PERMISSION = 'instagram_business_manage_comments';

type SubscriptionLookup = Pick<CommentSubscriptionStatus, 'subscribed' | 'missingPermissions' | 'canPrivateReply' | 'canPublicReply'>;
const UNKNOWN_STATUS: SubscriptionLookup = { subscribed: null, missingPermissions: null, canPrivateReply: null, canPublicReply: null };

/** 查 Meta 的訂閱與權限（交易外）：Redis 快取 5 分鐘；3 秒內沒回應回未知（不快取） */
async function lookupSubscription(channel: CommentChannelHandle, redis: Redis | undefined): Promise<SubscriptionLookup> {
  const key = readinessCacheKey(channel.id);
  const cached = await redis?.get(key).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached) as SubscriptionLookup;
    } catch {
      /* 壞掉的快取當沒有 */
    }
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), READINESS_META_TIMEOUT_MS);
  });
  const result = await Promise.race([
    channel.ext
      .getSubscriptionStatus(channel.credentials, { accountId: channel.accountId, appId: channel.appId, appSecret: channel.appSecret })
      .catch(() => UNKNOWN_STATUS),
    timeout,
  ]);
  clearTimeout(timer);
  if (!result) return UNKNOWN_STATUS;
  await redis?.set(key, JSON.stringify(result), 'EX', READINESS_CACHE_SECONDS).catch(() => undefined);
  return result;
}

export interface MissingPermissionSplit {
  /** 收留言、私訊的必要權限中缺少的；null＝無法得知 */
  required: string[] | null;
  /** 平台已開放的選用功能所缺少的權限（功能未開放或無法得知時是空陣列） */
  optional: { publicReply: string[]; postPicker: string[] };
}

/**
 * @description 把外掛回報的缺少權限分成「必要」與「已開放的選用功能」（issue #529）。
 *   只屬於選用功能的權限（外掛的 capabilities.optionalPermissions）不算必要權限；平台沒有開放的功能不回報。
 * @param missing 外掛回報權杖缺少的所有權限；null＝無法得知
 * @param optionalScopes 外掛標示的選用功能權限；沒有時所有缺少的權限都算必要
 * @param enabled 平台是否開放公開回覆、貼文挑選
 */
export function splitMissingPermissions(
  missing: string[] | null,
  optionalScopes: ChannelCommentExtension['capabilities']['optionalPermissions'],
  enabled: { publicReply: boolean; postPicker: boolean },
): MissingPermissionSplit {
  const publicReply = optionalScopes?.publicReply ?? [];
  const postPicker = optionalScopes?.postPicker ?? [];
  if (!missing) return { required: null, optional: { publicReply: [], postPicker: [] } };
  return {
    required: missing.filter((s) => !publicReply.includes(s) && !postPicker.includes(s)),
    optional: {
      publicReply: enabled.publicReply ? missing.filter((s) => publicReply.includes(s)) : [],
      postPicker: enabled.postPicker ? missing.filter((s) => postPicker.includes(s)) : [],
    },
  };
}

/** readiness 的回應（design「API」GET /readiness） */
export async function buildReadiness(base: ReadinessBase, redis: Redis | undefined) {
  const channels = await Promise.all(
    base.channels.map(async (c) => {
      const platform = c.ext.capabilities.platform;
      const caps = {
        privateReply: base.capabilities[capabilityName(platform, 'PrivateReply')],
        postPicker: base.capabilities[capabilityName(platform, 'PostPicker')],
        publicReply: base.capabilities[capabilityName(platform, 'PublicReply')] && c.ext.capabilities.publicReply,
        contentTypes: [...c.ext.capabilities.privateReplyContentTypes],
        materials: c.ext.capabilities.materialChannelType !== null,
      };
      const status = await lookupSubscription(c, redis);
      // 公開回覆、貼文挑選的權限只在平台開放該功能時才算缺少（issue #529：未過審的權限所有粉專都拿不到）
      const split = splitMissingPermissions(status.missingPermissions, c.ext.capabilities.optionalPermissions, {
        publicReply: caps.publicReply,
        postPicker: caps.postPicker,
      });
      let missingPermissions = split.required;
      if (platform === 'ig' && c.igPermissionMissing24h) {
        missingPermissions = [...new Set([...(missingPermissions ?? []), IG_COMMENT_PERMISSION])];
      }
      return {
        channelId: c.id,
        channelType: c.channelType,
        displayName: c.displayName,
        platform,
        appMode: c.appMode,
        receiving: c.receiving,
        subscribed: status.subscribed,
        missingPermissions,
        missingOptionalPermissions: split.optional,
        canPrivateReply: caps.privateReply && status.canPrivateReply !== false,
        canPublicReply: caps.publicReply && status.canPublicReply !== false,
        tokenStatus: c.tokenStatus,
        lastCommentEventAt: c.lastCommentEventAt,
        capabilities: caps,
      };
    }),
  );
  return {
    testPhase: base.testPhase,
    capabilities: base.capabilities,
    emergencyStopped: base.emergencyStopped,
    quota: base.quota,
    channels,
  };
}

// ─── 留言接收開關 ────────────────────────────────────────────────────────

/** 呼叫外掛 subscribeFields（交易外）；權限類錯誤 → 409 REAUTH_REQUIRED，其他 → 502 SUBSCRIBE_FAILED */
export async function subscribeCommentFieldsMeta(channel: CommentChannelHandle, fields: string[]): Promise<void> {
  try {
    await channel.ext.subscribeFields(channel.credentials, { accountId: channel.accountId, fields, appSecret: channel.appSecret });
  } catch (err) {
    const reason = err instanceof MetaApiError ? err.info.reason : 'UNKNOWN';
    if (reason === 'PERMISSION_MISSING' || reason === 'TOKEN_EXPIRED') {
      throw new AppError('粉專授權不足或已失效，請重新連結後再試', 'REAUTH_REQUIRED', 409, { reason });
    }
    throw new AppError('無法更新 Meta 的訂閱設定，請稍後再試', 'SUBSCRIBE_FAILED', 502, { reason });
  }
}

// ─── 最近貼文與網址解析 ──────────────────────────────────────────────────

export interface PostView {
  postId: string;
  permalink: string | null;
  thumbnailUrl: string | null;
  excerpt: string;
  mediaType: string;
  publishedAt: string;
}

const toPostView = (p: RecentPost): PostView => ({
  postId: p.postId,
  permalink: p.permalink,
  thumbnailUrl: p.thumbnailUrl,
  excerpt: p.excerpt,
  mediaType: p.mediaType,
  publishedAt: p.publishedAt.toISOString(),
});

/** 平台關閉該平台的貼文挑選 → 403 CAPABILITY_DISABLED（不呼叫 Graph API） */
export function assertPostPickerCapability(channel: CommentChannelHandle, settings: CommentReplyPlatformSettings): void {
  const cap = capabilityName(channel.ext.capabilities.platform, 'PostPicker');
  if (!settings.capabilities[cap]) {
    throw new AppError('平台尚未開放從最近貼文挑選，請手動填寫貼文 ID', 'CAPABILITY_DISABLED', 403, { capability: cap });
  }
}

function postsUnavailable(err: unknown): AppError {
  const reason = err instanceof MetaApiError ? err.info.reason : 'UNKNOWN';
  return new AppError('目前無法讀取貼文，請稍後再試或手動填寫貼文 ID', 'POSTS_UNAVAILABLE', 502, { reason });
}

/** 最近貼文（交易外、快取 60 秒、不寫資料庫） */
export async function listRecentPostsMeta(
  channel: CommentChannelHandle,
  cursor: string | undefined,
  redis: Redis | undefined,
): Promise<{ posts: PostView[]; nextCursor: string | null }> {
  const key = postsCacheKey(channel.id, cursor);
  const cached = await redis?.get(key).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached) as { posts: PostView[]; nextCursor: string | null };
    } catch {
      /* 壞掉的快取當沒有 */
    }
  }
  let page: { posts: RecentPost[]; nextCursor: string | null };
  try {
    page = await channel.ext.listRecentPosts(readCredentialsOf(channel), cursor);
  } catch (err) {
    throw postsUnavailable(err);
  }
  const result = { posts: page.posts.map(toPostView), nextCursor: page.nextCursor };
  await redis?.set(key, JSON.stringify(result), 'EX', POSTS_CACHE_SECONDS).catch(() => undefined);
  return result;
}

/**
 * 讀貼文用的憑證：補上 pageId；平台模式的 FB 渠道憑證沒有 App Secret，補上平台 App Secret 讓外掛算 appsecret_proof
 * （與 subscribeFields、getSubscriptionStatus 一致；自備 App 的渠道沿用 credentials.appSecret）
 */
function readCredentialsOf(channel: CommentChannelHandle): Record<string, unknown> {
  return {
    ...channel.credentials,
    pageId: channel.accountId || channel.credentials.pageId,
    ...(channel.appSecret ? { appSecret: channel.appSecret } : {}),
  };
}

/** 貼文網址換貼文（交易外）。只經外掛呼叫 Graph API，不對使用者網址發出請求；找不到 → 404 POST_NOT_FOUND */
export async function resolvePostUrlMeta(channel: CommentChannelHandle, url: string): Promise<PostView> {
  let post: RecentPost | null;
  try {
    post = await channel.ext.resolvePostUrl(url, readCredentialsOf(channel));
  } catch (err) {
    throw postsUnavailable(err);
  }
  if (!post) throw new AppError('找不到這篇貼文，請確認網址屬於這個粉專或帳號', 'POST_NOT_FOUND', 404);
  return toPostView(post);
}
