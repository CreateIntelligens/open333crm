import { IngestMessage } from '../inbox/inbox-service';

export interface ChannelAdapter {
  /**
   * Universal method to send a message to the channel
   */
  send(message: {
    recipientUid: string;
    contentType: string;
    content: any;
    tenantId: string;
  }): Promise<{ channelMsgId: string }>;

  /**
   * Handle raw webhook payload and transform it into standard IngestMessage format
   */
  handleWebhook(payload: any): Promise<IngestMessage[]>;

  /**
   * Get channel-specific metadata or status
   */
  getMetadata?(): Promise<any>;
}
