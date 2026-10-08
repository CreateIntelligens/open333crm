/**
 * 平台路由的認證（主規格 platform-auth「平台 superuser 獨立認證路徑」「平台路由一律驗證平台帳號」）
 * 與須改密碼的限制（主規格 platform-user-management「帳號標記須改密碼時，除改密碼外的平台功能一律受阻」）。
 *
 * 走真實的 auth.plugin 與 platform.routes。Prisma 換成只有平台帳號的記憶體版本。
 * 平台路由的清單由 onRoute 收集，之後新增的平台路由也會被檢查。
 */
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-platform-guard-tenant-secret';
process.env.PLATFORM_JWT_SECRET ||= 'test-platform-guard-platform-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';

const { default: authPlugin } = await import('#src/plugins/auth.plugin.js');
const { default: errorHandlerPlugin } = await import('#src/plugins/error-handler.plugin.js');
const { default: platformRoutes } = await import('#src/modules/platform/platform.routes.js');
const { loadEnvConfig } = await import('#src/config/env.js');
const { hashPassword, verifyPassword } = await import('#src/shared/utils/password.js');

const PREFIX = '/api/v1/platform';
/** 不需要 token 的平台路由 */
const PUBLIC = ['POST /auth/login', 'POST /auth/forgot-password', 'POST /auth/reset-password'];
/** 須改密碼時仍可呼叫的路由 */
const CHANGE_PASSWORD = 'POST /auth/change-password';
const ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const EMAIL = 'ops@example.com';
const PASSWORD = 'Temp-Password-1';

interface UserRow {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  isActive: boolean;
  mustChangePassword: boolean;
}
const users = new Map<string, UserRow>();
let passwordHash = '';

const prisma = {
  platformUser: {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
      [...users.values()].find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
      const user = users.get(where.id)!;
      Object.assign(user, data);
      return user;
    },
  },
  plan: { findMany: async () => [] },
  platformAuditLog: { create: async () => ({}) },
};

let app: FastifyInstance;
const routes: string[] = [];

beforeAll(async () => {
  loadEnvConfig();
  passwordHash = await hashPassword(PASSWORD);
  app = Fastify();
  app.decorate('prisma', prisma as never);
  app.decorate('prismaAdmin', prisma as never);
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith(PREFIX)) return;
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD') routes.push(`${method} ${route.url.slice(PREFIX.length)}`);
    }
  });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(platformRoutes, { prefix: PREFIX });
  // 租戶 API 的認證路徑
  app.get('/api/v1/agents', { preHandler: [app.authenticate] }, async () => ({ ok: true }));
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  users.clear();
  users.set(USER_ID, { id: USER_ID, email: EMAIL, name: 'Ops', passwordHash, isActive: true, mustChangePassword: false });
});

const guarded = () => routes.filter((r) => !PUBLIC.includes(r));

function call(route: string, token?: string, payload?: unknown) {
  const [method, path] = route.split(' ') as [string, string];
  return app.inject({
    method: method as never,
    url: PREFIX + path.replace(/:[A-Za-z]+/g, ID),
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: payload as never,
  });
}

const platformToken = (payload: Record<string, unknown> = { platformUserId: USER_ID, role: 'PLATFORM_SUPERUSER' }) =>
  (app.jwt as unknown as { platform: { sign: (p: object) => string } }).platform.sign(payload);
const tenantToken = () => app.jwt.sign({ agentId: 'a1', tenantId: 't1', role: 'ADMIN', roleId: null, typ: 'access' });

/** 對每一條路由呼叫一次，回傳不符合預期的路由與實際回應 */
async function mismatches(list: string[], token: string | undefined, status: number, code: string) {
  const wrong: string[] = [];
  for (const route of list) {
    const res = await call(route, token);
    const body = res.json() as { error?: { code?: string } };
    if (res.statusCode !== status || body.error?.code !== code) wrong.push(`${route} → ${res.statusCode} ${res.body}`);
  }
  return wrong;
}

