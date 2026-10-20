/**
 * 門市管理與核銷台的路由層（store-redemption「管理者可管理門市與門市帳號」的權限、
 * 「核銷台每次操作都檢查帳號狀態」的 HTTP 狀態與錯誤碼）。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient, withTenant } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import storeRoutes from '#src/modules/store/store.routes.js';
import storeConsoleRoutes from '#src/modules/store/store-console.routes.js';
import { createStore, createStoreAccount, updateStoreAccount } from '#src/modules/store/store.service.js';
import { TENANT_A } from '#tests/setup/feature-config.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `store-route-${Date.now().toString(36)}`;
const AGENT_ID = '00000000-0000-4000-8000-0000000000ce';
const roles: string[] = [];

async function role(slug: string, permissions: string[]) {
  const r = await owner.role.create({
    data: { tenantId: T, slug: `${MARK}-${slug}`, name: `${MARK} ${slug}`, permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) } },
  });
  roles.push(r.id);
  return r.id;
}

async function adminApp(roleId: string) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', prisma);
  // 權限守門以 prismaAdmin 讀角色與方案
  app.decorate('prismaAdmin', owner);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: AGENT_ID, tenantId: T, role: 'AGENT', roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
  });
  await app.register(storeRoutes, { prefix: '/api/v1/stores' });
  await app.ready();
  return app;
}

async function consoleApp() {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', prisma);
  // 登入前依帳號名稱找租戶：測試用 owner 連線代替 BYPASSRLS
  app.decorate('prismaAdmin', owner);
  await app.register(storeConsoleRoutes, { prefix: '/api/v1/store-console' });
  await app.ready();
  return app;
}

let viewApp: FastifyInstance;
let manageApp: FastifyInstance;
let console: FastifyInstance;
let storeId = '';

beforeAll(async () => {
  viewApp = await adminApp(await role('view', ['store.view']));
  manageApp = await adminApp(await role('manage', ['store.view', 'store.manage']));
  console = await consoleApp();
  storeId = (await withTenant(prisma, T, (tx) => createStore(tx, T, { name: `${MARK} 門市` }))).id;
});

afterAll(async () => {
  await Promise.all([viewApp.close(), manageApp.close(), console.close()]);
  await owner.storeAccount.deleteMany({ where: { username: { startsWith: MARK } } });
  await owner.store.deleteMany({ where: { name: { startsWith: MARK } } });
  await owner.role.deleteMany({ where: { id: { in: roles } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe('管理者可管理門市與門市帳號', () => {
  it('缺少權限', async () => {
    const body = { username: `${MARK}-v`.slice(0, 32), password: 'dt3c2026x' };
    const denied = await viewApp.inject({ method: 'POST', url: `/api/v1/stores/${storeId}/accounts`, payload: body });
    assert.equal(denied.statusCode, 403, denied.body);
    const listed = await viewApp.inject({ method: 'GET', url: '/api/v1/stores' });
    assert.equal(listed.statusCode, 200);
    const created = await manageApp.inject({ method: 'POST', url: `/api/v1/stores/${storeId}/accounts`, payload: body });
    assert.equal(created.statusCode, 200);
    assert.ok(!JSON.stringify(created.json()).includes('passwordHash'));
  });
});

describe('核銷台每次操作都檢查帳號狀態（HTTP）', () => {
  it('沒有門市憑證時回 401', async () => {
    const res = await console.inject({ method: 'GET', url: '/api/v1/store-console/me' });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error.code, 'UNAUTHORIZED');
  });

  it('帳號停用後查券回 403 與錯誤碼', async () => {
    const username = `${MARK}-c`.slice(0, 32);
    const acc = await withTenant(prisma, T, (tx) => createStoreAccount(tx, T, { storeId, username, password: 'dt3c2026x' }));
    const login = await console.inject({ method: 'POST', url: '/api/v1/store-console/login', payload: { username, password: 'dt3c2026x' } });
    assert.equal(login.statusCode, 200, login.body);
    const token = login.json().data.token as string;
    await withTenant(prisma, T, (tx) => updateStoreAccount(tx, T, acc.id, { isActive: false }));
    const res = await console.inject({
      method: 'GET',
      url: '/api/v1/store-console/lookup?code=ABC',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'STORE_ACCOUNT_DISABLED');
  });

  it('開啟海報的連結', async () => {
    const res = await viewApp.inject({ method: 'GET', url: `/api/v1/stores/${storeId}/poster` });
    assert.equal(res.statusCode, 200, res.body);
    const data = res.json().data as { url: string; shortUrl: string; qrDataUrl: string; storeName: string };
    assert.ok(data.url.endsWith(`/redeem?store=${storeId}`), data.url);
    // 印在海報上給人手打的網址不帶門市 id（帳號本身綁定門市）
    assert.ok(data.shortUrl.endsWith('/redeem'), data.shortUrl);
    assert.ok(data.qrDataUrl.startsWith('data:image/png;base64,'));
    assert.equal(data.storeName, `${MARK} 門市`);
    // QR 只帶網址，不含任何登入憑證
    assert.ok(!/token|password/i.test(data.url));
  });

  it('登入頁依門市 id 顯示門市名稱', async () => {
    const res = await console.inject({ method: 'GET', url: `/api/v1/store-console/stores/${storeId}` });
    assert.equal(res.json().data.name, `${MARK} 門市`);
  });
});
