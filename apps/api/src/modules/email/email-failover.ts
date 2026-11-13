import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { logger } from '@open333crm/core';

const ACQUIRE = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local untilTime = tonumber(redis.call('GET', KEYS[1]) or '0')
local probe = false
local provider = 'smtp'
if untilTime > 0 then
  if untilTime <= now and redis.call('SET', KEYS[2], ARGV[1], 'NX', 'PX', ARGV[2]) then
    probe = true
  else
    provider = 'resend'
  end
end
local leases = provider == 'smtp' and KEYS[3] or KEYS[4]
redis.call('ZREMRANGEBYSCORE', leases, '-inf', now)
local limit = provider == 'smtp' and tonumber(ARGV[3]) or tonumber(ARGV[4])
if provider == 'smtp' and ARGV[8] == 'bulk' then
  limit = tonumber(ARGV[9])
end
if redis.call('ZCARD', leases) >= limit then
  if probe then redis.call('DEL', KEYS[2]) end
  return 'busy'
end
local windowStart = now - 1000
local rateKey = provider == 'smtp' and KEYS[5] or KEYS[6]
local rateLimit = provider == 'smtp' and tonumber(ARGV[5]) or tonumber(ARGV[6])
redis.call('ZREMRANGEBYSCORE', rateKey, '-inf', windowStart)
if redis.call('ZCARD', rateKey) >= rateLimit then
  local oldest = redis.call('ZRANGE', rateKey, 0, 0, 'WITHSCORES')
  local waitMs = 100
  if oldest[2] then waitMs = math.max(50, tonumber(oldest[2]) + 1000 - now) end
  if probe then redis.call('DEL', KEYS[2]) end
  return 'rate_limited:' .. waitMs
end
if provider == 'smtp' and ARGV[8] == 'bulk' then
  redis.call('ZREMRANGEBYSCORE', KEYS[7], '-inf', windowStart)
  if redis.call('ZCARD', KEYS[7]) >= tonumber(ARGV[7]) then
    local oldest = redis.call('ZRANGE', KEYS[7], 0, 0, 'WITHSCORES')
    local waitMs = 100
    if oldest[2] then waitMs = math.max(50, tonumber(oldest[2]) + 1000 - now) end
    if probe then redis.call('DEL', KEYS[2]) end
    return 'rate_limited:' .. waitMs
  end
  redis.call('ZADD', KEYS[7], now, ARGV[1])
  redis.call('PEXPIRE', KEYS[7], 2000)
