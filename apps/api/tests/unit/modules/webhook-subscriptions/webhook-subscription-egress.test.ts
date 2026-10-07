/**
 * webhook 訂閱的網址檢查與派送（主規格 webhook-subscription-egress）。
 * isBlockedUrl() 擋哪些網段，見 tests/unit/modules/webhook/webhook-ssrf.test.ts。
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, test, vi } from 'vitest';
import webhookSubscriptionRoutes from '#src/modules/webhook-subscriptions/webhook-subscription.routes.js';
import { dispatchWebhook } from '#src/modules/webhook-subscriptions/webhook-dispatcher.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';

// 公開位址用 IP 字面值，不需要真的查 DNS；只有 unresolvable.example 模擬解析失敗
vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  return {
    ...actual,
    lookup: (async (host: string, options: unknown) => {
      if (host === 'unresolvable.example') throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
      return actual.lookup(host, options as never);
    }) as typeof actual.lookup,
  };
});

const PUBLIC_URL = 'https://93.184.216.34/hook';
const SUB_ID = 'sub-1';

let app: FastifyInstance;
const created: Array<Record<string, unknown>> = [];
const updated: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  app = Fastify();
  const prisma = {
    webhookSubscription: {
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return { id: SUB_ID, ...args.data };
      },
      findFirst: async () => ({ id: SUB_ID, tenantId: 'tenant-1', url: PUBLIC_URL }),
      update: async (args: { data: Record<string, unknown> }) => {
        updated.push(args.data);
        return { id: SUB_ID, ...args.data };
      },
    },
  };
  // 已登入的請求：CLI session 身分讓 requirePermission 放行，只測網址檢查
  app.decorate('authenticate', async (request: never) => {
    const req = request as { agent?: unknown; tenantPrisma?: unknown };
    req.agent = { id: 'a1', tenantId: 'tenant-1', isCliSession: true };
    req.tenantPrisma = prisma;
  });
  app.decorateRequest('agent', null);
  app.decorateRequest('tenantPrisma', null);
  await app.register(errorHandlerPlugin);
  await app.register(webhookSubscriptionRoutes, { prefix: '/api/v1/webhook-subscriptions' });
  await app.ready();
});

beforeEach(() => {
  created.length = 0;
  updated.length = 0;
});

afterAll(async () => {
  await app.close();
});

const create = (url: string) => app.inject({
  method: 'POST',
  url: '/api/v1/webhook-subscriptions',
  payload: { url, events: ['message.received'] },
});

function assertRejected(res: { statusCode: number; body: string; json: () => { error?: { code?: string } } }) {
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error?.code, 'INVALID_WEBHOOK_URL', res.body);
}

test('建立時網址指向雲端 metadata：回 400 INVALID_WEBHOOK_URL，不建立訂閱', async () => {
  assertRejected(await create('https://169.254.169.254/latest/meta-data/'));
  assert.equal(created.length, 0);
});

test('建立時網址不是 HTTPS：回 400 INVALID_WEBHOOK_URL，不建立訂閱', async () => {
  assertRejected(await create('http://93.184.216.34/hook'));
  assert.equal(created.length, 0);
});

test('建立時主機無法解析：回 400 INVALID_WEBHOOK_URL，不建立訂閱', async () => {
  assertRejected(await create('https://unresolvable.example/hook'));
  assert.equal(created.length, 0);
});

test('更新時網址指向內部位址：回 400 INVALID_WEBHOOK_URL，不更新訂閱', async () => {
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/v1/webhook-subscriptions/${SUB_ID}`,
    payload: { url: 'https://127.0.0.1/hook' },
  });
  assertRejected(res);
  assert.equal(updated.length, 0);
});

test('建立時網址是公開的 HTTPS 位址：回 201，建立訂閱', async () => {
  const res = await create(PUBLIC_URL);
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(created.length, 1);
  assert.equal(created[0]!.url, PUBLIC_URL);
});

// ─── 派送 ───────────────────────────────────────────────────────────────

function createDeliveryPrisma() {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    webhookDelivery: {
      create: async () => ({ id: 'delivery-1' }),
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return { id: 'delivery-1', ...args.data };
      },
    },
  };
}

const requested: string[] = [];

beforeEach(() => {
  requested.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 派送有重試的等待時間，用假的計時器跑完 */
async function dispatch(prisma: ReturnType<typeof createDeliveryPrisma>, url: string) {
  vi.useFakeTimers();
  try {
    const pending = dispatchWebhook(prisma as never, SUB_ID, url, 'secret', 'message.received', { hello: 'world' });
    await vi.runAllTimersAsync();
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}

test('派送時網址指向內部位址：不送出請求，派送紀錄 attempts 1、success false、Blocked webhook target', async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    requested.push(url);
    return new Response('', { status: 200 });
  });
  const prisma = createDeliveryPrisma();

  const result = await dispatch(prisma, 'https://10.0.0.5/hook');

  assert.deepEqual(requested, []);
  assert.equal(result.success, false);
  assert.deepEqual(prisma.updates, [{ attempts: 1, success: false, errorMessage: 'Blocked webhook target' }]);
});

test('目的地回應轉址：不送出請求到轉址的網址，派送紀錄 success false', async () => {
  // 模擬目的地回應 302 到內部位址：fetch 預設會跟隨轉址；redirect 'error' 時拋出錯誤
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    requested.push(url);
    if (init?.redirect === 'error') throw new TypeError('fetch failed: unexpected redirect');
    if (init?.redirect === 'manual') return new Response('', { status: 302, headers: { location: 'https://10.0.0.5/' } });
    requested.push('https://10.0.0.5/');
    return new Response('', { status: 200 });
  });
  const prisma = createDeliveryPrisma();

  const result = await dispatch(prisma, PUBLIC_URL);

  assert.equal(requested.includes('https://10.0.0.5/'), false, `送出的請求：${requested.join(', ')}`);
  assert.ok(requested.length > 0 && requested.every((u) => u === PUBLIC_URL));
  assert.equal(result.success, false);
  assert.equal(prisma.updates.at(-1)?.success, false);
});
