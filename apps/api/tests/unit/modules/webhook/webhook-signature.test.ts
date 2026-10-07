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
const linePlugin = new LinePlugin();

vi.mock('@open333crm/channel-plugins', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@open333crm/channel-plugins')>();
  const fbPlugin = {
    channelType: 'FB',
    verifySignature: () => { fbVerifyCalls.count += 1; return true; },
    parseWebhook: async () => [],
  };
  return {
    ...actual,
    getChannelPlugin: (type: string) => (type === 'LINE' ? linePlugin : type === 'FB' ? fbPlugin : undefined),
  };
});

vi.mock('#src/modules/channel/channel.service.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  decryptCredentials: () => ({ channelSecret: SECRET, appSecret: 'fb-app-secret' }),
}));

const channels: Record<string, { id: string; tenantId: string; channelType: string }> = {
  [LINE_CHANNEL]: { id: LINE_CHANNEL, tenantId: 'tenant-1', channelType: 'LINE' },
  [FB_CHANNEL]: { id: FB_CHANNEL, tenantId: 'tenant-1', channelType: 'FB' },
};

function prismaMock() {
  return {
    channel: {
      findFirst: async ({ where }: any) => {
        const c = channels[where.id];
        return c ? { ...c, isActive: true, credentialsEncrypted: 'x', settings: {}, externalAccountId: null, tenant: { isActive: true } } : null;
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

beforeEach(() => { fbVerifyCalls.count = 0; });

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
