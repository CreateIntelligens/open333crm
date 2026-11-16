// Channel Plugin interface — all channel adapters implement this

import type { ChannelType } from '@open333crm/types';

// ── Webhook types ─────────────────────────────────────────────────

export interface ParsedWebhookMessage {
  channelMsgId?: string;
  contactUid: string;
  timestamp: Date;
  contentType: string;
  content: Record<string, unknown>;
  rawPayload?: unknown;
  /**
   * FB m.me / IG ig.me 連結帶的 `?ref=` 值（referral 事件，或夾在訊息／postback 內的 referral）。
   * 跨渠道綁定代碼由此送達（change add-cross-channel-one-id）。
   * contentType 為 'referral' 的事件只帶這個值、沒有訊息內容。
   */
  referralRef?: string;
  /**
   * 事件所屬的平台帳號 ID（FB／IG webhook 的 `entry.id`：粉專 ID／IG 專業帳號 ID）。
   * 同一個 Meta App 可能服務多個粉專，入站管線依此找出真正的渠道與租戶，
   * 不可只看 webhook 網址上的 channelId（change fix-meta-webhook-page-routing）。
   */
  accountId?: string;
}

export interface OutboundPayload {
  contentType: string;
  content: Record<string, unknown>;
  delivery?: {
    strategy?: 'reply' | 'push';
    replyToken?: string;
    receivedAt?: string;
    retryKey?: string;
  };
  /**
   * 同一次請求接著送出的其他訊息（依序顯示）。只有 maxMessagesPerSend 大於 1 的渠道會收到，
   * 例如附券廣播的「素材＋發券文字」在 LINE 以一次推送送出，兩則同時成功或失敗（add-coupon-system design D29）
   */
  extraMessages?: Array<{ contentType: string; content: Record<string, unknown> }>;
}

/** Callback injected by the API layer to handle file storage. */
export type MediaUploadFn = (
  buffer: Buffer,
  filename: string,
  mimeType: string,
) => Promise<{ url: string; key: string }>;

// ── Base Interface ────────────────────────────────────────────────

export interface ChannelPlugin {
  readonly channelType: string;
  /**
   * 訊息視窗（小時）：只能對這段時間內傳過訊息的人主動發一般訊息（Meta 的 24 小時規則）。
   * 沒有限制的渠道不設定。群發依此略過視窗外的人。
   */
  readonly messagingWindowHours?: number;
  /**
   * 一次請求最多能送幾則訊息（含 payload 本身與 extraMessages）。沒有設定視為 1：
   * 多則訊息要分次呼叫 sendMessage。
   */
  readonly maxMessagesPerSend?: number;

  /** Verify incoming webhook signature */
  verifySignature(rawBody: Buffer, headers: Record<string, string>, secret: string): boolean;

  /** Parse raw webhook payload into ParsedWebhookMessages */
  parseWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<ParsedWebhookMessage[]>;

  /** Fetch contact profile from the channel */
  getProfile(uid: string, credentials: Record<string, unknown>): Promise<{ uid: string; displayName: string; avatarUrl?: string }>;

  /** Send a message to a contact */
  sendMessage(to: string, message: OutboundPayload, credentials: Record<string, unknown>): Promise<{
    success: boolean;
    channelMsgId?: string;
    requestId?: string;
    error?: string;
  }>;

  /** Set webhook URL on the channel (for auto-setup) */
  setWebhook?(webhookUrl: string, credentials: Record<string, unknown>): Promise<void>;

  /**
   * Resolve inbound media that cannot be served directly from the webhook payload.
   * Called non-blocking after the Message is written to DB.
   * Return null when no resolution is needed (e.g. URL already present).
   * 下載失敗或不能下載時拋出錯誤；錯誤訊息是給客服看的中文原因，
   * 呼叫端會寫進 `content.mediaError` 並顯示在收件匣。
   */
  resolveInboundMedia?(
    content: Record<string, unknown>,
    contentType: string,
    credentials: Record<string, unknown>,
    uploadFn: MediaUploadFn,
  ): Promise<{ url: string; storageKey: string } | null>;

  /**
   * 滿意度問卷的訊息（issue #339 決定 7）：只有客人能在這個渠道直接點選分數的外掛才實作，目前只有 LINE。
   * csat 模組依有沒有這個方法決定寄不寄問卷，不比對 channelType（AGENTS.md 結構規則 5）；
   * 沒有實作的渠道不寄問卷，工單停在已解決。
   */
  buildCsatSurvey?(input: CsatSurveyInput): OutboundPayload;

