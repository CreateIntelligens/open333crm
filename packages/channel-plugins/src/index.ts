// Channel Plugin interface — all channel adapters implement this

import type { UniversalMessage, ContactProfile, ChannelType } from '@open333crm/types';

// ── Base Interface ────────────────────────────────────────────────

export interface ChannelPlugin {
  readonly channelType: ChannelType;

  /** Verify incoming webhook signature */
  verifySignature(rawBody: Buffer, headers: Record<string, string>, secret: string): boolean;

  /** Parse raw webhook payload into UniversalMessages */
  parseWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<UniversalMessage[]>;

  /** Fetch contact profile from the channel */
  getProfile(uid: string, credentials: ChannelCredentials): Promise<ContactProfile>;

  /** Send a message to a contact */
  sendMessage(to: string, message: OutboundMessage, credentials: ChannelCredentials): Promise<SendResult>;

  /** Set webhook URL on the channel (for auto-setup) */
  setWebhook?(webhookUrl: string, credentials: ChannelCredentials): Promise<void>;

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
  upsertMenu(menuConfig: unknown, credentials: ChannelCredentials): Promise<string>;
  getMenu(menuId: string, credentials: ChannelCredentials): Promise<unknown>;
  listMenus(credentials: ChannelCredentials): Promise<unknown[]>;
  deleteMenu(menuId: string, credentials: ChannelCredentials): Promise<void>;
  setDefaultMenu(menuId: string, credentials: ChannelCredentials): Promise<void>;
  cancelDefaultMenu(credentials: ChannelCredentials): Promise<void>;
  linkMenuToUser(uid: string, menuId: string, credentials: ChannelCredentials): Promise<void>;
  unlinkMenuFromUser(uid: string, credentials: ChannelCredentials): Promise<void>;
  linkMenuToUsers(uids: string[], menuId: string, credentials: ChannelCredentials): Promise<void>;
  unlinkMenuFromUsers(uids: string[], credentials: ChannelCredentials): Promise<void>;
  getUserMenu(uid: string, credentials: ChannelCredentials): Promise<string | null>;
  uploadMenuImage(menuId: string, imageBuffer: Buffer, contentType: string, credentials: ChannelCredentials): Promise<void>;
  createMenuAlias(aliasId: string, menuId: string, credentials: ChannelCredentials): Promise<void>;
  updateMenuAlias(aliasId: string, menuId: string, credentials: ChannelCredentials): Promise<void>;
  deleteMenuAlias(aliasId: string, credentials: ChannelCredentials): Promise<void>;
}

/** Audience Group management for Narrowcast (LINE, etc.) */
export interface ChannelAudienceExtension {
  syncAudience(audienceId: string, uids: string[], credentials: ChannelCredentials): Promise<string>;
  createInteractionAudience(requestId: string, type: 'click' | 'imp', credentials: ChannelCredentials): Promise<string>;
  addUsersToAudience(audienceGroupId: string, uids: string[], credentials: ChannelCredentials): Promise<void>;
  deleteAudience(audienceGroupId: string, credentials: ChannelCredentials): Promise<void>;
  getNarrowcastProgress(requestId: string, credentials: ChannelCredentials): Promise<{ phase: string; successCount?: number; errorCount?: number }>;
  cancelNarrowcast(requestId: string, credentials: ChannelCredentials): Promise<void>;
}

/** Platform Insight / Analytics (LINE, etc.) */
export interface ChannelAnalyticsExtension {
  getFollowerStats(date: string, credentials: ChannelCredentials): Promise<{ followers: number; blocks: number; targetedReaches?: number }>;
  getDemographics(credentials: ChannelCredentials): Promise<unknown>;
  getDeliveryStats(requestId: string, credentials: ChannelCredentials): Promise<{ delivered?: number; read?: number; clicked?: number }>;
  getMessageQuota(credentials: ChannelCredentials): Promise<{ totalUsage: number; maxMessages?: number }>;
}

export interface ChannelCredentials {
  [key: string]: string;
}

export interface OutboundMessage {
  type: 'text' | 'image' | 'video' | 'audio' | 'location' | 'sticker' | 'flex' | 'imagemap' | 'template' | 'quick_reply';
  /** Sending strategy — defaults to 'push' */
  strategy?: 'reply' | 'push' | 'multicast' | 'broadcast' | 'narrowcast';
  /** Used for strategy: 'reply' */
  replyToken?: string;
  /** Used for strategy: 'multicast' — recipient user IDs */
  recipientUids?: string[];
  /** Used for strategy: 'narrowcast' — LINE audienceGroupId */
  audienceGroupId?: string;
  text?: string;
  flexJson?: Record<string, unknown>;
  imagemapJson?: Record<string, unknown>;
  templateJson?: Record<string, unknown>;
  mediaUrl?: string;
  previewUrl?: string;
  /** For video messages — enables VideoPlayComplete Webhook */
  trackingId?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  /** LINE sticker package ID */
  packageId?: string;
  /** LINE sticker ID */
  stickerId?: string;
  quickReplies?: Array<{ label: string; text?: string; postbackData?: string; imageUrl?: string }>;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// ── Plugin Registry ───────────────────────────────────────────────

const plugins = new Map<ChannelType, ChannelPlugin>();

export function registerPlugin(plugin: ChannelPlugin) {
  plugins.set(plugin.channelType, plugin);
}

export function getPlugin(channelType: ChannelType): ChannelPlugin {
  const plugin = plugins.get(channelType);
  if (!plugin) throw new Error(`No plugin registered for channel: ${channelType}`);
  return plugin;
}

// ── Exports ───────────────────────────────────────────────────────

export { TelegramPlugin } from './telegram.js';
export { ThreadsPlugin }  from './threads.js';
export { LinePlugin }     from './line/index.js';

// Channel-specific plugin stubs (to be implemented)
// export { FbPlugin }     from './fb/index.js';
// export { WebChatPlugin } from './webchat/index.js';
// export { WhatsAppPlugin } from './whatsapp/index.js';  // future
