import { logger } from '@open333crm/core';
import type { ChannelType, CreditInfo, RemoteServiceConfig, TeamLicense } from '@open333crm/types';
import { env } from '../config/env.js';
import { cachePluginOptions } from '../lib/cacheStore.js';

export type LicenseProviderName = 'allow-all' | 'env' | 'cache';
export type LicenseDecisionCode =
  | 'FEATURE_NOT_ENABLED'
  | 'LIMIT_EXCEEDED'
  | 'CHANNEL_LIMIT_EXCEEDED'
  | 'INSUFFICIENT_CREDITS'
  | 'LICENSE_PROVIDER_UNAVAILABLE';

export interface LicenseContext {
  tenantId?: string;
  agentId?: string;
}

export interface ChannelPolicy {
  enabled?: boolean;
  maxCount?: number | null;
  messageFee?: number;
  messageFeeCurrency?: string;
}

export interface LicenseSnapshot {
  provider: LicenseProviderName | string;
  loadedAt: string;
  features: Record<string, boolean>;
  limits: Record<string, number | null>;
  credits: Record<string, CreditInfo & { unlimited?: boolean }>;
  channels: Partial<Record<ChannelType, ChannelPolicy>>;
  remoteServices?: Partial<Record<'llm', RemoteServiceConfig>>;
  teams?: TeamLicense[];
}

export interface LicenseDecision {
  allowed: boolean;
  code?: LicenseDecisionCode;
  message?: string;
  statusCode?: number;
  featurePath?: string;
  creditType?: string;
  channelType?: ChannelType;
  limit?: number | null;
  current?: number;
}

export interface LicenseProvider {
  readonly name: LicenseProviderName | string;
  loadSnapshot(context?: LicenseContext): Promise<LicenseSnapshot>;
  deductCredits?(type: string, amount: number, context?: LicenseContext): Promise<{ success: boolean; remaining: number | null }>;
}

type CacheKey = string | { id: string; segment: string };
type CacheResult<T> = { item: T; stored: number; ttl: number } | null;
type CacheStore = {
  get<T = unknown>(key: CacheKey): Promise<CacheResult<T>>;
  set(key: CacheKey, value: unknown, timeToLive: number, callback?: (error: unknown, result: unknown) => void): void;
};

type EnvProviderInput = {
  features?: unknown;
  limits?: unknown;
  credits?: unknown;
  channels?: unknown;
};

const CHANNEL_TYPES: ChannelType[] = ['LINE', 'FB', 'WEBCHAT', 'WHATSAPP', 'TELEGRAM', 'THREADS'];

const createBaseSnapshot = (provider: LicenseSnapshot['provider']): LicenseSnapshot => ({
  provider,
  loadedAt: new Date().toISOString(),
  features: {},
  limits: {},
  credits: {},
  channels: {},
  remoteServices: {},
  teams: [],
});

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
};

const parseJsonRecord = (name: string, raw?: string): Record<string, unknown> => {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return parsed;
};

const flattenFeatures = (value: unknown, prefix = ''): Record<string, boolean> => {
  if (typeof value === 'boolean') {
    return prefix ? { [prefix]: value } : {};
  }
  if (!isRecord(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, boolean>>((acc, [key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'boolean') {
      acc[path] = child;
    } else if (isRecord(child)) {
      if (typeof child.enabled === 'boolean') {
        acc[path] = child.enabled;
      }
      Object.assign(acc, flattenFeatures(child, path));
    }
    return acc;
  }, {});
};

const normalizeLimits = (value: unknown): Record<string, number | null> => {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<Record<string, number | null>>((acc, [key, raw]) => {
    if (raw === null) {
      acc[key] = null;
    } else if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
      acc[key] = raw;
    } else {
      throw new Error(`LICENSE_LIMITS_JSON.${key} must be a non-negative number or null`);
    }
    return acc;
  }, {});
};

const normalizeCredits = (value: unknown): Record<string, CreditInfo & { unlimited?: boolean }> => {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<Record<string, CreditInfo & { unlimited?: boolean }>>((acc, [key, raw]) => {
    if (raw === null || raw === 'unlimited') {
      acc[key] = { remaining: Number.POSITIVE_INFINITY, total: Number.POSITIVE_INFINITY, unit: key, resetPolicy: 'never', unlimited: true };
      return acc;
    }

    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
      acc[key] = { remaining: raw, total: raw, unit: key, resetPolicy: 'never' };
      return acc;
    }

    if (!isRecord(raw)) {
      throw new Error(`LICENSE_CREDITS_JSON.${key} must be a number, null, "unlimited", or object`);
    }

    const remaining = raw.remaining === null || raw.remaining === undefined
      ? Number.POSITIVE_INFINITY
      : Number(raw.remaining);
    const total = raw.total === null || raw.total === undefined ? remaining : Number(raw.total);

    if (!Number.isFinite(remaining) && raw.remaining !== null && raw.remaining !== undefined) {
      throw new Error(`LICENSE_CREDITS_JSON.${key}.remaining must be a number or null`);
    }
    if (!Number.isFinite(total) && raw.total !== null && raw.total !== undefined) {
      throw new Error(`LICENSE_CREDITS_JSON.${key}.total must be a number or null`);
    }

    acc[key] = {
      remaining,
      total,
      unit: typeof raw.unit === 'string' ? raw.unit : key,
      resetPolicy: raw.resetPolicy === 'monthly' ? 'monthly' : 'never',
      unlimited: remaining === Number.POSITIVE_INFINITY,
    };
    return acc;
  }, {});
};