  /** Optional channel-specific capability extensions */
  readonly extensions?: {
    ui?: ChannelUiExtension;
    audience?: ChannelAudienceExtension;
    analytics?: ChannelAnalyticsExtension;
    /**
     * 貼文留言：解析留言事件、私訊留言者（Private Replies）、公開回覆（change add-comment-keyword-private-reply，design D5）。
     * 呼叫端以「這個擴充存在與否＋capabilities」判斷渠道支不支援留言，不比對 channelType（AGENTS.md 結構規則 5）。
     */
    comments?: ChannelCommentExtension;
  };
}

/** 滿意度問卷的內容：問題與每個分數選項（點選後送回的 postback 與客人看到的文字） */
export interface CsatSurveyInput {
  question: string;
  options: Array<{ label: string; postbackData: string; displayText: string }>;
}

// ── Plugin Extensions ─────────────────────────────────────────────

/** Rich Menu / Channel UI management (LINE, etc.) */
export interface ChannelUiExtension {
  upsertMenu(menuConfig: unknown, credentials: Record<string, unknown>): Promise<string>;
  getMenu(menuId: string, credentials: Record<string, unknown>): Promise<unknown>;
  listMenus(credentials: Record<string, unknown>): Promise<unknown[]>;
  deleteMenu(menuId: string, credentials: Record<string, unknown>): Promise<void>;
  setDefaultMenu(menuId: string, credentials: Record<string, unknown>): Promise<void>;
  cancelDefaultMenu(credentials: Record<string, unknown>): Promise<void>;
  linkMenuToUser(uid: string, menuId: string, credentials: Record<string, unknown>): Promise<void>;
  unlinkMenuFromUser(uid: string, credentials: Record<string, unknown>): Promise<void>;
  linkMenuToUsers(uids: string[], menuId: string, credentials: Record<string, unknown>): Promise<void>;
  unlinkMenuFromUsers(uids: string[], credentials: Record<string, unknown>): Promise<void>;
  getUserMenu(uid: string, credentials: Record<string, unknown>): Promise<string | null>;
  uploadMenuImage(menuId: string, imageBuffer: Buffer, contentType: string, credentials: Record<string, unknown>): Promise<void>;
  createMenuAlias(aliasId: string, menuId: string, credentials: Record<string, unknown>): Promise<void>;
  updateMenuAlias(aliasId: string, menuId: string, credentials: Record<string, unknown>): Promise<void>;
  deleteMenuAlias(aliasId: string, credentials: Record<string, unknown>): Promise<void>;
}

/** Audience Group management for Narrowcast (LINE, etc.) */
export interface ChannelAudienceExtension {
  syncAudience(audienceId: string, uids: string[], credentials: Record<string, unknown>): Promise<string>;
  createInteractionAudience(requestId: string, type: 'click' | 'imp', credentials: Record<string, unknown>): Promise<string>;
  addUsersToAudience(audienceGroupId: string, uids: string[], credentials: Record<string, unknown>): Promise<void>;
  deleteAudience(audienceGroupId: string, credentials: Record<string, unknown>): Promise<void>;
  getNarrowcastProgress(requestId: string, credentials: Record<string, unknown>): Promise<{ phase: string; successCount?: number; errorCount?: number }>;
  cancelNarrowcast(requestId: string, credentials: Record<string, unknown>): Promise<void>;
}

/** Platform Insight / Analytics (LINE, etc.) */
export interface ChannelAnalyticsExtension {
  getFollowerStats(date: string, credentials: Record<string, unknown>): Promise<{ followers: number; blocks: number; targetedReaches?: number }>;
  getDemographics(credentials: Record<string, unknown>): Promise<unknown>;
  getDeliveryStats(requestId: string, credentials: Record<string, unknown>): Promise<{ delivered?: number; read?: number; clicked?: number }>;
  getMessageQuota(credentials: Record<string, unknown>): Promise<{ totalUsage: number; maxMessages?: number }>;
}

// ── 留言擴充（change add-comment-keyword-private-reply，design「外掛契約」）────────────

