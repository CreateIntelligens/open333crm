export interface ChannelPlugin {
  readonly channelType: string;

  /**
   * Verify the webhook signature/authenticity from the channel provider.
   */
  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): boolean;

  /**
   * Parse incoming webhook payload into an array of normalized messages.
   */
  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<ParsedWebhookMessage[]>;

  /**
   * Fetch user profile from the channel provider.
   */
  getProfile(
    uid: string,
    credentials: Record<string, unknown>,
  ): Promise<{
    uid: string;
    displayName: string;
    avatarUrl?: string;
  }>;

  /**
   * Send a message to a contact via this channel.
   */
  sendMessage(
    to: string,
    message: OutboundPayload,
    credentials: Record<string, unknown>,
  ): Promise<{
    success: boolean;
    channelMsgId?: string;
    error?: string;
  }>;
}

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
