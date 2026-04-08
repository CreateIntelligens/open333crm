import type { ChannelPlugin, ParsedWebhookMessage, OutboundPayload } from '../webhook-adapter.js';

export class WebchatPlugin implements ChannelPlugin {
  readonly channelType = 'WEBCHAT';

  verifySignature(
    _rawBody: Buffer,
    _headers: Record<string, string>,
    _secret: string,
  ): boolean {
    // Webchat messages are received via Socket.IO or our own API,
    // so signature verification is handled by JWT auth.
    return true;
  }

  async parseWebhook(
    rawBody: Buffer,
    _headers: Record<string, string>,
  ): Promise<ParsedWebhookMessage[]> {
    const body = JSON.parse(rawBody.toString());

    return [
      {
        channelMsgId: body.messageId,
        contactUid: body.contactUid ?? body.visitorId ?? '',
        timestamp: new Date(body.timestamp ?? Date.now()),
        contentType: body.contentType ?? 'text',
        content: {
          text: body.text ?? body.content?.text ?? '',
          ...(body.content ?? {}),
        },
        rawPayload: body,
      },
    ];
  }

  async getProfile(
    uid: string,
    _credentials: Record<string, unknown>,
  ): Promise<{ uid: string; displayName: string; avatarUrl?: string }> {
    return {
      uid,
      displayName: `Visitor ${uid.slice(-6)}`,
      avatarUrl: undefined,
    };
  }

  async sendMessage(
    to: string,
    message: OutboundPayload,
    _credentials: Record<string, unknown>,
  ): Promise<{ success: boolean; channelMsgId?: string; error?: string }> {
    console.log(`[WEBCHAT] Sending message to ${to}:`, JSON.stringify(message.content));
    return {
      success: true,
      channelMsgId: `webchat-msg-${Date.now()}`,
    };
  }
}

export const webchatPlugin = new WebchatPlugin();
