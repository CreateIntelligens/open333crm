/**
 * 留言自動私訊的渠道端：前置條件、留言接收開關、最近貼文與網址解析
 * （change add-comment-keyword-private-reply design「API」、D19、D22、D25；spec comment-reply-meta-subscription）。
 *
 * service 只讀寫資料庫（收 TenantCtx）；呼叫 Meta 的函式（*Meta）不碰資料庫，flow 在交易外呼叫它們（design D1：
 * Meta 呼叫一律在交易外）。外掛差異一律經 extensions.comments（結構規則 5）。
 */
import type { ChannelCommentExtension, CommentSubscriptionStatus, RecentPost } from '@open333crm/channel-plugins';
import { MetaApiError } from '@open333crm/channel-plugins';
import { taipeiMonthString } from '@open333crm/core';
import type { Redis } from 'ioredis';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { AppError } from '../../shared/utils/response.js';
import { patchChannelSettings } from '../channel/channel.service.js';
import { BASE_SUBSCRIBED_FIELDS, getMetaAppConfig, subscribedFieldsFor } from '../meta-connect/meta-connect.service.js';
import { getEffectiveLimit } from '../platform/plan-limits.service.js';
import {
  appModeOf,
  channelAccountId,
  channelCredentials,
  channelIdFilter,
  channelLevel,
  commentExtensionOf,
  commentReplySettingsOf,
  resolveViewerChannels,
  tokenStatusOf,
  type CommentReplyViewer,
} from './comment-reply-access.js';
import { capabilityName, type CommentReplyPlatformSettings } from './comment-reply-platform-settings.js';

/** IG 開啟留言接收時的欄位（Instagram Login 的 me/subscribed_apps）；關閉時只留 messages */
export const IG_BASE_SUBSCRIBED_FIELDS: readonly string[] = ['messages'];
export const IG_COMMENT_FIELD = 'comments';

/** readiness 查 Meta 的結果快取 5 分鐘、每渠道最多等 3 秒（design D25） */
export const READINESS_CACHE_SECONDS = 300;
export const READINESS_META_TIMEOUT_MS = 3000;
export const readinessCacheKey = (channelId: string) => `cr:readiness:${channelId}`;
/** 最近貼文快取 60 秒（spec「最近貼文清單」） */
export const POSTS_CACHE_SECONDS = 60;
const postsCacheKey = (channelId: string, cursor: string | undefined) => `cr:posts:${channelId}:${cursor ?? ''}`;

const channelSelect = {
  id: true,
  channelType: true,
  displayName: true,
  externalAccountId: true,
  credentialsEncrypted: true,
  settings: true,
  isActive: true,
} as const;

/** 呼叫 Meta 需要的渠道資料（交易內讀出、交易外使用） */
export interface CommentChannelHandle {
  id: string;
  channelType: string;
  displayName: string;
  accountId: string;
  credentials: Record<string, unknown>;
  appMode: 'platform' | 'own_app';
  /** 平台模式的 FB 渠道用平台 App Secret 算 appsecret_proof；自備 App 用渠道自己的（外掛預設讀 credentials.appSecret） */
  appSecret: string | undefined;
  /** 平台模式用平台 App ID 查 debug_token；自備 App 由外掛讀 credentials.appId */
  appId: string | undefined;
  ext: ChannelCommentExtension;
  receiving: boolean;
  settingsCommentReply: Record<string, unknown>;
}

