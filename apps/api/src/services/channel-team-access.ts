import { ChannelType, ChannelTeamAccessLevel } from '@open333crm/types';
import { logger } from '@open333crm/core';

export interface ChannelTeamAccess {
  channelId: string;
  teamId: string;
  accessLevel: ChannelTeamAccessLevel;
  grantedAt: Date;
  grantedById?: string;
}

class ChannelTeamAccessService {
  // In-memory mock store
  private accessList: ChannelTeamAccess[] = [
    {
      channelId: 'mock-line-channel-id',
      teamId: 'team_sales',
      accessLevel: 'full',
      grantedAt: new Date()
    }
  ];

  async grantAccess(params: {
    channelId: string;
    teamId: string;
    accessLevel: ChannelTeamAccessLevel;
    grantedById?: string;
  }): Promise<ChannelTeamAccess> {
    const existingIndex = this.accessList.findIndex(
      a => a.channelId === params.channelId && a.teamId === params.teamId
    );

    const access: ChannelTeamAccess = {
      ...params,
      grantedAt: new Date()
    };

    if (existingIndex > -1) {
      this.accessList[existingIndex] = access;
    } else {
      this.accessList.push(access);
    }

    logger.info(`[ChannelTeamAccess] Granted ${params.accessLevel} access for channel ${params.channelId} to team ${params.teamId}`);
    return access;
  }

  async revokeAccess(channelId: string, teamId: string): Promise<boolean> {
    const lengthBefore = this.accessList.length;
    this.accessList = this.accessList.filter(
      a => !(a.channelId === channelId && a.teamId === teamId)
    );
    return this.accessList.length < lengthBefore;
  }

  async listTeamsForChannel(channelId: string): Promise<ChannelTeamAccess[]> {
    return this.accessList.filter(a => a.channelId === channelId);
  }

  async listChannelsForTeam(teamId: string): Promise<ChannelTeamAccess[]> {
    return this.accessList.filter(a => a.teamId === teamId);
  }

  async checkAccess(params: {
    channelId: string;
    teamId: string;
    requiredLevel?: ChannelTeamAccessLevel;
  }): Promise<{ hasAccess: boolean; level?: ChannelTeamAccessLevel }> {
    const access = this.accessList.find(
      a => a.channelId === params.channelId && a.teamId === params.teamId
    );

    if (!access) return { hasAccess: false };

    if (params.requiredLevel) {
      const levels: ChannelTeamAccessLevel[] = ['read_only', 'reply_only', 'full'];
      const currentIdx = levels.indexOf(access.accessLevel);
      const requiredIdx = levels.indexOf(params.requiredLevel);
      
      if (currentIdx < requiredIdx) {
        return { hasAccess: false, level: access.accessLevel };
      }
    }

    return { hasAccess: true, level: access.accessLevel };
  }
}

export const channelTeamAccessService = new ChannelTeamAccessService();