end
redis.call('ZADD', leases, now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', leases, ARGV[2])
redis.call('ZADD', rateKey, now, ARGV[1])
redis.call('PEXPIRE', rateKey, 2000)
if probe then return 'probe' end
return provider
`;

const FINISH = `
redis.call('ZREM', KEYS[3], ARGV[1])
if redis.call('ZCARD', KEYS[3]) == 0 then redis.call('DEL', KEYS[3]) end
if ARGV[2] == 'fail' then
  local t = redis.call('TIME')
  local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
  redis.call('SET', KEYS[1], now + tonumber(ARGV[3]))
elseif ARGV[2] == 'recovered' and redis.call('GET', KEYS[2]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
end
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
return 1
`;

const RENEW = `
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) then return 0 end
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('PEXPIRE', KEYS[2], ARGV[2]) end
return 1
`;

const LEASE_MS = 300_000;

export type EmailPriority = 'transactional' | 'bulk';

export interface EmailFailoverOptions {
  prefix?: string;
  smtpMaxConcurrency?: number;
  smtpRatePerSec?: number;
  smtpBulkRatePerSec?: number;
  resendMaxConcurrency?: number;
  resendRatePerSec?: number;
  cooldownMs?: number;
}

export class EmailCapacityError extends Error {
  constructor(
    readonly reason: 'busy' | 'rate_limited' | 'throttled',
    readonly retryAfterMs: number,
    message = reason === 'busy'
      ? 'Email delivery capacity exhausted'
      : `Email delivery rate limited (retry after ${retryAfterMs}ms)`,
  ) {
    super(message);
    this.name = 'EmailCapacityError';
  }
}

export function resolveEffectiveBulkRate(ratePerSec: number, explicitBulkRate?: number): number {
  return explicitBulkRate ?? Math.max(1, Math.floor(ratePerSec * 0.8));
}
function normalizeClusterPrefix(prefix: string): string {
  const open = prefix.indexOf('{');
  const close = prefix.indexOf('}', open + 1);
  return open >= 0 && close > open + 1 ? prefix : `{${prefix}}`;
}


export class EmailFailoverCoordinator {
  private readonly renewals = new Map<string, NodeJS.Timeout>();
  private readonly keys: string[];
  private readonly smtpMaxConcurrency: number;
  private readonly smtpBulkMaxConcurrency: number;
  private readonly smtpRatePerSec: number;
  private readonly smtpBulkRatePerSec: number;
  private readonly resendMaxConcurrency: number;
  private readonly resendRatePerSec: number;
  private readonly cooldownMs: number;

  constructor(
    private readonly store: Pick<Redis, 'eval'>,
    optionsOrPrefix: string | EmailFailoverOptions = '{email:provider-failover}',
  ) {
    const opts = typeof optionsOrPrefix === 'string' ? { prefix: optionsOrPrefix } : optionsOrPrefix;
    const prefix = normalizeClusterPrefix(opts.prefix ?? '{email:provider-failover}');
    this.keys = [
      `${prefix}:open`,
      `${prefix}:probe`,
      `${prefix}:smtp`,
      `${prefix}:resend`,
      `${prefix}:smtp-rate`,
      `${prefix}:resend-rate`,
      `${prefix}:smtp-bulk-rate`,
    ];
    this.smtpMaxConcurrency = opts.smtpMaxConcurrency ?? 3;
    this.smtpBulkMaxConcurrency = Math.max(1, this.smtpMaxConcurrency - 1);
    this.smtpRatePerSec = opts.smtpRatePerSec ?? 10;
    this.smtpBulkRatePerSec = resolveEffectiveBulkRate(this.smtpRatePerSec, opts.smtpBulkRatePerSec);
    this.resendMaxConcurrency = opts.resendMaxConcurrency ?? 5;
    this.resendRatePerSec = opts.resendRatePerSec ?? 2;
    this.cooldownMs = opts.cooldownMs ?? 60_000;
  }

  async acquire(priority: EmailPriority = 'transactional'): Promise<{ token: string; provider: 'smtp' | 'resend' | 'probe' }> {
    const token = randomUUID();
    const result = await this.store.eval(
      ACQUIRE,
      7,
      ...this.keys,
      token,
      LEASE_MS,
      this.smtpMaxConcurrency,
      this.resendMaxConcurrency,
      this.smtpRatePerSec,
      this.resendRatePerSec,
      this.smtpBulkRatePerSec,
      priority,
      this.smtpBulkMaxConcurrency,
    );
    if (typeof result === 'string' && result.startsWith('rate_limited:')) {
      const waitMs = Math.max(50, Number(result.slice('rate_limited:'.length)) || 200);
      throw new EmailCapacityError('rate_limited', waitMs);
    }
    if (result !== 'smtp' && result !== 'resend' && result !== 'probe') {
      throw new EmailCapacityError('busy', 500);
    }
    const leases = result === 'resend' ? this.keys[3] : this.keys[2];
    const renewal = setInterval(() => {
      void this.store.eval(RENEW, 2, leases, this.keys[1], token, LEASE_MS)
        .then((res) => {
          if (res !== 1) logger.error('[EmailService] Provider lease expired during delivery');
        })
        .catch(() => logger.error('[EmailService] Failed to renew provider lease'));
    }, 60_000);
    renewal.unref();
    this.renewals.set(token, renewal);
    return { token, provider: result };
  }

  async finish(
    lease: { token: string; provider: 'smtp' | 'resend' | 'probe' },
    outcome: 'success' | 'fail' | 'throttled',
  ): Promise<void> {
    clearInterval(this.renewals.get(lease.token));
    this.renewals.delete(lease.token);
    const leases = lease.provider === 'resend' ? this.keys[3] : this.keys[2];
    const action = lease.provider === 'resend'
      ? 'release'
      : outcome === 'fail'
        ? 'fail'
        : outcome === 'throttled'
          ? 'release'
          : lease.provider === 'probe'
            ? 'recovered'
            : 'release';
    await this.store.eval(FINISH, 3, this.keys[0], this.keys[1], leases, lease.token, action, this.cooldownMs);
  }
}