const normalizeChannels = (value: unknown): Partial<Record<ChannelType, ChannelPolicy>> => {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<Partial<Record<ChannelType, ChannelPolicy>>>((acc, [key, raw]) => {
    const channelType = key.toUpperCase() as ChannelType;
    if (!CHANNEL_TYPES.includes(channelType)) {
      throw new Error(`Unsupported channel type in LICENSE_CHANNELS_JSON: ${key}`);
    }

    if (typeof raw === 'boolean') {
      acc[channelType] = { enabled: raw };
      return acc;
    }

    if (!isRecord(raw)) {
      throw new Error(`LICENSE_CHANNELS_JSON.${key} must be a boolean or object`);
    }

    const maxCount = raw.maxCount === undefined || raw.maxCount === null ? null : Number(raw.maxCount);
    if (maxCount !== null && (!Number.isFinite(maxCount) || maxCount < 0)) {
      throw new Error(`LICENSE_CHANNELS_JSON.${key}.maxCount must be a non-negative number or null`);
    }

    const messageFee = raw.messageFee === undefined || raw.messageFee === null ? undefined : Number(raw.messageFee);
    if (messageFee !== undefined && (!Number.isFinite(messageFee) || messageFee < 0)) {
      throw new Error(`LICENSE_CHANNELS_JSON.${key}.messageFee must be a non-negative number`);
    }

    acc[channelType] = {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : undefined,
      maxCount,
      messageFee,
      messageFeeCurrency: typeof raw.messageFeeCurrency === 'string' ? raw.messageFeeCurrency : undefined,
    };
    return acc;
  }, {});
};

export class AllowAllLicenseProvider implements LicenseProvider {
  readonly name = 'allow-all' as const;

  async loadSnapshot(_context?: LicenseContext): Promise<LicenseSnapshot> {
    return createBaseSnapshot(this.name);
  }

  async deductCredits(): Promise<{ success: boolean; remaining: number | null }> {
    return { success: true, remaining: null };
  }
}

export class EnvLicenseProvider implements LicenseProvider {
  readonly name = 'env' as const;
  private readonly input: EnvProviderInput;
  private creditState: Record<string, CreditInfo & { unlimited?: boolean }> | null = null;

  constructor(input: EnvProviderInput) {
    this.input = input;
  }

  static fromEnv() {
    return new EnvLicenseProvider({
      features: parseJsonRecord('LICENSE_FEATURES_JSON', env.LICENSE_FEATURES_JSON),
      limits: parseJsonRecord('LICENSE_LIMITS_JSON', env.LICENSE_LIMITS_JSON),
      credits: parseJsonRecord('LICENSE_CREDITS_JSON', env.LICENSE_CREDITS_JSON),
      channels: parseJsonRecord('LICENSE_CHANNELS_JSON', env.LICENSE_CHANNELS_JSON),
    });
  }

  async loadSnapshot(): Promise<LicenseSnapshot> {
    const snapshot = createBaseSnapshot(this.name);
    snapshot.features = flattenFeatures(this.input.features);
    snapshot.limits = normalizeLimits(this.input.limits);
    snapshot.channels = normalizeChannels(this.input.channels);
    this.creditState ??= normalizeCredits(this.input.credits);
    snapshot.credits = this.creditState;
    return snapshot;
  }

  async deductCredits(type: string, amount: number): Promise<{ success: boolean; remaining: number | null }> {
    this.creditState ??= normalizeCredits(this.input.credits);
    const credit = this.creditState[type];
    if (!credit || credit.unlimited || credit.remaining === Number.POSITIVE_INFINITY) {
      return { success: true, remaining: null };
    }
    if (credit.remaining < amount) {
      return { success: false, remaining: credit.remaining };
    }
    credit.remaining -= amount;
    return { success: true, remaining: credit.remaining };
  }
}

