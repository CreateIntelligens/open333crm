/**
 * 圖文選單的 CRUD 與複製路由（change migrate-line-tenant-ctx，#337 階段 4 第一批搬遷前的回歸測試）。
 *
 * 搬遷前後都要通過。路由走真實的 requirePermission 與 app_tenant 連線（RLS）。
 * 每次執行建立兩個專用租戶，結束時整個刪除。這些路由不呼叫 LINE。
 */
import assert from 'node:assert/strict';
import { afterAll, describe, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import richMenuRoutes from '#src/modules/line/rich-menu.routes.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-rich-menu-${Date.now()}`;

const tenantA = await owner.tenant.create({ data: { name: `${MARK}-a` } });
const tenantB = await owner.tenant.create({ data: { name: `${MARK}-b` } });
const A = tenantA.id;
const B = tenantB.id;

async function makeAgent(tenantId: string, name = 'manager', codes = ['richmenu.manage']) {
  const role = await owner.role.create({
    data: {
      tenantId,
      slug: `${MARK}-${name}`,
      name,
      permissions: { create: codes.map((permissionCode) => ({ permissionCode })) },
    },
  });
  const agent = await owner.agent.create({
    data: { tenantId, roleId: role.id, name, email: `${MARK}-${name}-${tenantId}@example.test`, passwordHash: 'x' },
  });
  return { id: agent.id, tenantId, roleId: role.id };
}

async function buildApp(agent: { id: string; tenantId: string; roleId: string }) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', tenantDb);
  app.decorate('prismaAdmin', owner);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agent.id, tenantId: agent.tenantId, role: 'ADMIN', roleId: agent.roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, agent.tenantId);
  });
  await app.register(richMenuRoutes, { prefix: '/api/v1/line/rich-menus' });
  await app.ready();
  return app;
}

const appA = await buildApp(await makeAgent(A));
const appNoPermission = await buildApp(await makeAgent(A, 'inbox-only', ['inbox.view']));
type App = typeof appA;

const channelOf = (tenantId: string, channelType: 'LINE' | 'FB', name: string) =>
  owner.channel.create({ data: { tenantId, channelType, displayName: `${MARK}-${name}`, credentialsEncrypted: 'x' } });
const lineA = await channelOf(A, 'LINE', 'line-a');
const lineA2 = await channelOf(A, 'LINE', 'line-a2');
const fbA = await channelOf(A, 'FB', 'fb-a');
const lineB = await channelOf(B, 'LINE', 'line-b');

afterAll(async () => {
  await Promise.all([appA.close(), appNoPermission.close()]);
  for (const tenantId of [A, B]) {
    await owner.richMenu.deleteMany({ where: { tenantId } });
    await owner.channel.deleteMany({ where: { tenantId } });
    await owner.agent.deleteMany({ where: { tenantId } });
    await owner.role.deleteMany({ where: { tenantId } });
    await owner.tenant.delete({ where: { id: tenantId } });
  }
  await Promise.all([owner.$disconnect(), tenantDb.$disconnect()]);
});

async function call(app: App, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) });
  return { status: res.statusCode, body: res.json() as { data: any; error?: { code: string; message: string } } };
}

const base = '/api/v1/line/rich-menus';
const menu = (channelId: string, extra: Record<string, unknown> = {}) => ({
  channelId,
  name: `${MARK}-選單`,
  chatBarText: '選單',
  size: { width: 2500, height: 843 },
  areas: [{ bounds: { x: 0, y: 0, width: 2500, height: 843 }, action: { type: 'message', text: '你好' } }],
  imageUrl: 'https://example.test/menu.png',
  ...extra,
});

