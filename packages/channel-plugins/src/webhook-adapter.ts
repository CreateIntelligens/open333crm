/**
 * Webhook-level channel plugin interface.
 *
 * This interface is used by apps/api for HTTP webhook processing and message delivery.
 * It returns ParsedWebhookMessage (a flat, content-typed structure) rather than
 * UniversalMessage (the richer normalized type used by the package's full ChannelPlugin).
 *
 * Long-term, callers can migrate to the main ChannelPlugin interface with UniversalMessage.
 */

// ── Types ─────────────────────────────────────────────────────────

export interface ParsedWebhookMessage {
  channelMsgId?: string;
  contactUid: string;
  timestamp: Date;
  contentType: string;
  content: Record<string, unknown>;
  rawPayload?: unknown;
}

export interface OutboundPayload {
  contentType: string;
  content: Record<string, unknown>;
}

export interface ChannelPlugin {
  readonly channelType: string;

  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): boolean;

  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<ParsedWebhookMessage[]>;

  getProfile(
    uid: string,
    credentials: Record<string, unknown>,
  ): Promise<{ uid: string; displayName: string; avatarUrl?: string }>;

  sendMessage(
    to: string,
    message: OutboundPayload,
    credentials: Record<string, unknown>,
  ): Promise<{ success: boolean; channelMsgId?: string; error?: string }>;
}

// ── Registry ─────────────────────────────────────────────────────

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

// ── Plugin instances ──────────────────────────────────────────────

export { linePlugin } from './adapters/line-webhook.js';
export { fbPlugin } from './adapters/fb-webhook.js';
export { webchatPlugin } from './adapters/webchat-webhook.js';
