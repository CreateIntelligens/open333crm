// ─────────────────────────────────────────
// @open333crm/types — Shared type definitions
// ─────────────────────────────────────────

// ── Channel ──────────────────────────────

export type ChannelType = 'LINE' | 'FB' | 'WEBCHAT' | 'WHATSAPP';

export interface ChannelConfig {
  id: string;
  tenantId: string;
  channelType: ChannelType;
  displayName: string;
  isActive: boolean;
  credentialsEncrypted: string;
  settings: ChannelSettings;
  webhookUrl?: string;
}

export interface ChannelSettings {
  botEnabled?: boolean;
  botMode?: 'keyword' | 'llm' | 'keyword_then_llm' | 'off';
  welcomeMessage?: string;
  offlineMessage?: string;
  handoffMessage?: string;
  maxBotRepliesBeforeHandoff?: number;
  officeHours?: OfficeHours;
}

export interface OfficeHours {
  timezone: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  holidays?: string[];
}

// ── Universal Message ─────────────────────

export type MessageContentType =
  | 'text' | 'image' | 'video' | 'audio' | 'file'
  | 'location' | 'sticker' | 'flex' | 'template'
  | 'quick_reply' | 'postback' | 'unknown';

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

// ── Contact ──────────────────────────────

export interface ContactProfile {
  uid: string;
  displayName: string;
  pictureUrl?: string;
  language?: string;
}

// ── Case ─────────────────────────────────

export type CaseStatus =
  | 'OPEN' | 'IN_PROGRESS' | 'PENDING'
  | 'RESOLVED' | 'ESCALATED' | 'CLOSED';

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

// ── License ───────────────────────────────

export interface LicenseFeatures {
  channels: {
    line: boolean;
    fb: boolean;
    webchat: boolean;
    whatsapp: boolean;
  };
  ai: {
    llmSuggestReply: boolean;
    imageGeneration: boolean;
    sentimentAnalysis: boolean;
    autoClassify: boolean;
  };
  caseManagement: {
    enabled: boolean;
    sla: boolean;
    escalation: boolean;
  };
  marketing: {
    broadcast: boolean;
    maxBroadcastPerMonth: number;
  };
  contacts: {
    maxContacts: number;
  };
  [key: string]: unknown;
}

export interface LicenseCredits {
  llmTokens: CreditInfo;
  imageGen: CreditInfo;
  broadcastMessages: CreditInfo;
}

export interface CreditInfo {
  remaining: number;
  total: number;
  unit: string;
  resetPolicy: 'never' | 'monthly';
}

export interface RemoteServiceConfig {
  provider: string;
  model: string;
  endpoint: string;
  apiKey: string;
  maxTokensPerRequest?: number;
}