function handleOf(channel: {
  id: string;
  channelType: string;
  displayName: string;
  externalAccountId: string | null;
  credentialsEncrypted: string | null;
  settings: unknown;
}, ext: ChannelCommentExtension): CommentChannelHandle {
  const credentials = channelCredentials(channel.credentialsEncrypted);
  // 平台 Meta App 只連結 FB 粉專；IG（Instagram Login 手動權杖）一律依自己的 App（design D22 測試階段只對平台模式有意義）
  const appMode = ext.capabilities.platform === 'fb' ? appModeOf(credentials) : 'own_app';
  const cr = commentReplySettingsOf(channel.settings);
  const platformApp = appMode === 'platform' ? getMetaAppConfig() : null;
  return {
    id: channel.id,
    channelType: channel.channelType,
    displayName: channel.displayName,
    accountId: channelAccountId(channel),
    credentials,
    appMode,
    appSecret: platformApp?.appSecret,
    appId: platformApp?.appId,
    ext,
    receiving: cr.receiving,
    settingsCommentReply: cr.raw,
  };
}

/**
 * 讀一個看得到、支援留言的渠道。看不到或不存在 → 404 CHANNEL_NOT_FOUND；外掛沒有留言擴充 → 400 CHANNEL_NOT_SUPPORTED。
 * requireEdit（開關留言接收）時，只有 read_only 層級 → 403 CHANNEL_ACCESS_DENIED。
 */
export async function loadCommentChannel(
  ctx: TenantCtx,
  viewer: CommentReplyViewer,
  channelId: string,
  opts: { requireEdit?: boolean } = {},
): Promise<CommentChannelHandle> {
  const channels = await resolveViewerChannels(ctx, viewer);
  const channel = await ctx.tx.channel.findFirst({ where: { id: channelId, tenantId: ctx.tenantId }, select: channelSelect });
  const level = channel ? channelLevel(channels, channel.id) : null;
  if (!channel || !channel.isActive || level === null) throw new AppError('找不到這個渠道', 'CHANNEL_NOT_FOUND', 404);
  if (opts.requireEdit && level === 'read_only') {
    throw new AppError('你對這個渠道只有檢視權限', 'CHANNEL_ACCESS_DENIED', 403);
  }
  const ext = commentExtensionOf(channel.channelType);
  if (!ext) throw new AppError('這個渠道不支援留言自動私訊', 'CHANNEL_NOT_SUPPORTED', 400);
  return handleOf(channel, ext);
}

// ─── 前置條件（GET /readiness） ──────────────────────────────────────────

export interface ReadinessBase {
  testPhase: { fb: boolean; ig: boolean };
  capabilities: CommentReplyPlatformSettings['capabilities'];
  emergencyStopped: boolean;
  quota: { monthlyUsed: number; monthlyLimit: number | null; activeRules: number; maxRules: number | null };
  channels: Array<CommentChannelHandle & { tokenStatus: string | null; lastCommentEventAt: string | null; igPermissionMissing24h: boolean }>;
}