test('收集到平台路由：公開端點與改密碼都在清單裡', () => {
  for (const route of [...PUBLIC, CHANGE_PASSWORD, 'GET /plans', 'PATCH /plan-change-requests/:id/approve']) {
    assert.ok(routes.includes(route), `缺少 ${route}`);
  }
});

// ── platform-auth：平台 superuser 獨立認證路徑 ──

test('平台帳號登入成功：回傳平台 JWT，role 是 PLATFORM_SUPERUSER', async () => {
  const res = await call('POST /auth/login', undefined, { email: EMAIL, password: PASSWORD });

  assert.equal(res.statusCode, 200, res.body);
  const { token } = res.json().data as { token: string };
  const payload = (app.jwt as unknown as { platform: { verify: (t: string) => Record<string, unknown> } }).platform.verify(token);
  assert.equal(payload.role, 'PLATFORM_SUPERUSER');
  assert.equal(payload.platformUserId, USER_ID);
});

test('租戶 JWT 打平台 API：每一條需要登入的平台路由都回 401 UNAUTHORIZED', async () => {
  assert.deepEqual(await mismatches(guarded(), tenantToken(), 401, 'UNAUTHORIZED'), []);
});

// ── platform-auth：平台路由一律驗證平台帳號 ──

test('未帶 token 存取平台 API：每一條需要登入的平台路由都回 401 UNAUTHORIZED', async () => {
  assert.deepEqual(await mismatches(guarded(), undefined, 401, 'UNAUTHORIZED'), []);
});

test('只有 3 個公開端點不需要 token：不帶 token 時，只有登入、忘記密碼、重設密碼不回 401', async () => {
  const open: string[] = [];
  for (const route of routes) {
    if ((await call(route)).statusCode !== 401) open.push(route);
  }
  assert.deepEqual(open.sort(), [...PUBLIC].sort());
});

test('token 的角色不是平台管理員：回 403 FORBIDDEN', async () => {
  const token = platformToken({ platformUserId: USER_ID, role: 'ADMIN' });
  assert.deepEqual(await mismatches(['GET /plans', CHANGE_PASSWORD], token, 403, 'FORBIDDEN'), []);
});

test('平台帳號不存在：回 401 UNAUTHORIZED', async () => {
  users.clear();
  assert.deepEqual(await mismatches(['GET /plans', CHANGE_PASSWORD], platformToken(), 401, 'UNAUTHORIZED'), []);
});

test('平台帳號已停用：未過期的 token 也回 401 PLATFORM_USER_DISABLED', async () => {
  users.get(USER_ID)!.isActive = false;
  assert.deepEqual(await mismatches(['GET /plans', CHANGE_PASSWORD], platformToken(), 401, 'PLATFORM_USER_DISABLED'), []);
});

test('平台 JWT 打租戶 API：回 401', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/agents', headers: { authorization: `Bearer ${platformToken()}` } });
  assert.equal(res.statusCode, 401, res.body);
});

// ── platform-user-management：帳號標記須改密碼時，除改密碼外的平台功能一律受阻 ──

test('標記須改密碼的帳號嘗試存取其他平台功能：改密碼以外的平台路由都回 403 MUST_CHANGE_PASSWORD', async () => {
  users.get(USER_ID)!.mustChangePassword = true;
  const list = guarded().filter((r) => r !== CHANGE_PASSWORD);
  assert.deepEqual(await mismatches(list, platformToken(), 403, 'MUST_CHANGE_PASSWORD'), []);
});

test('標記須改密碼的帳號可呼叫改密碼 API：改密碼成功並清除標記，之後可以存取其他平台功能', async () => {
  users.get(USER_ID)!.mustChangePassword = true;
  const token = platformToken();

  const res = await call(CHANGE_PASSWORD, token, { oldPassword: PASSWORD, newPassword: 'New-Password-123' });

  assert.equal(res.statusCode, 200, res.body);
  const user = users.get(USER_ID)!;
  assert.equal(user.mustChangePassword, false);
  assert.equal(await verifyPassword('New-Password-123', user.passwordHash), true);
  assert.equal((await call('GET /plans', token)).statusCode, 200);
});