async function create(app: App, body: Record<string, unknown>) {
  const res = await call(app, 'POST', base, body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data as { id: string; tenantId: string; status: string; name: string };
}

/** 直接寫一筆已發布的選單（發布要呼叫 LINE，這裡只測守衛） */
const published = (channelId: string) =>
  owner.richMenu.create({
    data: {
      ...menu(channelId),
      tenantId: A,
      status: 'published',
      lineRichMenuId: 'richmenu-x',
      publishedAt: new Date(),
    },
  });

describe('圖文選單 CRUD', () => {
  test('建立草稿成功：status 是 draft，寫入目前的租戶', async () => {
    const created = await create(appA, menu(lineA.id));
    assert.equal(created.status, 'draft');
    assert.equal(created.tenantId, A);
  });

  test('拒絕跨 tenant 渠道：回 404 NOT_FOUND', async () => {
    const res = await call(appA, 'POST', base, menu(lineB.id));
    assert.equal(res.status, 404);
    assert.equal(res.body.error?.code, 'NOT_FOUND');
  });

  test('拒絕非 LINE 渠道：回 400 INVALID_CHANNEL_TYPE', async () => {
    const res = await call(appA, 'POST', base, menu(fbA.id));
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'INVALID_CHANNEL_TYPE');
  });

  test('列表：沒有 channelId 回 400；只回該渠道的選單', async () => {
    assert.equal((await call(appA, 'GET', base)).status, 400);
    const mine = await create(appA, menu(lineA2.id, { name: `${MARK}-a2` }));
    const res = await call(appA, 'GET', `${base}?channelId=${lineA2.id}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((m: { id: string }) => m.id), [mine.id]);
  });

  test('修改草稿成功', async () => {
    const created = await create(appA, menu(lineA.id));
    const res = await call(appA, 'PATCH', `${base}/${created.id}`, { name: `${MARK}-改名` });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.name, `${MARK}-改名`);
  });

  test('已發布的選單不能修改：回 400 CANNOT_UPDATE_PUBLISHED', async () => {
    const row = await published(lineA.id);
    const res = await call(appA, 'PATCH', `${base}/${row.id}`, { name: '改名' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'CANNOT_UPDATE_PUBLISHED');
  });

  test('刪除草稿成功', async () => {
    const created = await create(appA, menu(lineA.id));
    assert.equal((await call(appA, 'DELETE', `${base}/${created.id}`)).status, 200);
    assert.equal(await owner.richMenu.count({ where: { id: created.id } }), 0);
  });

  test('拒絕刪除已 publish：回 400 CANNOT_DELETE_PUBLISHED', async () => {
    const row = await published(lineA.id);
    const res = await call(appA, 'DELETE', `${base}/${row.id}`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'CANNOT_DELETE_PUBLISHED');
    assert.equal(await owner.richMenu.count({ where: { id: row.id } }), 1);
  });

  test('成功複製：名稱加「（副本）」，status 是 draft，LINE 的 id 清空', async () => {
    const row = await published(lineA.id);
    const res = await call(appA, 'POST', `${base}/${row.id}/duplicate`);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.notEqual(res.body.data.id, row.id);
    assert.equal(res.body.data.name, `${row.name}（副本）`);
    assert.equal(res.body.data.status, 'draft');
    assert.equal(res.body.data.lineRichMenuId, null);
    assert.equal(res.body.data.publishedAt, null);
  });

  test('來源不存在：其他租戶的選單回 404', async () => {
    const other = await owner.richMenu.create({ data: { ...menu(lineB.id), tenantId: B } });
    assert.equal((await call(appA, 'POST', `${base}/${other.id}/duplicate`)).status, 404);
    assert.equal((await call(appA, 'GET', `${base}/${other.id}`)).status, 404);
  });

  test('未傳入展開狀態：建立時沒有 selected，選單的 selected 是 true', async () => {
    const created = await create(appA, menu(lineA.id));
    assert.equal((created as unknown as { selected: boolean }).selected, true);
  });

  test('建立與修改接受 isDefault，與 selected 互相獨立', async () => {
    const created = (await create(appA, menu(lineA.id, { isDefault: true, selected: false }))) as unknown as {
      id: string;
      isDefault: boolean;
      selected: boolean;
    };
    assert.equal(created.isDefault, true);
    assert.equal(created.selected, false);

    const res = await call(appA, 'PATCH', `${base}/${created.id}`, { isDefault: false, selected: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.isDefault, false);
    assert.equal(res.body.data.selected, true);
  });

  test('複製帶上 isDefault 與 selected', async () => {
    const source = await create(appA, menu(lineA.id, { isDefault: true, selected: false }));
    const res = await call(appA, 'POST', `${base}/${source.id}/duplicate`);
    assert.equal(res.status, 201);
    assert.equal(res.body.data.isDefault, true);
    assert.equal(res.body.data.selected, false);
  });

  test(':id 不是 UUID：回 400 VALIDATION_ERROR', async () => {
    for (const [method, url] of [
      ['GET', `${base}/not-a-uuid`],
      ['PATCH', `${base}/not-a-uuid`],
      ['DELETE', `${base}/not-a-uuid`],
      ['POST', `${base}/not-a-uuid/duplicate`],
    ] as const) {
      const res = await call(appA, method, url, method === 'PATCH' ? { name: 'x' } : undefined);
      assert.equal(res.status, 400, `${method} ${url}`);
      assert.equal(res.body.error?.code, 'VALIDATION_ERROR', `${method} ${url}`);
    }
  });

  test('沒有 richmenu.manage：回 403', async () => {
    assert.equal((await call(appNoPermission, 'GET', `${base}?channelId=${lineA.id}`)).status, 403);
  });
});
