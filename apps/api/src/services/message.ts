import { ChannelType } from '@open333crm/types';
import { OutboundPayload, getChannelPlugin } from '@open333crm/channel-plugins';
import { licenseService } from './license.js';
import { logger } from '@open333crm/core';

export interface MessageMetadata {
  channelId: string;
  teamId: string;
  contactUid: string;
}

class MessageService {
  /**
   * Sends an outbound message and handles billing / usage
   */
  async sendMessage(
    metadata: MessageMetadata,
    message: OutboundPayload,
    channelType: ChannelType,
    credentials: Record<string, string>
  ): Promise<{ success: boolean; channelMsgId?: string; error?: string }> {

    // 1. Authorization check — 渠道級可見性授權已移至 route 層（channel-visibility.ts）。
    //    此 MessageService 為未接線的 mock 原型（真 outbound 走 conversation.service.ts）。

    // 2. Billing check (Q2: Pre-deduct)
    const fee = licenseService.getMessageFee(channelType);
    if (fee) {
      const hasCredits = licenseService.hasCredits('broadcastMessages', fee.amount);
      if (!hasCredits) {
        return { success: false, error: 'INSUFFICIENT_CREDITS' };
      }

      // Real implementation would use a transaction for deduction + send
      await licenseService.deductCredits('broadcastMessages', fee.amount);
    }

    // 3. Delegate to Plugin
    const plugin = getChannelPlugin(channelType);
    if (!plugin) return { success: false, error: `No plugin for channel: ${channelType}` };
    const result = await plugin.sendMessage(metadata.contactUid, message, credentials);

    if (result.success) {
      // 4. Record usage (Q6: teamId for reporting only)
      await this.recordChannelUsage({
        channelId: metadata.channelId,
        teamId: metadata.teamId,
        direction: 'OUTBOUND',
        feeAmount: fee?.amount,
        feeCurrency: fee?.currency
      });
    }

    return result;
  }

  private async recordChannelUsage(usage: any) {
    // Mock logic: record usage in database
    logger.info(`[MessageService] Recording usage:`, usage);
    // In a real app: prisma.channelUsage.create({ data: usage })
  }
}

export const messageService = new MessageService();