/** 一則留言事件（外掛已排除：自己帳號的留言、非新增／刪除事件、直播留言） */
export interface ParsedCommentEvent {
  /** add：新留言；remove：顧客刪除留言（只有 FB 會送） */
  kind: 'add' | 'remove';
  /** 事件所屬帳號（webhook entry.id：粉專 ID／IG 專業帳號 ID），分派渠道與租戶用 */
  accountId: string;
  commentId: string;
  /** FB：`{pageId}_{postId}`；IG：media id */
  postId: string;
  /** 對另一則留言的回覆時是那則留言的 ID；FB parent_id 等於 post_id 時不填 */
  parentId?: string;
  /** FB：feed 的 from.id（不保證等於 PSID，待實測 M1）；IG：IGSID。FB 的 remove 事件缺 from 時為空字串 */
  commenterId: string;
  /** FB from.name */
  commenterName?: string;
  /** IG from.username */
  commenterUsername?: string;
  /** 留言內容；remove 事件為空字串 */
  text: string;
  /** 留言建立時間；平台沒有提供時用通知時間（IG 用 entry.time） */
  createdAt: Date;
  createdAtSource: 'comment' | 'notification';
  /** 廣告貼文的留言（IG media.ad_id；FB 文件未載明） */
  adId?: string;
}

export interface CommentReplyCapabilities {
  /** 對應平台的能力開關與測試階段旗標 */
  platform: 'fb' | 'ig';
  /** 私訊可用的 contentType。IG：['text'] */
  privateReplyContentTypes: readonly string[];
  /** 是否支援公開回覆留言 */
  publicReply: boolean;
  /** 素材庫的 channelType（FB：'fb'；IG：null＝沒有素材） */
  materialChannelType: string | null;
  /** 貼文挑選畫面開啟貼文連結的文字，例如「在 Facebook 開啟」 */
  postLinkLabel: string;
}

/**
 * 正規化後的 Meta 錯誤原因。comment-reply 模組的狀態原因代碼（packages/shared，design D8）必須涵蓋這些值。
 * APP_NOT_APPROVED 不在這裡：由 comment-reply 模組依測試階段旗標從 PERMISSION_MISSING 轉換。
 */
export type CommentReplyErrorReason =
  | 'TOKEN_EXPIRED'
  | 'PERMISSION_MISSING'
  | 'USER_UNAVAILABLE'
  | 'COMMENT_NOT_FOUND'
  | 'ALREADY_REPLIED'
  | 'EXPIRED_BY_META'
  | 'RECIPIENT_IS_PAGE'
  | 'RATE_LIMITED'
  | 'MATERIAL_UNSUPPORTED'
  | 'NETWORK'
  | 'UNKNOWN';

export interface MetaErrorInfo {
  code?: number;
  subcode?: number;
  traceId?: string;
  /** Meta 的原始錯誤訊息（給「技術資訊」區） */
  message: string;
  reason: CommentReplyErrorReason;
  /** 是否值得自動重試（網路、5xx、限流） */
  transient: boolean;
  /** 限流時 Meta 估計的恢復時間（毫秒），來自 X-Business-Use-Case-Usage */
  retryAfterMs?: number;
}

export type CommentSendResult =
  | { ok: true; recipientId: string; messageId: string }
  | { ok: false; error: MetaErrorInfo };

export type CommentReplyResult = { ok: true; replyId: string } | { ok: false; error: MetaErrorInfo };

export interface RecentPost {
  postId: string;
  permalink: string | null;
  thumbnailUrl: string | null;
  excerpt: string;
  mediaType: 'text' | 'image' | 'carousel' | 'video' | 'reels';
  publishedAt: Date;
}

export interface CommentSubscriptionStatus {
  /** null＝無法查詢（查詢失敗，或平台不提供查詢方式） */
  subscribed: boolean | null;
  /** null＝無法得知（IG 沒有 debug_token，或查詢失敗） */
  missingPermissions: string[] | null;
  /** 權限未知時為 null */
  canPrivateReply: boolean | null;
  canPublicReply: boolean | null;
}

/**
 * 憑證（credentials）沿用渠道的解密憑證。FB 平台模式渠道的憑證沒有 App Secret：需要 appsecret_proof 的呼叫
 * （subscribeFields、getSubscriptionStatus）由呼叫端以 ctx.appSecret 傳入平台 App Secret；自備 App 的渠道
 * 不傳時用 credentials.appSecret。
 */
