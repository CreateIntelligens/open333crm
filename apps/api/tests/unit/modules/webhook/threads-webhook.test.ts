/**
 * Instagram 渠道的 webhook 路由（主規格 threads-channel「Webhook Verification」，
 * change restore-instagram-channel-spec）。外掛換成記錄驗簽 secret 的假外掛，資料庫換成記憶體版本。
 */
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, test, vi } from 'vitest';

const IG_CHANNEL = '11111111-1111-4111-8111-111111111111';
const BROKEN_CHANNEL = '22222222-2222-4222-8222-222222222222';
const MISSING_CHANNEL = '33333333-3333-4333-8333-333333333333';

const seen = vi.hoisted(() => ({ secrets: [] as string[], parsed: 0 }));

vi.mock('@open333crm/channel-plugins', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@open333crm/channel-plugins')>();
  const threads = {
    channelType: 'THREADS',
    verifySignature: (_raw: Buffer, _headers: unknown, secret: string) => {
      seen.secrets.push(secret);
      return secret === 'ig-app-secret';
    },
    parseWebhook: async () => {
      seen.parsed += 1;
      return [];
    },
  };
  return { ...actual, getChannelPlugin: (type: string) => (type === 'THREADS' ? threads : undefined) };
});

vi.mock('#src/modules/channel/channel.service.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  decryptCredentials: () => ({ appSecret: 'ig-app-secret', channelSecret: 'not-the-app-secret', verifyToken: 'verify-abc' }),
}));

function prismaMock() {
  return {
    channel: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        if (where.id === BROKEN_CHANNEL) throw new Error('database is down');
        if (where.id !== IG_CHANNEL) return null;
        return {
          id: IG_CHANNEL, tenantId: 'tenant-1', channelType: 'THREADS', isActive: true,
          credentialsEncrypted: 'x', settings: {}, externalAccountId: null, tenant: { isActive: true },
        };
      },
    },
  } as never;
}

let app: Awaited<ReturnType<typeof Fastify>>;

beforeAll(async () => {
  const { default: webhookRoutes } = await import('#src/modules/webhook/webhook.routes.js');
  app = Fastify();
  app.decorate('prismaAdmin', prismaMock());
  app.decorate('io', { to: () => ({ emit() {} }) } as never);
  await app.register(webhookRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const verifyUrl = (channelId: string, token: string) =>
  `/threads/${channelId}?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=challenge-123`;

/** POST 先回應、事件在背景處理：等背景處理走到外掛（最多 3 秒） */
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
}

beforeEach(() => {
  seen.secrets.length = 0;
  seen.parsed = 0;
});

test('Valid Verification Request：verify_token 相符時回 200 與 hub.challenge', async () => {
  const res = await app.inject({ method: 'GET', url: verifyUrl(IG_CHANNEL, 'verify-abc') });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'challenge-123');
});

test('驗證權杖不符：回 403，不回 hub.challenge', async () => {
  const res = await app.inject({ method: 'GET', url: verifyUrl(IG_CHANNEL, 'wrong-token') });
  assert.equal(res.statusCode, 403);
  assert.ok(!res.body.includes('challenge-123'));
});

test('驗證的渠道不存在：回 404', async () => {
  const res = await app.inject({ method: 'GET', url: verifyUrl(MISSING_CHANNEL, 'verify-abc') });
  assert.equal(res.statusCode, 404);
});

test('Webhook Message：以 appSecret 驗簽，通過後交給外掛解析', async () => {
  const res = await app.inject({
    method: 'POST', url: `/threads/${IG_CHANNEL}`,
    payload: JSON.stringify({ object: 'instagram', entry: [] }),
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=whatever' },
  });
  assert.equal(res.statusCode, 200);
  await waitFor(() => seen.parsed > 0);
  assert.deepEqual(seen.secrets, ['ig-app-secret']);
  assert.equal(seen.parsed, 1);
});

test('處理事件失敗仍回 200', async () => {
  const res = await app.inject({
    method: 'POST', url: `/threads/${BROKEN_CHANNEL}`,
    payload: JSON.stringify({ object: 'instagram', entry: [] }),
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=whatever' },
  });
  assert.equal(res.statusCode, 200);
});
