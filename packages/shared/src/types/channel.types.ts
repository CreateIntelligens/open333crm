export type ChannelType = 'LINE' | 'FB' | 'WEBCHAT' | 'WHATSAPP';

export type MessageContentType =
  | 'text' | 'image' | 'video' | 'audio' | 'file'
  | 'location' | 'sticker'
  | 'flex' | 'template' | 'quick_reply' | 'postback'
  | 'unknown';

export interface MessageContent {
  text?: string;
  mediaUrl?: string;
  templateData?: Record<string, unknown>;
  flexJson?: Record<string, unknown>;
  postbackData?: string;
  quickReplies?: QuickReply[];
}

export interface QuickReply {
  label: string;
  text?: string;
  postbackData?: string;
  imageUrl?: string;
}

export interface UniversalMessage {
  id: string;
  channelType: ChannelType;
  channelId: string;
  direction: 'inbound' | 'outbound';
  contactUid: string;
  timestamp: Date;
  messageType: MessageContentType;
  content: MessageContent;
  rawPayload?: unknown;
}

export interface ContactProfile {
  uid: string;
  displayName: string;
  avatarUrl?: string;
  language?: string;
}

export interface ChannelCredentials {
  [key: string]: unknown;
}

export interface OutboundMessage {
  messageType: MessageContentType;
  content: MessageContent;
}

export interface SendResult {
  success: boolean;
  channelMsgId?: string;
  error?: string;
}
