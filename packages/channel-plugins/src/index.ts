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

  /** Optional channel-specific capability extensions */
  readonly extensions?: {
    ui?: ChannelUiExtension;
    audience?: ChannelAudienceExtension;
    analytics?: ChannelAnalyticsExtension;
  };
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

/** @deprecated Use Record<string, unknown> directly */
export interface ChannelCredentials {
  [key: string]: string;
}

// ── Plugin Registry ───────────────────────────────────────────────

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

export { TelegramPlugin } from './telegram/index.js';
export { FbPlugin, fbPlugin } from './facebook/index.js';
export { ThreadsPlugin, threadsPlugin }  from './threads.js';
export {
  LinePlugin,
  linePlugin,
  buildLineMessage,
  LINE_DELIVERY_METADATA_KEYS,
  LINE_RETRY_KEY_TTL_MS,
  isLineRetryKeyExpired,
} from './line/index.js';
export type { LineDeliveryStatus } from './line/index.js';
export { WebchatPlugin, webchatPlugin } from './webchat/index.js';
