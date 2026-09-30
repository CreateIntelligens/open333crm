/**
 * 聯絡人路由權限守門（路由層整合測試，走真實 requirePermission 與權限計算）。
 *
 * 背景：contact.view／contact.update 權限點早已定義，但多數 /api/v1/contacts/* 路由沒套用，
 * 只要登入即可讀寫任何聯絡人。本測試確保每一條路由都有守門，且有權限時照常放行。
 *
 * 需要 DATABASE_URL（建立兩個測試角色，結束時刪除）。
 * 執行：DATABASE_URL=... tsx src/__tests__/contact-routes-permission.test.ts
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '../config/env.js';
import { tenantScopedClient } from '../lib/tenant-db.js';
import contactRoutes from '../modules/contact/contact.routes.js';

if (!process.env.DATABASE_URL) {
  console.log('SKIP contact-routes-permission: 需 DATABASE_URL');
  process.exit(0);
}

loadEnvConfig();
const prisma = new PrismaClient();
const T = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const SOME_ID = '00000000-0000-4000-8000-000000000abc';
const stamp = Date.now();

async function createRole(slug: string, permissions: string[]) {
  return prisma.role.create({
    data: {
      tenantId: T,
      slug: `ci-${slug}-${stamp}`,
      name: `CI 權限測試（${slug}）`,
      permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) },
    },
  });
}

async function buildApp(roleId: string) {
  const app = Fastify();
  app.decorate('prisma', prisma);
  app.decorate('prismaAdmin', prisma);
  app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: SOME_ID, tenantId: T, role: 'AGENT', roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
  });
  await app.register(contactRoutes, { prefix: '/api/v1/contacts' });
  await app.ready();
  return app;
}

/** 每一條聯絡人路由（method、url、body） */
const ROUTES: Array<{ method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: object }> = [
  { method: 'GET', url: '/api/v1/contacts' },
  { method: 'GET', url: `/api/v1/contacts/merge-preview?primaryId=${SOME_ID}&secondaryId=${SOME_ID}` },
  { method: 'POST', url: '/api/v1/contacts/merge', payload: { primaryContactId: SOME_ID, secondaryContactId: SOME_ID } },
  { method: 'POST', url: `/api/v1/contacts/merge-logs/${SOME_ID}/revert` },
  { method: 'GET', url: '/api/v1/contacts/identity-binding/status' },
  { method: 'POST', url: `/api/v1/contacts/${SOME_ID}/binding-link`, payload: { conversationId: SOME_ID } },
  { method: 'GET', url: `/api/v1/contacts/${SOME_ID}/merge-logs` },
  { method: 'GET', url: `/api/v1/contacts/${SOME_ID}` },
  { method: 'PATCH', url: `/api/v1/contacts/${SOME_ID}`, payload: { displayName: 'x' } },
  { method: 'GET', url: `/api/v1/contacts/${SOME_ID}/conversations` },
  { method: 'GET', url: `/api/v1/contacts/${SOME_ID}/cases` },
  { method: 'POST', url: `/api/v1/contacts/${SOME_ID}/tags`, payload: { tagId: SOME_ID } },
  { method: 'DELETE', url: `/api/v1/contacts/${SOME_ID}/tags/${SOME_ID}` },
  { method: 'GET', url: `/api/v1/contacts/${SOME_ID}/timeline` },
];

let failed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failed++;
    console.log(`not ok - ${name}`);
    console.error(err);
  }
}

const roles: string[] = [];
try {
  const none = await createRole('none', []);
  const viewOnly = await createRole('view-only', ['contact.view']);
  roles.push(none.id, viewOnly.id);

  const noPermApp = await buildApp(none.id);
  await check('沒有任何權限的角色：每一條聯絡人路由都回 403', async () => {
    const leaks: string[] = [];
    for (const r of ROUTES) {
      const res = await noPermApp.inject({ method: r.method, url: r.url, payload: r.payload });
      if (res.statusCode !== 403) leaks.push(`${r.method} ${r.url} → ${res.statusCode}`);
    }
    assert.deepEqual(leaks, [], `以下路由沒擋：\n${leaks.join('\n')}`);
  });

  const viewApp = await buildApp(viewOnly.id);
  await check('只有 contact.view：可讀聯絡人列表與詳情（不回 403）', async () => {
    const list = await viewApp.inject({ method: 'GET', url: '/api/v1/contacts?limit=1' });
    assert.equal(list.statusCode, 200);
    const detail = await viewApp.inject({ method: 'GET', url: `/api/v1/contacts/${SOME_ID}` });
    assert.notEqual(detail.statusCode, 403, '有 contact.view 應通過守門（查無此人回 404）');
  });

  await check('只有 contact.view：修改、貼標、合併仍回 403', async () => {
    for (const r of ROUTES.filter((x) => ['PATCH', 'POST', 'DELETE'].includes(x.method))) {
      const res = await viewApp.inject({ method: r.method, url: r.url, payload: r.payload });
      assert.equal(res.statusCode, 403, `${r.method} ${r.url}`);
    }
  });

  await check('只有 contact.view：看聯絡人的對話需 inbox.view、看案件需 case.view', async () => {
    const convs = await viewApp.inject({ method: 'GET', url: `/api/v1/contacts/${SOME_ID}/conversations` });
    assert.equal(convs.statusCode, 403);
    const cases = await viewApp.inject({ method: 'GET', url: `/api/v1/contacts/${SOME_ID}/cases` });
    assert.equal(cases.statusCode, 403);
  });

  await noPermApp.close();
  await viewApp.close();
} finally {
  if (roles.length) await prisma.role.deleteMany({ where: { id: { in: roles } } });
  await prisma.$disconnect();
}

console.log(`# fail ${failed}`);
process.exit(failed === 0 ? 0 : 1);
