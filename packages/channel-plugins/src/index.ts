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
}

export interface ChannelCredentials {
  [key: string]: string;
}

export interface OutboundMessage {
  type: 'text' | 'flex' | 'template' | 'quick_reply';
  text?: string;
  flexJson?: Record<string, unknown>;
  quickReplies?: Array<{ label: string; text?: string; postbackData?: string }>;
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

export { plugins };

// Channel-specific plugin stubs (to be implemented)
// export { LinePlugin } from './line/index.js';
// export { FbPlugin }  from './fb/index.js';
// export { WebChatPlugin } from './webchat/index.js';
