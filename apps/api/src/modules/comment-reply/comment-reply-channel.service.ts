/**
 * 留言自動私訊的渠道端資料庫部分：讀渠道、前置條件的資料庫部分、寫入留言接收狀態
 * （change add-comment-keyword-private-reply design「API」、D19、D22、D25；spec comment-reply-meta-subscription）。
 *
 * service 只讀寫資料庫（收 TenantCtx）。呼叫 Meta 與使用 Redis 的函式在 comment-reply-meta.ts，
 * flow 在交易外呼叫它們（design D1：Meta 呼叫一律在交易外）。外掛差異一律經 extensions.comments（結構規則 5）。
 */
import type { ChannelCommentExtension } from '@open333crm/channel-plugins';
import { taipeiMonthString } from '@open333crm/core';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { AppError } from '../../shared/utils/response.js';
import { patchChannelSettings } from '../channel/channel.service.js';
import { BASE_SUBSCRIBED_FIELDS, getMetaAppConfig, subscribedFieldsFor } from '../meta-connect/meta-connect.service.js';
import { getEffectiveLimit } from '../platform/plan-limits.service.js';
import {
  channelAccountId,
  channelCredentials,
  channelIdFilter,
  channelLevel,
  commentAppModeOf,
  commentExtensionOf,
  resolveViewerChannels,
  tokenStatusOf,
  type CommentReplyViewer,
} from './comment-reply-access.js';
import type { CommentReplyPlatformSettings } from './comment-reply-platform-settings.js';
import { commentReplySettingsOf, nextCommentReplySettings } from './comment-reply-settings.js';

/** IG 開啟留言接收時的欄位（Instagram Login 的 me/subscribed_apps）；關閉時只留 messages */
export const IG_BASE_SUBSCRIBED_FIELDS: readonly string[] = ['messages'];
export const IG_COMMENT_FIELD = 'comments';

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
  const appMode = commentAppModeOf(ext, credentials);
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

// ─── 留言接收開關（POST／DELETE /channels/:id/subscribe-comments） ─────────

/** 開啟或關閉留言接收時送給 Meta 的完整欄位（POST subscribed_apps 是整份取代，design D19） */
export function commentSubscriptionFields(channel: Pick<CommentChannelHandle, 'ext'>, receiving: boolean): string[] {
  if (channel.ext.capabilities.platform === 'ig') {
    return receiving ? [...IG_BASE_SUBSCRIBED_FIELDS, IG_COMMENT_FIELD] : [...IG_BASE_SUBSCRIBED_FIELDS];
  }
  return subscribedFieldsFor({ commentReply: { receiving } });
}

/** 訂閱成功後寫入渠道 settings.commentReply（形狀與規則見 comment-reply-settings.ts） */
export async function saveCommentSubscription(
  ctx: TenantCtx,
  channel: CommentChannelHandle,
  receiving: boolean,
  fields: string[],
  now: Date = new Date(),
): Promise<void> {
  await patchChannelSettings(ctx.tx, channel.id, ctx.tenantId, {
    commentReply: nextCommentReplySettings({ commentReply: channel.settingsCommentReply }, receiving, fields, now),
  });
}

export { BASE_SUBSCRIBED_FIELDS };
