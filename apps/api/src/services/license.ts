import Fastify from 'fastify';
import axios from 'axios';
import { env } from '../config/env.js';

export interface LicenseConfig {
  licenseKey: string;
  features: Record<string, any>;
  credits: Record<string, { remaining: number }>;
  remoteServices: {
    llm: { apiKey: string; model: string; endpoint: string };
  };
}

class LicenseService {
  private config: LicenseConfig | null = null;

  async initialize() {
    try {
      // In a real implementation, we would fetch from env.LICENSE_FETCH_URL
      // and verify with env.LICENSE_SIGNATURE_SECRET.
      // For now, we'll mock the response based on the spec.
      console.log(`[License] Initializing with key: ${env.LICENSE_KEY}`);
      
      // Mocking the fetch
      this.config = {
        licenseKey: env.LICENSE_KEY,
        features: {
          channels: { line: true, fb: true, webchat: true },
          automation: { enabled: true, maxRules: 50 },
          ai: { llmSuggestReply: true }
        },
        credits: {
          llmTokens: { remaining: 1000000 }
        },
        remoteServices: {
          llm: {
            apiKey: 'sk-mock-key',
            model: 'gpt-4o',
            endpoint: 'https://api.openai.com/v1'
          }
        }
      };
      
      console.log('[License] Initialized successfully');
    } catch (err) {
      console.error('[License] Initialization failed:', err);
      // Fallback or exit based on policy
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
    return !!current;
  }

  hasCredits(type: string, amount: number = 1): boolean {
    if (!this.config) return false;
    return (this.config.credits[type]?.remaining ?? 0) >= amount;
  }

  getRemoteService(service: 'llm') {
    return this.config?.remoteServices[service];
  }
}

export const licenseService = new LicenseService();