export interface ChannelCommentExtension {
  readonly capabilities: CommentReplyCapabilities;
  /** 解析留言事件；壞掉的 payload 回空陣列、不丟錯 */
  parseCommentEvents(rawBody: Buffer): ParsedCommentEvent[];
  /** 手動輸入的貼文 ID 或網址離線正規化成留言事件的 postId 格式；無法辨識回 null。不發任何網路請求 */
  parsePostReference(input: string, ctx: { accountId: string }): string | null;
  /** 私訊留言者；Meta 錯誤以 { ok: false, error } 回傳、不丟錯 */
  sendPrivateReply(commentId: string, message: OutboundPayload, credentials: Record<string, unknown>): Promise<CommentSendResult>;
  /** 公開回覆留言；Meta 錯誤以 { ok: false, error } 回傳、不丟錯 */
  replyToComment(commentId: string, text: string, credentials: Record<string, unknown>): Promise<CommentReplyResult>;
  /** 最近貼文；Graph API 失敗丟 MetaApiError */
  listRecentPosts(credentials: Record<string, unknown>, cursor?: string): Promise<{ posts: RecentPost[]; nextCursor: string | null }>;
  /** 貼文網址換貼文。只呼叫 Graph API，不 fetch 使用者網址；找不到回 null，其他 Graph API 失敗丟 MetaApiError */
  resolvePostUrl(url: string, credentials: Record<string, unknown>): Promise<RecentPost | null>;
  /** 查訂閱與權限狀態；查不到時對應欄位為 null，不丟錯 */
  getSubscriptionStatus(
    credentials: Record<string, unknown>,
    ctx: { accountId: string; appId?: string; appSecret?: string },
  ): Promise<CommentSubscriptionStatus>;
  /**
   * 設定訂閱欄位。`POST subscribed_apps` 是整份取代：fields 必須是完整清單（含 messaging 欄位），外掛原樣送出。
   * 失敗丟 MetaApiError（info.reason 為 PERMISSION_MISSING／TOKEN_EXPIRED 時路由回 409，其他回 502）。
   */
  subscribeFields(
    credentials: Record<string, unknown>,
    ctx: { accountId: string; fields: string[]; appSecret?: string },
  ): Promise<void>;
}

/** @deprecated Use Record<string, unknown> directly */
export interface ChannelCredentials {
  [key: string]: string;
}

// ── Plugin Registry ───────────────────────────────────────────────

/**
 * workers 執行自動化與關鍵字規則時送得到的渠道（`apps/workers/src/lib/plugin-registry.ts` 依此註冊外掛）。
 * API 判斷關鍵字規則能否回覆、AI 要不要讓步時也用這份清單，兩邊才不會不一致。
 * 沒有 WEBCHAT：訪客的即時推送不在 workers 的送出路徑（AUDIT CHAN-02）。
 */
export const AUTOMATION_DELIVERY_CHANNEL_TYPES: readonly string[] = ['LINE', 'FB', 'THREADS'];

const plugins = new Map<string, ChannelPlugin>();

export function registerChannelPlugin(plugin: ChannelPlugin): void {
  plugins.set(plugin.channelType, plugin);
}

export function getChannelPlugin(channelType: string): ChannelPlugin | undefined {
  return plugins.get(channelType);
}

export function getAllChannelPlugins(): ChannelPlugin[] {
  return Array.from(plugins.values());
}

export function hasChannelPlugin(channelType: string): boolean {
  return plugins.has(channelType);
}

/** @deprecated Use registerChannelPlugin */
export const registerPlugin = registerChannelPlugin;
/** @deprecated Use getChannelPlugin (returns undefined instead of throwing) */
export function getPlugin(channelType: ChannelType): ChannelPlugin {
  const plugin = plugins.get(channelType);
  if (!plugin) throw new Error(`No plugin registered for channel: ${channelType}`);
  return plugin;
}

// ── Exports ───────────────────────────────────────────────────────

export { TelegramPlugin } from './telegram.js';
export { FbPlugin, fbPlugin } from './facebook/index.js';
export type { FbPluginOptions } from './facebook/index.js';
export { findSitePathUrl, isSitePath, resolveSitePathUrls } from './site-path-urls.js';
export { MetaApiError } from './meta-graph.js';
export { ThreadsPlugin, threadsPlugin }  from './threads.js';
export {
  LinePlugin,
  linePlugin,
  buildLineMessage,
  LineMessageBuildError,
  LINE_DELIVERY_METADATA_KEYS,
  LINE_RETRY_KEY_TTL_MS,
  isLineRetryKeyExpired,
} from './line/index.js';
export type { LineDeliveryStatus } from './line/index.js';
export { WebchatPlugin, webchatPlugin } from './webchat/index.js';
