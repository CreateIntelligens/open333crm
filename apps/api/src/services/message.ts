import { 
  UniversalMessage, 
  ChannelType, 
  OutboundMessage, 
  SendResult 
} from '@open333crm/types';
import { getPlugin } from '@open333crm/channel-plugins';
import { licenseService } from './license.js';
import { channelTeamAccessService } from './channel-team-access.js';

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
    message: OutboundMessage,
    channelType: ChannelType,
    credentials: Record<string, string>
  ): Promise<SendResult> {
    
    // 1. Authorization check
    const { hasAccess, level } = await channelTeamAccessService.checkAccess({
      channelId: metadata.channelId,
      teamId: metadata.teamId,
      requiredLevel: 'reply_only' // reply_only is enough for single reply
    });

    if (!hasAccess) {
      return { success: false, error: 'ACCESS_LEVEL_INSUFFICIENT' };
    }

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
    const plugin = getPlugin(channelType);
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
    console.log(`[MessageService] Recording usage:`, usage);
    // In a real app: prisma.channelUsage.create({ data: usage })
  }
}

export const messageService = new MessageService();
