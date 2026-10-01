/**
 * 平台 Meta 連結的路由層行為（change fix-meta-webhook-page-routing，code review 補測）：
 * /start 設綁定 cookie、/callback 比對瀏覽器、各種失敗一律導回渠道頁（不停在 JSON 錯誤頁）、權限守門。
 *
 * Graph API 以假 fetch 取代、Redis 以記憶體 store 取代；權限判斷走真實 requirePermission（需要 DATABASE_URL）。
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';

process.env.META_APP_ID = 'ci-platform-app';
process.env.META_APP_SECRET = 'ci-platform-secret';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'ci-verify';
process.env.META_CONNECT_REDIRECT_URI = 'https://crm.example.test/api/v1/meta-connect/callback';
process.env.WEB_BASE_URL = 'https://crm.example.test';

const Fastify = (await import('fastify')).default;
const cookie = (await import('@fastify/cookie')).default;
const { PrismaClient } = await import('@prisma/client');
const { loadEnvConfig } = await import('#src/config/env.js');
const { tenantScopedClient } = await import('#src/lib/tenant-db.js');
const metaConnectRoutes = (await import('#src/modules/meta-connect/meta-connect.routes.js')).default;
const { memBindingStore } = await import('#tests/support/mem-binding-store.js');

loadEnvConfig();
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  if (url.includes('/oauth/access_token') && url.includes('code=GOOD')) return json({ access_token: 'short' });
  if (url.includes('fb_exchange_token=short')) return json({ access_token: 'long' });
  if (url.includes('/me/accounts')) return json({ data: [{ id: '123', name: 'CI 粉專', access_token: 'page-token' }] });
  return json({ error: { message: 'unexpected' } }, 400);
}) as typeof fetch;

const prisma = new PrismaClient();
const T = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const stamp = Date.now();
const CHANNELS_PAGE = 'https://crm.example.test/dashboard/settings/channels';

const roles: string[] = [];
const apps: Array<{ close: () => Promise<unknown> }> = [];

async function buildApp(roleId: string, store = memBindingStore()) {
  const app = Fastify();
  await app.register(cookie);
  app.decorate('prisma', prisma);
  app.decorate('prismaAdmin', prisma);
  app.decorate('authenticate', async (request: any) => {
    request.agent = { id: '00000000-0000-4000-8000-0000000000a1', tenantId: T, role: 'AGENT', roleId };
    request.tenantPrisma = tenantScopedClient(prisma, T);
  });
  await app.register(metaConnectRoutes, { prefix: '/api/v1/meta-connect', store });
  await app.ready();
  apps.push(app);
  return app;
}

const mkRole = async (slug: string, permissions: string[]) => {
  const r = await prisma.role.create({
    data: {
      tenantId: T,
      slug: `ci-metaconnect-${slug}-${stamp}`,
      name: `CI 平台連結路由（${slug}）`,
      permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) },
    },
  });
  roles.push(r.id);
  return r;
};

const creator = await mkRole('creator', ['channel.view', 'channel.create']);
const viewer = await mkRole('viewer', ['channel.view']);
const app = await buildApp(creator.id);

const start = async () => {
  const res = await app.inject({ method: 'POST', url: '/api/v1/meta-connect/start' });
  assert.equal(res.statusCode, 200, res.body);
  const url = res.json().data.url as string;
  const setCookie = res.cookies.find((c) => c.name === 'metaConnectState');
  return { res, url, state: new URL(url).searchParams.get('state')!, cookieValue: setCookie?.value, setCookie };
};
const callback = (query: string, cookieValue?: string) =>
  app.inject({
    method: 'GET',
    url: `/api/v1/meta-connect/callback?${query}`,
    cookies: cookieValue ? { metaConnectState: cookieValue } : {},
  });

test('/start：設定 HttpOnly、SameSite=Lax、限 meta-connect 路徑的綁定 cookie；回應不含 state', async () => {
  const { res, setCookie } = await start();
  assert.ok(setCookie, '要設定綁定 cookie');
  assert.equal(setCookie!.httpOnly, true);
  assert.equal(String(setCookie!.sameSite).toLowerCase(), 'lax');
  assert.equal(setCookie!.path, '/api/v1/meta-connect');
  assert.deepEqual(Object.keys(res.json().data), ['url']);
});

test('/callback 帶正確 cookie：導回渠道頁並帶 connectId', async () => {
  const { state, cookieValue } = await start();
  const res = await callback(`code=GOOD&state=${state}`, cookieValue);
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.location as string, new RegExp(`^${CHANNELS_PAGE}\\?metaConnect=`));
  const cleared = res.cookies.find((c) => c.name === 'metaConnectState');
  assert.ok(cleared && (cleared.value === '' || (cleared.maxAge ?? 1) <= 0 || cleared.expires), '用過就清掉 cookie');
});

test('/callback 沒帶 cookie（別的瀏覽器完成授權）：導回錯誤', async () => {
  const { state } = await start();
  const res = await callback(`code=GOOD&state=${state}`);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, `${CHANNELS_PAGE}?metaConnectError=invalid_state`);
});

test('/callback 參數格式異常：導回錯誤頁，不回 400 JSON', async () => {
  const res = await callback(`code=GOOD&state=${'x'.repeat(200)}`);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, `${CHANNELS_PAGE}?metaConnectError=invalid_state`);
});

test('/callback 內部錯誤（Redis 斷線）：導回 exchange_failed，不回 500 JSON', async () => {
  const broken = {
    set: async () => 'OK' as const,
    get: async () => null,
    getdel: async () => {
      throw new Error('redis down');
    },
  };
  const brokenApp = await buildApp(creator.id, broken as never);
  const res = await brokenApp.inject({ method: 'GET', url: '/api/v1/meta-connect/callback?code=GOOD&state=abc' });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, `${CHANNELS_PAGE}?metaConnectError=exchange_failed`);
});

test('只有檢視權限：/start 被擋（403）', async () => {
  const viewerApp = await buildApp(viewer.id);
  const res = await viewerApp.inject({ method: 'POST', url: '/api/v1/meta-connect/start' });
  assert.equal(res.statusCode, 403);
});

afterAll(async () => {
  for (const a of apps) await a.close().catch(() => {});
  if (roles.length) await prisma.role.deleteMany({ where: { id: { in: roles } } });
  await prisma.$disconnect();
});
