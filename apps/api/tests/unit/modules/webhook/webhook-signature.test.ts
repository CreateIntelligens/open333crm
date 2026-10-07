/**
 * AUDIT CHAN-03：
 * - 主規格 line-webhook-events「LINE Webhook signature verification」：簽章缺少或錯誤時回 HTTP 403。
 * - 進站路由的渠道類型要與渠道本身的類型一致，不符時丟棄，不以其他類型的外掛處理。
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { beforeEach, test, vi } from 'vitest';
import { LinePlugin } from '@open333crm/channel-plugins';

const LINE_CHANNEL = '11111111-1111-4111-8111-111111111111';
const FB_CHANNEL = '22222222-2222-4222-8222-222222222222';
const SECRET = 'line-channel-secret';

const fbVerifyCalls = vi.hoisted(() => ({ count: 0 }));
const decryptState = vi.hoisted(() => ({ fail: false }));
const fbState = vi.hoisted(() => ({ throwOnVerify: false }));
const linePlugin = new LinePlugin();

vi.mock('@open333crm/channel-plugins', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@open333crm/channel-plugins')>();
  const fbPlugin = {
    channelType: 'FB',
    verifySignature: () => {
      fbVerifyCalls.count += 1;
      if (fbState.throwOnVerify) throw new TypeError('signature.startsWith is not a function');
      return true;
    },
    parseWebhook: async () => [],
  };
  return {
    ...actual,
    getChannelPlugin: (type: string) => (type === 'LINE' ? linePlugin : type === 'FB' ? fbPlugin : undefined),
  };
});

vi.mock('#src/modules/channel/channel.service.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  decryptCredentials: () => {
    if (decryptState.fail) throw new Error('Unsupported state or unable to authenticate data');
    return { channelSecret: SECRET, appSecret: 'fb-app-secret' };
  },
}));

const DISABLED_TENANT_CHANNEL = '33333333-3333-4333-8333-333333333333';
const MISSING_CHANNEL = '44444444-4444-4444-8444-444444444444';
const channels: Record<string, { id: string; tenantId: string; channelType: string; tenantActive?: boolean }> = {
  [LINE_CHANNEL]: { id: LINE_CHANNEL, tenantId: 'tenant-1', channelType: 'LINE' },
  [FB_CHANNEL]: { id: FB_CHANNEL, tenantId: 'tenant-1', channelType: 'FB' },
  [DISABLED_TENANT_CHANNEL]: { id: DISABLED_TENANT_CHANNEL, tenantId: 'tenant-2', channelType: 'LINE', tenantActive: false },
};

function prismaMock() {
  return {
    channel: {
      findFirst: async ({ where }: any) => {
        const c = channels[where.id];
        if (!c) return null;
        const { tenantActive = true, ...rest } = c;
        return { ...rest, isActive: true, credentialsEncrypted: 'x', settings: {}, externalAccountId: null, tenant: { isActive: tenantActive } };
      },
    },
  } as any;
}

const lineBody = JSON.stringify({ destination: 'U0', events: [] });
const sign = (raw: string) => createHmac('sha256', SECRET).update(raw).digest('base64');

async function buildApp() {
  const { default: webhookRoutes } = await import('#src/modules/webhook/webhook.routes.js');
  const app = Fastify();
  app.decorate('prismaAdmin', prismaMock());
  app.decorate('io', { to: () => ({ emit() {} }) } as any);
  await app.register(webhookRoutes);
  return app;
}

beforeEach(() => { fbVerifyCalls.count = 0; decryptState.fail = false; fbState.throwOnVerify = false; });

test('LINE webhook：簽章錯誤回 403', async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST', url: `/line/${LINE_CHANNEL}`, payload: lineBody,
    headers: { 'content-type': 'application/json', 'x-line-signature': sign('tampered') },
  });
  assert.equal(res.statusCode, 403);
});

test('LINE webhook：缺少簽章回 403', async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST', url: `/line/${LINE_CHANNEL}`, payload: lineBody,
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(res.statusCode, 403);
});

test('LINE webhook：簽章長度不同回 403', async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST', url: `/line/${LINE_CHANNEL}`, payload: lineBody,
    headers: { 'content-type': 'application/json', 'x-line-signature': 'short' },
  });
  assert.equal(res.statusCode, 403);
});

test('LINE webhook：正確的簽章回 200', async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST', url: `/line/${LINE_CHANNEL}`, payload: lineBody,
    headers: { 'content-type': 'application/json', 'x-line-signature': sign(lineBody) },
  });
  assert.equal(res.statusCode, 200);
});

test('LINE webhook：網址是 Facebook 渠道的 ID 時回 403', async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST', url: `/line/${FB_CHANNEL}`, payload: lineBody,
    headers: { 'content-type': 'application/json', 'x-line-signature': sign(lineBody) },
  });
  assert.equal(res.statusCode, 403);
});

test('processWebhookEvent：渠道類型與路由不符時丟棄，不以路由類型的外掛驗簽', async () => {
  const { processWebhookEvent } = await import('#src/modules/webhook/webhook.service.js');
  const io = { to: () => ({ emit() {} }) } as any;
  // LINE 渠道的 ID 送到 Facebook 的路由
  await assert.doesNotReject(
    processWebhookEvent(prismaMock(), io, LINE_CHANNEL, 'FB', Buffer.from('{}'), { 'x-hub-signature-256': 'sha256=x' }),
  );
  assert.equal(fbVerifyCalls.count, 0);
});

test('LINE webhook：重複的簽章標頭視為驗簽失敗，回 403', async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST', url: `/line/${LINE_CHANNEL}`, payload: lineBody,
    headers: { 'content-type': 'application/json', 'x-line-signature': [sign(lineBody), sign(lineBody)] as any },
  });
  assert.equal(res.statusCode, 403);
});

test('verifyWebhookRequest：外掛驗簽拋出錯誤時視為驗簽失敗', async () => {
  // 例如標頭重複時值是陣列，Facebook 外掛的 startsWith 會拋出錯誤
  fbState.throwOnVerify = true;
  const { verifyWebhookRequest } = await import('#src/modules/webhook/webhook.service.js');
  const r = await verifyWebhookRequest(prismaMock(), FB_CHANNEL, 'FB', Buffer.from('{}'), {})
    .catch((err: Error) => ({ threw: err.message }));
  assert.deepEqual(r, { ok: false, reason: 'invalid_signature' });
});

test('LINE webhook：渠道憑證無法解密時回 500', async () => {
  decryptState.fail = true;
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST', url: `/line/${LINE_CHANNEL}`, payload: lineBody,
    headers: { 'content-type': 'application/json', 'x-line-signature': sign(lineBody) },
  });
  assert.equal(res.statusCode, 500);
});

test('LINE webhook：渠道不存在時維持回 200 並丟棄', async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST', url: `/line/${MISSING_CHANNEL}`, payload: lineBody,
    headers: { 'content-type': 'application/json', 'x-line-signature': sign(lineBody) },
  });
  assert.equal(res.statusCode, 200);
});

test('LINE webhook：租戶停用時維持回 200 並丟棄', async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST', url: `/line/${DISABLED_TENANT_CHANNEL}`, payload: lineBody,
    headers: { 'content-type': 'application/json', 'x-line-signature': sign(lineBody) },
  });
  assert.equal(res.statusCode, 200);
});
