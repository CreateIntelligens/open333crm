import { UniversalMessage } from '@open333crm/types';
import { channelTeamAccessService } from './channel-team-access.js';
import { logger } from '@open333crm/core';

export interface RoutingResult {
  teamId: string | null; // null means unassigned queue
  reason: 'conversation' | 'channel_default' | 'automation' | 'unassigned';
}

class InboundRouterService {
  /**
   * Resolves which team should handle an incoming message
   */
  async resolveTeam(message: UniversalMessage): Promise<RoutingResult> {
    // 1. Check if there's an active conversation for this contactUid + channelId
    const existingConversationTeamId = await this.getExistingConversationTeamId(
      message.contactUid,
      message.channelId
    );
    
    if (existingConversationTeamId) {
      return { teamId: existingConversationTeamId, reason: 'conversation' };
    }

    // 2. Check Channel's defaultTeamId
    const defaultTeamId = await this.getChannelDefaultTeamId(message.channelId);
    if (defaultTeamId) {
      return { teamId: defaultTeamId, reason: 'channel_default' };
    }

    // 3. TODO: Run Automation Rules (AI/Keyword based)
    // const automationTeamId = await automationEngine.run(message);
    // if (automationTeamId) return { teamId: automationTeamId, reason: 'automation' };

    // 4. Fallback to unassigned
    return { teamId: null, reason: 'unassigned' };
  }

  private async getExistingConversationTeamId(contactUid: string, channelId: string): Promise<string | null> {
    // Mock logic: check database for active conversation
    logger.info(`[InboundRouter] Checking existing conversation for contact ${contactUid} on channel ${channelId}`);
    // In a real app: return prisma.conversation.findFirst({ where: { contactUid, channelId, status: 'OPEN' } }).teamId
    return null; 
  }

  private async getChannelDefaultTeamId(channelId: string): Promise<string | null> {
    // Mock logic: get default team from channel settings
    logger.info(`[InboundRouter] Checking default team for channel ${channelId}`);
    // In a real app: return prisma.channel.findUnique({ where: { id: channelId } }).defaultTeamId
    
    // For demonstration, if it's the mock channel, return mock team
    if (channelId === 'mock-line-channel-id') return 'team_sales';
    return null;
  }
}

export const inboundRouterService = new InboundRouterService();