/** readiness 的資料庫部分：平台設定、本月用量與上限、看得到的 FB／IG 渠道 */
export async function loadReadinessBase(
  ctx: TenantCtx,
  viewer: CommentReplyViewer,
  settings: CommentReplyPlatformSettings,
  now: Date = new Date(),
): Promise<ReadinessBase> {
  const channels = await resolveViewerChannels(ctx, viewer);
  const visible = channelIdFilter(channels);
  const [usage, monthlyLimit, activeRules, maxRules, rows] = await Promise.all([
    ctx.tx.commentReplyUsage.findUnique({ where: { tenantId_month: { tenantId: ctx.tenantId, month: taipeiMonthString(now) } } }),
    getEffectiveLimit(ctx.tx, ctx.tenantId, 'monthlyCommentReplies'),
    ctx.tx.commentReplyRule.count({ where: { tenantId: ctx.tenantId, isActive: true, deletedAt: null } }),
    getEffectiveLimit(ctx.tx, ctx.tenantId, 'maxCommentReplyRules'),
    ctx.tx.channel.findMany({
      where: { tenantId: ctx.tenantId, isActive: true, ...(visible ? { id: visible } : {}) },
      select: channelSelect,
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const supported = rows
    .map((c) => ({ c, ext: commentExtensionOf(c.channelType) }))
    .filter((x): x is { c: (typeof rows)[number]; ext: ChannelCommentExtension } => x.ext !== null);

  // Instagram Login 沒有 debug_token：近 24 小時有權限不足的失敗時，提示權杖可能缺留言權限（design「其他未定細節」）
  const igIds = supported.filter((x) => x.ext.capabilities.platform === 'ig').map((x) => x.c.id);
  const igPermissionMissing = igIds.length
    ? await ctx.tx.commentReplyLog.groupBy({
        by: ['channelId'],
        where: {
          tenantId: ctx.tenantId,
          channelId: { in: igIds },
          reasonCode: { in: ['PERMISSION_MISSING', 'APP_NOT_APPROVED'] },
          updatedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        },
        _count: { _all: true },
      })
    : [];

  return {
    testPhase: settings.testPhase,
    capabilities: settings.capabilities,
    emergencyStopped: settings.emergencyStop.stopped,
    quota: { monthlyUsed: usage?.sentCount ?? 0, monthlyLimit, activeRules, maxRules },
    channels: supported.map(({ c, ext }) => ({
      ...handleOf(c, ext),
      tokenStatus: tokenStatusOf(c.settings),
      lastCommentEventAt: commentReplySettingsOf(c.settings).lastCommentEventAt,
      igPermissionMissing24h: igPermissionMissing.some((g) => g.channelId === c.id),
    })),
  };
}

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
      let missingPermissions = status.missingPermissions;
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

// ─── 留言接收開關（POST／DELETE /channels/:id/subscribe-comments） ─────────

/** 開啟或關閉留言接收時送給 Meta 的完整欄位（POST subscribed_apps 是整份取代，design D19） */
export function commentSubscriptionFields(channel: Pick<CommentChannelHandle, 'ext'>, receiving: boolean): string[] {
  if (channel.ext.capabilities.platform === 'ig') {
    return receiving ? [...IG_BASE_SUBSCRIBED_FIELDS, IG_COMMENT_FIELD] : [...IG_BASE_SUBSCRIBED_FIELDS];
  }
  return subscribedFieldsFor({ commentReply: { receiving } });
}

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

/** 訂閱成功後寫入渠道 settings.commentReply（保留其他子鍵，例如 lastCommentEventAt） */
export async function saveCommentSubscription(
  ctx: TenantCtx,
  channel: CommentChannelHandle,
  receiving: boolean,
  fields: string[],
  now: Date = new Date(),
): Promise<void> {
  const at = now.toISOString();
  await patchChannelSettings(ctx.tx, channel.id, ctx.tenantId, {
    commentReply: {
      ...channel.settingsCommentReply,
      receiving,
      ...(receiving ? { subscribedAt: at } : {}),
      subscription: { status: receiving ? 'ok' : 'disabled', fields, checkedAt: at },
    },
  });
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
    page = await channel.ext.listRecentPosts({ ...channel.credentials, pageId: channel.accountId || channel.credentials.pageId }, cursor);
  } catch (err) {
    throw postsUnavailable(err);
  }
  const result = { posts: page.posts.map(toPostView), nextCursor: page.nextCursor };
  await redis?.set(key, JSON.stringify(result), 'EX', POSTS_CACHE_SECONDS).catch(() => undefined);
  return result;
}

/** 貼文網址換貼文（交易外）。只經外掛呼叫 Graph API，不對使用者網址發出請求；找不到 → 404 POST_NOT_FOUND */
export async function resolvePostUrlMeta(channel: CommentChannelHandle, url: string): Promise<PostView> {
  let post: RecentPost | null;
  try {
    post = await channel.ext.resolvePostUrl(url, { ...channel.credentials, pageId: channel.accountId || channel.credentials.pageId });
  } catch (err) {
    throw postsUnavailable(err);
  }
  if (!post) throw new AppError('找不到這篇貼文，請確認網址屬於這個粉專或帳號', 'POST_NOT_FOUND', 404);
  return toPostView(post);
}

export { BASE_SUBSCRIBED_FIELDS };
