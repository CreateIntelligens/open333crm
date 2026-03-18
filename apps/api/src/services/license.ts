import { env } from '../config/env.js';
import type { 
  LicenseFeatures, 
  ChannelType, 
  CreditInfo, 
  RemoteServiceConfig,
  TeamLicense
} from '@open333crm/types';

export interface LicenseConfig {
  licenseKey: string;
  features: LicenseFeatures;
  credits: Record<string, CreditInfo>;
  remoteServices: {
    llm: RemoteServiceConfig;
  };
}

class LicenseService {
  private config: LicenseConfig | null = null;

  async initialize() {
    try {
      console.log(`[License] Initializing with key: ${env.LICENSE_KEY}`);
      
      // Mocking the fetch based on v0.2.0 spec
      this.config = {
        licenseKey: env.LICENSE_KEY,
        features: {
          channels: {
            line:     { enabled: true,  maxCount: 3 },
            fb:       { enabled: true,  maxCount: 2 },
            webchat:  { enabled: true,  maxCount: 1 },
            telegram: { enabled: true,  maxCount: 2, messageFee: 0.1, messageFeeCurrency: 'USD' },
            threads:  { enabled: false }
          },
          inbox: {
            unifiedInbox: true,
            maxAgents: 15,
            maxTeams: 10,
            maxConcurrentConversations: 500
          },
          ai: {
            llmSuggestReply: true,
            imageGeneration: true,
            sentimentAnalysis: true,
            autoClassify: true
          },
          caseManagement: {
            enabled: true,
            sla: true,
            escalation: true
          },
          marketing: {
            broadcast: true,
            maxBroadcastPerMonth: 1000
          },
          contacts: {
            maxContacts: 10000
          },
          teams: [
            {
              teamId: 'team_sales',
              teamName: 'Sales Dept',
              channels: {
                line: { enabled: true, maxCount: 1 }
              }
            }
          ]
        },
        credits: {
          llmTokens: { remaining: 1000000, total: 1000000, unit: 'tokens', resetPolicy: 'monthly' },
          broadcastMessages: { remaining: 5000, total: 5000, unit: 'messages', resetPolicy: 'monthly' }
        },
        remoteServices: {
          llm: {
            provider: 'openai',
            model: 'gpt-4o',
            endpoint: 'https://api.openai.com/v1',
            apiKey: 'sk-mock-key'
          }
        }
      };
      
      console.log('[License] Initialized successfully with v0.2.0 features');
    } catch (err) {
      console.error('[License] Initialization failed:', err);
    }
  }

  isFeatureEnabled(path: string): boolean {
    if (!this.config) return false;
    const parts = path.split('.');
    let current: any = this.config.features;
    for (const part of parts) {
      if (current[part] === undefined) return false;
      current = current[part];
    }
    // If it's a ChannelLimit object, check 'enabled'
    if (typeof current === 'object' && 'enabled' in current) {
      return current.enabled;
    }
    return !!current;
  }

  // ── Channel Checks (Q1, Q4) ────────────────
  isChannelEnabled(channelType: ChannelType): boolean {
    return this.config?.features.channels[channelType]?.enabled ?? false;
  }

  getChannelMaxCount(channelType: ChannelType): number {
    return this.config?.features.channels[channelType]?.maxCount ?? 0;
  }

  getMessageFee(channelType: ChannelType) {
    const channel = this.config?.features.channels[channelType];
    if (!channel?.messageFee) return null;
    return {
      amount: channel.messageFee,
      currency: channel.messageFeeCurrency ?? 'USD'
    };
  }

  // ── Team Checks (Q3) ──────────────────────
  isTeamCreationAllowed(currentTeamCount: number): boolean {
    const maxTeams = this.config?.features.inbox.maxTeams ?? 0;
    return currentTeamCount < maxTeams;
  }

  getTeamLicense(licenseTeamId: string): TeamLicense | null {
    return this.config?.features.teams?.find(t => t.teamId === licenseTeamId) ?? null;
  }

  isFeatureEnabledForTeam(licenseTeamId: string, channelType: ChannelType): boolean {
    const team = this.getTeamLicense(licenseTeamId);
    if (!team) return false;
    return team.channels[channelType]?.enabled ?? false;
  }

  // ── Credits (Q2) ───────────────────────────
  hasCredits(type: string, amount: number = 1): boolean {
    if (!this.config) return false;
    return (this.config.credits[type]?.remaining ?? 0) >= amount;
  }

  async deductCredits(type: string, amount: number): Promise<{ success: boolean; remaining: number }> {
    if (!this.config || !this.hasCredits(type, amount)) {
      return { success: false, remaining: this.config?.credits[type]?.remaining ?? 0 };
    }
    
    // In a real implementation, this would call the License Server
    this.config.credits[type].remaining -= amount;
    return { success: true, remaining: this.config.credits[type].remaining };
  }

  getRemoteService(service: 'llm') {
    return this.config?.remoteServices[service];
  }

  getLicenseSummary() {
    return this.config;
  }
}

export const licenseService = new LicenseService();
