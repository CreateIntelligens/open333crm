import axios from 'axios';
import { logger } from '../logger';
import { redis } from '../redis/client';

export interface LicenseData {
  licenseKey: string;
  tenantName: string;
  features: Record<string, boolean>;
  credits: {
    ai: number;
    messages: number;
  };
  llmConfig?: {
    model: string;
    apiKeyEncrypted: string;
  };
}

export class LicenseService {
  private static CACHE_KEY = 'crm:license_data';
  private static instance: LicenseService;

  private constructor() {}

  static getInstance(): LicenseService {
    if (!LicenseService.instance) {
      LicenseService.instance = new LicenseService();
    }
    return LicenseService.instance;
  }

  async fetchAndCache(): Promise<LicenseData | null> {
    const fetchUrl = process.env.LICENSE_FETCH_URL;
    const licenseKey = process.env.LICENSE_KEY;

    if (!fetchUrl || !licenseKey) {
      logger.warn('LICENSE_FETCH_URL or LICENSE_KEY not set, skipping license fetch');
      return null;
    }

    try {
      const response = await axios.get<LicenseData>(fetchUrl, {
        headers: { 'X-License-Key': licenseKey },
      });
      const data = response.data;

      // Cache in Redis for 24 hours (fallback)
      await redis.set(LicenseService.CACHE_KEY, JSON.stringify(data), 'EX', 86400);
      logger.info(`License data refreshed for ${data.tenantName}`);
      return data;
    } catch (err) {
      logger.error('Failed to fetch license data:', err);
      // Try to get from cache
      const cached = await redis.get(LicenseService.CACHE_KEY);
      if (cached) {
        logger.info('Using cached license data');
        return JSON.parse(cached);
      }
      return null;
    }
  }

  async isFeatureEnabled(feature: string): Promise<boolean> {
    const data = await this.getCurrentLicense();
    return !!data?.features[feature];
  }

  async getCurrentLicense(): Promise<LicenseData | null> {
    const cached = await redis.get(LicenseService.CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
    return this.fetchAndCache();
  }
}
