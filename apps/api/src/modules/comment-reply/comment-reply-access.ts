/**
 * 留言自動私訊後台 API 的檢視者與渠道可見範圍（change add-comment-keyword-private-reply design「API」：
 * 清單依渠道可見範圍過濾；看不到的資源回 404；只有 read_only 層級時不可編輯）。
 *
 * route 從 request 算出 CommentReplyViewer（有效權限＝角色權限 ∩ 方案天花板）交給 flow；
 * service 在交易內以 resolveViewerChannels() 取得可見渠道與層級，不讀 request。
 */
import type { ChannelPlugin, ChannelCommentExtension } from '@open333crm/channel-plugins';
import { getChannelPlugin } from '@open333crm/channel-plugins';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import {
  ALL_CHANNELS,
  getAccessibleChannelLevels,
  levelMeets,
  type ChannelAccessLevel,
} from '../../services/channel-visibility.js';
import { decryptCredentials } from '../channel/channel.service.js';

export interface CommentReplyViewer {
  agentId: string;
  /** 總店（channel.view_all）：看得到全部渠道、層級 full */
  hasViewAll: boolean;
  /** comment_reply.manage：規則 canEdit 的前提 */
  canManage: boolean;
  /** inbox.view：紀錄詳情是否回傳 conversationId */
  canViewInbox: boolean;
}

/** 檢視者看得到的渠道：ALL_CHANNELS（總店）或「渠道 → 層級」 */
export type ViewerChannels = typeof ALL_CHANNELS | Map<string, ChannelAccessLevel>;

export async function resolveViewerChannels(ctx: TenantCtx, viewer: CommentReplyViewer): Promise<ViewerChannels> {
  if (viewer.hasViewAll) return ALL_CHANNELS;
  return getAccessibleChannelLevels(ctx.tx, { tenantId: ctx.tenantId, agentId: viewer.agentId });
}

/** 檢視者對渠道的層級；看不到回 null */
export function channelLevel(channels: ViewerChannels, channelId: string): ChannelAccessLevel | null {
  if (channels === ALL_CHANNELS) return 'full';
  return channels.get(channelId) ?? null;
}

/** 檢視者能否編輯這個渠道的規則：有 manage，且層級至少 reply_only（read_only 只能看） */
export function canEditChannel(channels: ViewerChannels, viewer: CommentReplyViewer, channelId: string): boolean {
  const level = channelLevel(channels, channelId);
  return viewer.canManage && level !== null && levelMeets(level, 'reply_only');
}

/** Prisma where 的 channelId 條件；總店回 undefined（不加條件），空集合回 `{ in: [] }`（fail-closed） */
export function channelIdFilter(channels: ViewerChannels): { in: string[] } | undefined {
  return channels === ALL_CHANNELS ? undefined : { in: [...channels.keys()] };
}

/** 渠道外掛的留言擴充；沒有表示這個渠道類型不支援留言自動私訊（結構規則 5：不比對 channelType） */
export function commentExtensionOf(channelType: string): ChannelCommentExtension | null {
  const plugin: ChannelPlugin | undefined = getChannelPlugin(channelType);
  return plugin?.extensions?.comments ?? null;
}

/** 解密渠道憑證；壞掉的憑證回空物件（呼叫 Meta 時會得到權杖錯誤） */
export function channelCredentials(credentialsEncrypted: string | null | undefined): Record<string, unknown> {
  if (!credentialsEncrypted) return {};
  try {
    return decryptCredentials(credentialsEncrypted);
  } catch {
    return {};
  }
}

/** 留言事件的 accountId（粉專 ID／IG 帳號 ID）：渠道的 externalAccountId，舊渠道退回憑證的 pageId */
export function channelAccountId(channel: { externalAccountId: string | null; credentialsEncrypted?: string | null }): string {
  if (channel.externalAccountId) return channel.externalAccountId;
  const creds = channelCredentials(channel.credentialsEncrypted);
  return creds.pageId ? String(creds.pageId) : '';
}

/** 平台模式（平台 Meta App 連結的 FB 粉專）或自備 App／IG 手動權杖 */
export function appModeOf(credentials: Record<string, unknown>): 'platform' | 'own_app' {
  return credentials.connectMode === 'platform' ? 'platform' : 'own_app';
}

function obj(v: unknown): Record<string, any> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

/** 渠道 settings.commentReply（design D19） */
export function commentReplySettingsOf(settings: unknown): {
  receiving: boolean;
  subscription: { status: string | null; fields: string[]; checkedAt: string | null } | null;
  lastCommentEventAt: string | null;
  raw: Record<string, any>;
} {
  const cr = obj(obj(settings).commentReply);
  const sub = cr.subscription ? obj(cr.subscription) : null;
  return {
    receiving: cr.receiving === true,
    subscription: sub
      ? {
          status: typeof sub.status === 'string' ? sub.status : null,
          fields: Array.isArray(sub.fields) ? sub.fields.map(String) : [],
          checkedAt: typeof sub.checkedAt === 'string' ? sub.checkedAt : null,
        }
      : null,
    lastCommentEventAt: typeof cr.lastCommentEventAt === 'string' ? cr.lastCommentEventAt : null,
    raw: cr,
  };
}

/** 權杖狀態（meta-token-health 寫入的 settings.tokenHealth.status） */
export function tokenStatusOf(settings: unknown): string | null {
  const s = obj(obj(settings).tokenHealth).status;
  return typeof s === 'string' ? s : null;
}
