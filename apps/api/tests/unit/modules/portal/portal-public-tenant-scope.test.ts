/**
 * 粉絲門戶公開端點的租戶邊界（AUDIT RLS-07 的 code review）。
 * 原本整個檔案走 prismaAdmin（BYPASSRLS），只靠查詢條件自行帶 tenantId；
 * 但 /me/points 的 getPointBalance 沒帶 tenantId，在 BYPASSRLS 連線上只以 contactId 查。
 * 請求的租戶已由驗簽的 fanToken 確定，不需要 BYPASSRLS：改以 withTenant 綁定租戶，RLS 仍是第二道防線。
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-portal-public-jwt-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

const { loadEnvConfig } = await import('#src/config/env.js');
const { signFanToken } = await import('#src/modules/portal/portal-auth.service.js');
const { default: portalPublicRoutes } = await import('#src/modules/portal/portal-public.routes.js');

const TENANT = 'a0000000-0000-0000-0000-0000000000aa';
const CONTACT = 'c0000000-0000-0000-0000-0000000000cc';

let app: FastifyInstance;
const boundTenants: string[] = [];
const pointWheres: unknown[] = [];
/** 路由對 prismaAdmin 的存取（Fastify 註冊 decorator 時讀的 getter/setter 等不算） */
const adminAccess: string[] = [];

const tx = {
  $executeRaw: async (_s: TemplateStringsArray, tenantId: string) => {
    boundTenants.push(tenantId);
    return 1;
  },
  pointTransaction: {
    findFirst: async (args: { where: unknown }) => {
      pointWheres.push(args.where);
      return { balance: 30 };
    },
    findMany: async () => [],
    count: async () => 0,
  },
};

beforeAll(async () => {
  loadEnvConfig();
  app = Fastify();
  app.decorate('prisma', { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } as never);
  // 記錄存取：粉絲端點不應再使用 BYPASSRLS 連線
  app.decorate(
    'prismaAdmin',
    new Proxy({}, {
      get: (_t, prop) => {
        if (typeof prop === 'string' && !['getter', 'setter', 'then', 'toJSON'].includes(prop)) adminAccess.push(prop);
        return undefined;
      },
    }) as never,
  );
  await app.register(portalPublicRoutes, { prefix: '/api/v1/fan' });
  await app.ready();
});

beforeEach(() => {
  boundTenants.length = 0;
  adminAccess.length = 0;
  pointWheres.length = 0;
});

afterAll(async () => {
  await app.close();
});

test('GET /me/points：在 fanToken 的租戶內查詢，積分餘額帶 tenantId', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/fan/me/points',
    headers: { authorization: `Bearer ${signFanToken(CONTACT, TENANT)}` },
  });
  assert.deepEqual(adminAccess, [], '粉絲門戶不應使用 prismaAdmin');
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().data.balance, 30);
  assert.ok(boundTenants.length > 0 && boundTenants.every((t) => t === TENANT), '查詢要在 withTenant 綁定的租戶內執行');
  assert.ok(
    pointWheres.length > 0 && pointWheres.every((w) => (w as { tenantId?: string }).tenantId === TENANT),
    `積分查詢都要帶 tenantId：${JSON.stringify(pointWheres)}`,
  );
});