export class CachedLicenseProvider implements LicenseProvider {
  readonly name = 'cache' as const;

  constructor(
    private readonly cache: CacheStore | undefined,
    private readonly source: LicenseProvider,
    private readonly ttlMs: number,
  ) {}

  async loadSnapshot(context?: LicenseContext): Promise<LicenseSnapshot> {
    const key = { segment: env.CACHE_SEGMENT, id: `license:${context?.tenantId ?? 'global'}` };
    if (this.cache) {
      const hit = await this.cache.get<LicenseSnapshot>(key);
      if (hit?.item) {
        return { ...hit.item, provider: this.name };
      }
    }

    const snapshot = await this.source.loadSnapshot(context);
    if (this.cache) {
      this.cache.set(key, snapshot, this.ttlMs);
    }
    return { ...snapshot, provider: this.name };
  }

  async deductCredits(type: string, amount: number, context?: LicenseContext): Promise<{ success: boolean; remaining: number | null }> {
    return this.source.deductCredits?.(type, amount, context) ?? { success: true, remaining: null };
  }
}

const featureDecisionMessage = '此功能未在您的授權方案內，請聯繫客服升級';
const creditDecisionMessage = '點數不足，請充值後再試';

export class LicenseService {
  private provider: LicenseProvider | null = null;
  private failClosed = false;

  constructor(provider?: LicenseProvider, options?: { failClosed?: boolean }) {
    this.provider = provider ?? null;
    this.failClosed = options?.failClosed ?? false;
  }

  async initialize() {
    const provider = await this.ensureProvider();
    logger.info(`[License] Initialized with provider: ${provider.name}`);
  }

  async checkFeature(featurePath: string, context?: LicenseContext): Promise<LicenseDecision> {
    const snapshot = await this.loadSnapshot(context);
    const enabled = snapshot.features[featurePath] ?? true;
    if (enabled) {
      return { allowed: true, featurePath };
    }
    return {
      allowed: false,
      code: 'FEATURE_NOT_ENABLED',
      message: featureDecisionMessage,
      statusCode: 402,
      featurePath,
    };
  }

  async isFeatureEnabled(path: string, context?: LicenseContext): Promise<boolean> {
    return (await this.checkFeature(path, context)).allowed;
  }

  async getLimit(path: string, context?: LicenseContext): Promise<number | null> {
    const snapshot = await this.loadSnapshot(context);
    return snapshot.limits[path] ?? null;
  }

  async checkLimit(path: string, current: number, context?: LicenseContext): Promise<LicenseDecision> {
    const limit = await this.getLimit(path, context);
    if (limit === null || current < limit) {
      return { allowed: true, limit, current };
    }
    return {
      allowed: false,
      code: 'LIMIT_EXCEEDED',
      message: '授權方案限制已達上限',
      statusCode: 402,
      limit,
      current,
    };
  }

  async isChannelEnabled(channelType: ChannelType, context?: LicenseContext): Promise<boolean> {
    const snapshot = await this.loadSnapshot(context);
    return snapshot.channels[channelType]?.enabled ?? true;
  }

  async getChannelMaxCount(channelType: ChannelType, context?: LicenseContext): Promise<number | null> {
    const snapshot = await this.loadSnapshot(context);
    return snapshot.channels[channelType]?.maxCount ?? null;
  }

  async checkChannelCreation(channelType: ChannelType, currentCount: number, context?: LicenseContext): Promise<LicenseDecision> {
    const enabled = await this.isChannelEnabled(channelType, context);
    if (!enabled) {
      return {
        allowed: false,
        code: 'FEATURE_NOT_ENABLED',
        message: featureDecisionMessage,
        statusCode: 402,
        channelType,
      };
    }

    const maxCount = await this.getChannelMaxCount(channelType, context);
    if (maxCount !== null && currentCount >= maxCount) {
      return {
        allowed: false,
        code: 'CHANNEL_LIMIT_EXCEEDED',
        message: `${channelType} channel limit exceeded`,
        statusCode: 402,
        channelType,
        limit: maxCount,
        current: currentCount,
      };
    }

    return { allowed: true, channelType, limit: maxCount, current: currentCount };
  }

  async getMessageFee(channelType: ChannelType, context?: LicenseContext): Promise<{ amount: number; currency: string } | null> {
    const snapshot = await this.loadSnapshot(context);
    const channel = snapshot.channels[channelType];
    if (!channel?.messageFee) return null;
    return {
      amount: channel.messageFee,
      currency: channel.messageFeeCurrency ?? 'USD',
    };
  }

