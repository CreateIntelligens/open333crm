/**
 * Instagram 渠道的建立、驗證與憑證（主規格 threads-channel，change restore-instagram-channel-spec）：
 * - 「驗證 Instagram 渠道的權杖」
 * - 「後台建立 Instagram 渠道」
 * - 「後台顯示 Instagram 渠道的驗證權杖」
 * Graph API 以假 fetch 取代，資料庫換成記憶體版本，憑證以真實的加解密處理。
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, test, vi } from 'vitest';

process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'unit-test-credential-encryption-key!!!!';

const { encryptCredentials, decryptCredentials, getChannel, updateChannel, verifyChannel } = await import(
  '#src/modules/channel/channel.service.js'
);

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const CHANNEL = '33333333-3333-4333-8333-333333333333';

/** 一個 Instagram 渠道的記憶體資料庫 */
function igDb(credentials: Record<string, unknown>) {
  const row: Record<string, unknown> = {
    id: CHANNEL, tenantId: TENANT, channelType: 'THREADS', displayName: 'IG', isActive: true,
    credentialsEncrypted: encryptCredentials(credentials), settings: {}, externalAccountId: null,
  };
  const db = {
    channel: {
      findFirst: async () => ({ ...row }),
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(row, data),
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    $executeRaw: async () => 1,
    $queryRaw: async () => [],
  };
  return { db, row };
}

afterEach(() => vi.unstubAllGlobals());

test('權杖有效：以 pageAccessToken 呼叫 graph.instagram.com 的 /me，驗證成功', async () => {
  const calls: Array<{ url: string; auth: string | null }> = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
    return new Response(JSON.stringify({ user_id: '17841400000000001', username: 'shop' }), { status: 200 });
  });
  const { db } = igDb({ pageAccessToken: 'ig-token', appSecret: 's' });
  const result = await verifyChannel(db as never, CHANNEL, TENANT);
  assert.equal(result.verified, true);
  assert.ok(calls[0]!.url.startsWith('https://graph.instagram.com/'), calls[0]!.url);
  assert.ok(calls[0]!.url.includes('/me'), calls[0]!.url);
  assert.equal(calls[0]!.auth, 'Bearer ig-token');
});

test('權杖無效：Graph API 回傳錯誤時回 400 CHANNEL_VERIFY_FAILED，details.upstream 帶 Meta 的錯誤訊息', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token' } }), { status: 400 }));
  const { db } = igDb({ pageAccessToken: 'expired', appSecret: 's' });
  await assert.rejects(verifyChannel(db as never, CHANNEL, TENANT), (err: { code?: string; statusCode?: number; details?: { upstream?: string } }) => {
    assert.equal(err.code, 'CHANNEL_VERIFY_FAILED');
    assert.equal(err.statusCode, 400);
    // 回應沒有 user_id 時也回同一個錯誤碼；details.upstream 分辨是 Graph API 拒絕了權杖
    assert.equal(err.details?.upstream, 'Invalid OAuth access token');
    return true;
  });
});

test('讀取 Instagram 渠道的憑證：verifyToken 完整回傳，appSecret 遮罩', async () => {
  const { db } = igDb({ verifyToken: 'verify-abc', appSecret: 'secret-1234567890', pageAccessToken: 'token-abcdefghijk' });
  const channel = await getChannel(db as never, CHANNEL, TENANT);
  assert.equal(channel.credentials.verifyToken, 'verify-abc');
  assert.equal(channel.credentials.appSecret, 'secr...7890');
  assert.notEqual(channel.credentials.pageAccessToken, 'token-abcdefghijk');
});

test('只更新部分憑證：只送 appSecret 時，pageAccessToken 與 verifyToken 保留原值', async () => {
  const { db, row } = igDb({ appSecret: 'old-secret', pageAccessToken: 'ig-token', verifyToken: 'verify-abc' });
  await updateChannel(db as never, CHANNEL, TENANT, { credentials: { appSecret: 'new-secret' } });
  assert.deepEqual(decryptCredentials(row.credentialsEncrypted as string), {
    appSecret: 'new-secret',
    pageAccessToken: 'ig-token',
    verifyToken: 'verify-abc',
  });
});

// ── 建立渠道的路由 ────────────────────────────────────────────────────

let app: FastifyInstance;
const created: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  const { default: channelRoutes } = await import('#src/modules/channel/channel.routes.js');
  const { default: errorHandlerPlugin } = await import('#src/plugins/error-handler.plugin.js');
  const tx = {
    tenant: { findUnique: async () => ({ limitOverrides: null, plan: null }) },
    channel: {
      count: async () => 0,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: CHANNEL, ...data };
        created.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = created.find((c) => c.id === where.id)!;
        return Object.assign(row, data);
      },
    },
    agent: { findMany: async () => [{ id: AGENT }] },
    agentChannelAccess: { createMany: async ({ data }: { data: unknown[] }) => ({ count: data.length }) },
    $executeRaw: async () => 1,
    tenantAuditLog: { create: async () => ({}) },
  };
  app = Fastify();
  app.decorate('prisma', { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) } as never);
  app.decorate('authenticate', async (request: never) => {
    const req = request as { agent?: unknown; tenantPrisma?: unknown };
    req.agent = { id: AGENT, tenantId: TENANT, isCliSession: true };
    req.tenantPrisma = tx;
  });
  app.decorateRequest('agent', null);
  app.decorateRequest('tenantPrisma', null);
  await app.register(errorHandlerPlugin);
  await app.register(channelRoutes, { prefix: '/api/v1/channels' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

test('建立 Instagram 渠道：channelType 為 THREADS，webhookUrl 指向 Instagram 的 webhook 路由', async () => {
  created.length = 0;
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/channels',
    payload: {
      channelType: 'THREADS',
      displayName: '官方 IG',
      credentials: { appSecret: 'ig-app-secret', pageAccessToken: 'ig-token', verifyToken: 'verify-abc' },
      webhookBaseUrl: 'https://api.example.com',
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(created.length, 1);
  assert.equal(created[0]!.channelType, 'THREADS');
  assert.equal(created[0]!.webhookUrl, `https://api.example.com/api/v1/webhooks/threads/${CHANNEL}`);
  assert.deepEqual(decryptCredentials(created[0]!.credentialsEncrypted as string), {
    appSecret: 'ig-app-secret',
    pageAccessToken: 'ig-token',
    verifyToken: 'verify-abc',
  });
});

test('缺少 appSecret：回 400，不建立渠道', async () => {
  created.length = 0;
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/channels',
    payload: { channelType: 'THREADS', displayName: '官方 IG', credentials: { pageAccessToken: 'ig-token' } },
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(created.length, 0);
});
