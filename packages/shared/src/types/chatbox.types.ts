export type ChatboxMessageType = 'text' | 'image' | 'video' | 'file' | 'emoji' | 'system';

export interface ChatboxTextPayload {
  text: string;
}

export interface ChatboxMediaPayload {
  url: string;
  mimeType?: string;
  filename?: string;
  altText?: string;
  sizeBytes?: number;
}

export interface ChatboxEmojiPayload {
  emoji: string;
  label?: string;
}

export interface ChatboxSystemPayload {
  code: string;
  text?: string;
  params?: Record<string, string | number | boolean>;
}

export type ChatboxMessagePayload =
  | ChatboxTextPayload
  | ChatboxMediaPayload
  | ChatboxEmojiPayload
  | ChatboxSystemPayload;

export interface ChatboxFingerprintInput {
  browserFamily?: string;
  osFamily?: string;
  language?: string;
  timezone?: string;
  screenBucket?: string;
}

export interface ChatboxMessageInput {
  sessionId: string;
  clientMessageId: string;
  type: ChatboxMessageType;
  payload: ChatboxMessagePayload;
  locale?: string;
  sentAt?: string;
}

export interface ChatboxMessageOutput {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  senderType: 'CONTACT' | 'AGENT' | 'BOT' | 'SYSTEM';
  senderId?: string | null;
  type: ChatboxMessageType;
  payload: ChatboxMessagePayload;
  createdAt: string;
  sequence?: number | null;
  deliveryStatus?: 'pending' | 'sent' | 'failed' | 'expired';
}

export interface ChatboxThemeConfig {
  backgroundImageUrl?: string | null;
  backgroundSize?: 'cover' | 'contain';
  backgroundPosition?: string;
  foregroundColor?: string;
  accentColor?: string;
}

export interface ChatboxBootstrapConfig {
  channelId: string;
  displayName: string;
  greeting: string | null;
  theme: ChatboxThemeConfig;
}

export interface ChatboxSessionBootstrap {
  session: {
    expiresAt: string;
    lastSeenAt: string | null;
  };
  config: ChatboxBootstrapConfig;
}