  async checkCredits(type: string, amount: number = 1, context?: LicenseContext): Promise<LicenseDecision> {
    const snapshot = await this.loadSnapshot(context);
    const credit = snapshot.credits[type];
    if (!credit || credit.unlimited || credit.remaining === Number.POSITIVE_INFINITY || credit.remaining >= amount) {
      return { allowed: true, creditType: type };
    }
    return {
      allowed: false,
      code: 'INSUFFICIENT_CREDITS',
      message: `${type} ${creditDecisionMessage}`,
      statusCode: 402,
      creditType: type,
    };
  }

  async hasCredits(type: string, amount: number = 1, context?: LicenseContext): Promise<boolean> {
    return (await this.checkCredits(type, amount, context)).allowed;
  }

  async deductCredits(type: string, amount: number, context?: LicenseContext): Promise<{ success: boolean; remaining: number | null }> {
    const decision = await this.checkCredits(type, amount, context);
    if (!decision.allowed) {
      const snapshot = await this.loadSnapshot(context);
      return { success: false, remaining: snapshot.credits[type]?.remaining ?? 0 };
    }

    const provider = await this.ensureProvider();
    return provider.deductCredits?.(type, amount, context) ?? { success: true, remaining: null };
  }

  async isTeamCreationAllowed(currentTeamCount: number, context?: LicenseContext): Promise<boolean> {
    const decision = await this.checkLimit('inbox.maxTeams', currentTeamCount, context);
    return decision.allowed;
  }

  async getTeamLicense(licenseTeamId: string, context?: LicenseContext): Promise<TeamLicense | null> {
    const snapshot = await this.loadSnapshot(context);
    return snapshot.teams?.find((team) => team.teamId === licenseTeamId) ?? null;
  }

  async isFeatureEnabledForTeam(licenseTeamId: string, channelType: ChannelType, context?: LicenseContext): Promise<boolean> {
    const team = await this.getTeamLicense(licenseTeamId, context);
    if (!team) return true;
    return team.channels[channelType]?.enabled ?? true;
  }

  async getRemoteService(service: 'llm', context?: LicenseContext) {
    const snapshot = await this.loadSnapshot(context);
    return snapshot.remoteServices?.[service];
  }

  async getLicenseSummary(context?: LicenseContext) {
    const snapshot = await this.loadSnapshot(context);
    return {
      provider: snapshot.provider,
      loadedAt: snapshot.loadedAt,
      features: snapshot.features,
      limits: snapshot.limits,
      credits: Object.fromEntries(
        Object.entries(snapshot.credits).map(([key, credit]) => [
          key,
          {
            remaining: credit.remaining === Number.POSITIVE_INFINITY ? null : credit.remaining,
            total: credit.total === Number.POSITIVE_INFINITY ? null : credit.total,
            unit: credit.unit,
            resetPolicy: credit.resetPolicy,
            unlimited: credit.unlimited ?? false,
          },
        ]),
      ),
      channels: snapshot.channels,
    };
  }

  useProviderForTest(provider: LicenseProvider, options?: { failClosed?: boolean }) {
    this.provider = provider;
    this.failClosed = options?.failClosed ?? false;
  }

  private async loadSnapshot(context?: LicenseContext): Promise<LicenseSnapshot> {
    try {
      const provider = await this.ensureProvider();
      return await provider.loadSnapshot(context);
    } catch (error) {
      logger.error('[License] Provider unavailable:', error);
      if (this.failClosed) {
        throw Object.assign(new Error('License provider unavailable'), {
          code: 'LICENSE_PROVIDER_UNAVAILABLE' satisfies LicenseDecisionCode,
          statusCode: 503,
        });
      }
      return new AllowAllLicenseProvider().loadSnapshot(context);
    }
  }

  private async ensureProvider(): Promise<LicenseProvider> {
    if (this.provider) {
      return this.provider;
    }

    const providerName = env.LICENSE_PROVIDER;
    this.failClosed = env.LICENSE_FAIL_CLOSED;
    if (providerName === 'allow-all') {
      this.provider = new AllowAllLicenseProvider();
    } else if (providerName === 'env') {
      this.provider = EnvLicenseProvider.fromEnv();
    } else if (providerName === 'cache') {
      const source = env.LICENSE_CACHE_SOURCE === 'env' ? EnvLicenseProvider.fromEnv() : new AllowAllLicenseProvider();
      this.provider = new CachedLicenseProvider(
        cachePluginOptions.cache as CacheStore | undefined,
        source,
        env.LICENSE_CACHE_TTL_MS,
      );
    } else {
      throw new Error(`Unsupported LICENSE_PROVIDER: ${providerName}`);
    }

    return this.provider;
  }
}

export const licenseService = new LicenseService();
