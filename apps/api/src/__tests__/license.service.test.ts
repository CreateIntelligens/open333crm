import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgresql://crm:crmpassword@localhost:5432/open333crm';
process.env.REDIS_URL ??= 'redis://localhost:6380';
process.env.JWT_SECRET ??= 'change-me-to-a-very-long-random-string-at-least-32-chars';
process.env.CACHE_DRIVER = 'memory';
process.env.LICENSE_PROVIDER = 'allow-all';

const {
  AllowAllLicenseProvider,
  CachedLicenseProvider,
  EnvLicenseProvider,
  LicenseService,
  licenseService,
} = await import('../services/license.js');
const { requireFeature } = await import('../guards/license.guard.js');

const allowAll = new LicenseService(new AllowAllLicenseProvider());
assert.equal(await allowAll.isFeatureEnabled('unknown.future.feature'), true);
assert.equal(await allowAll.hasCredits('broadcastMessages', 999999), true);
assert.equal(await allowAll.isChannelEnabled('LINE'), true);
assert.equal(await allowAll.getChannelMaxCount('LINE'), null);

const envProvider = new EnvLicenseProvider({
  features: {
    portal: {
      activities: false,
    },
  },
  channels: {
    TELEGRAM: {
      enabled: true,
      maxCount: 1,
      messageFee: 0.25,
      messageFeeCurrency: 'USD',
    },
  },
  credits: {
    broadcastMessages: {
      remaining: 0.2,
      total: 10,
      unit: 'messages',
      resetPolicy: 'monthly',
    },
  },
});
const envService = new LicenseService(envProvider);
assert.equal(await envService.isFeatureEnabled('portal.activities'), false);
assert.deepEqual(await envService.getMessageFee('TELEGRAM'), { amount: 0.25, currency: 'USD' });
assert.equal((await envService.checkChannelCreation('TELEGRAM', 1)).code, 'CHANNEL_LIMIT_EXCEEDED');
assert.equal(await envService.hasCredits('broadcastMessages', 0.25), false);

let fallbackCalls = 0;
const cacheStore = {
  stored: null as unknown,
  async get() {
    if (!this.stored) return null;
    return { item: this.stored, stored: Date.now(), ttl: 300000 };
  },
  set(_key: unknown, value: unknown) {
    this.stored = value;
  },
};
const fallbackProvider = {
  name: 'env-fallback',
  async loadSnapshot() {
    fallbackCalls += 1;
    return {
      provider: 'env-fallback',
      loadedAt: new Date().toISOString(),
      features: { 'cached.feature': false },
      limits: {},
      credits: {},
      channels: {},
    };
  },
};
const cachedService = new LicenseService(new CachedLicenseProvider(cacheStore, fallbackProvider, 300000));
assert.equal(await cachedService.isFeatureEnabled('cached.feature'), false);
assert.equal(await cachedService.isFeatureEnabled('cached.feature'), false);
assert.equal(fallbackCalls, 1);

licenseService.useProviderForTest(new EnvLicenseProvider({
  features: {
    'portal.activities': false,
  },
}));
let statusCode = 0;
let payload: unknown;
const reply = {
  status(code: number) {
    statusCode = code;
    return this;
  },
  send(body: unknown) {
    payload = body;
    return body;
  },
};
await requireFeature('portal.activities')(
  { agent: { id: 'agent-1', tenantId: 'tenant-1', role: 'admin' } } as never,
  reply as never,
);
assert.equal(statusCode, 402);
assert.equal((payload as { error: { code: string } }).error.code, 'FEATURE_NOT_ENABLED');

console.log('license.service.test.ts passed');
process.exit(0);
