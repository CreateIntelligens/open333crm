/**
 * 圖文選單發布的認領與並行（change migrate-line-tenant-ctx，spec line-rich-menu
 * 「發布在 LINE 上最多建立一次選單」「同一個渠道同時只有一個選單在發布中」「發布中斷或失敗的選單可以重新發布」）。
 *
 * 路由走真實的 requirePermission 與 app_tenant 連線（RLS）。LINE 以 stub 的 fetch 取代：
 * 第一次「建立選單」可以被閘門卡住，讓第一個請求停在發布中，再送第二個請求。
 */
import assert from 'node:assert/strict';
import { afterAll, afterEach, beforeEach, describe, test, vi } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import richMenuRoutes from '#src/modules/line/rich-menu.routes.js';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import { inTenant } from '#src/lib/tenant-ctx.js';
import {
  claimRichMenuForPublish,
  completeRichMenuPublish,
  releaseRichMenuPublish,
} from '#src/modules/line/rich-menu.service.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-rich-menu-publish-${Date.now()}`;

const tenant = await owner.tenant.create({ data: { name: MARK } });
const T = tenant.id;
const role = await owner.role.create({
  data: { tenantId: T, slug: `${MARK}-m`, name: 'm', permissions: { create: [{ permissionCode: 'richmenu.manage' }] } },
});
const agent = await owner.agent.create({
  data: { tenantId: T, roleId: role.id, name: 'm', email: `${MARK}@example.test`, passwordHash: 'x' },
});

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', tenantDb);
app.decorate('prismaAdmin', owner);
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: agent.id, tenantId: T, role: 'ADMIN', roleId: role.id } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, T);
});
await app.register(richMenuRoutes, { prefix: '/api/v1/line/rich-menus' });
await app.ready();

const credentialsEncrypted = encryptCredentials({ channelAccessToken: 'token' });
const newChannel = (name: string) =>
  owner.channel.create({ data: { tenantId: T, channelType: 'LINE', displayName: `${MARK}-${name}`, credentialsEncrypted } });

const newMenu = (channelId: string, data: Record<string, unknown> = {}) =>
  owner.richMenu.create({
    data: {
      tenantId: T,
      channelId,
      name: `${MARK}-選單`,
      chatBarText: '選單',
      size: { width: 2500, height: 843 },
      areas: [{ bounds: { x: 0, y: 0, width: 2500, height: 843 }, action: { type: 'message', text: '你好' } }],
      imageUrl: 'https://img.example.test/menu.png',
      ...data,
    },
  });

// ── LINE stub ──
let createCalls = 0;
let holdFirstCreate = false;
let release: () => void = () => {};

beforeEach(() => {
  createCalls = 0;
  holdFirstCreate = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    if (url === 'https://img.example.test/menu.png') {
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    }
    if (url.endsWith('/v2/bot/richmenu') && method === 'POST') {
      createCalls += 1;
      const n = createCalls;
      if (holdFirstCreate && n === 1) await gate;
      return new Response(JSON.stringify({ richMenuId: `rm-line-${n}` }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
});

afterEach(() => {
  release();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await app.close();
  await owner.richMenu.deleteMany({ where: { tenantId: T } });
  await owner.channel.deleteMany({ where: { tenantId: T } });
  await owner.agent.deleteMany({ where: { tenantId: T } });
  await owner.role.deleteMany({ where: { tenantId: T } });
  await owner.tenant.delete({ where: { id: T } });
  await Promise.all([owner.$disconnect(), tenantDb.$disconnect()]);
});

async function publish(id: string) {
  const res = await app.inject({ method: 'POST', url: `/api/v1/line/rich-menus/${id}/publish` });
  return { status: res.statusCode, body: res.json() as { data: any; error?: { code: string } } };
}

async function waitForCreateCalls(n: number) {
  for (let i = 0; i < 200 && createCalls < n; i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(createCalls >= n, `LINE 建立選單沒有被呼叫 ${n} 次`);
}

const statusOf = async (id: string) => (await owner.richMenu.findUniqueOrThrow({ where: { id } })).status;

describe('發布的認領與並行', () => {
  test('同一個選單同時發布兩次：一個 200，另一個 409 PUBLISH_IN_PROGRESS，LINE 只建立一次', async () => {
    const channel = await newChannel('same-menu');
    const menu = await newMenu(channel.id);
    holdFirstCreate = true;

    const first = publish(menu.id);
    await waitForCreateCalls(1);
    const second = await publish(menu.id);
    release();

    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.equal(second.body.error?.code, 'PUBLISH_IN_PROGRESS');
    const done = await first;
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(await statusOf(menu.id), 'published');
    assert.equal(createCalls, 1);
  });

  test('同一個渠道的兩個選單同時發布：一個 200，另一個 409，它的選單狀態不變', async () => {
    const channel = await newChannel('same-channel');
    const a = await newMenu(channel.id);
    const b = await newMenu(channel.id);
    holdFirstCreate = true;

    const first = publish(a.id);
    await waitForCreateCalls(1);
    const second = await publish(b.id);
    release();

    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.equal(second.body.error?.code, 'PUBLISH_IN_PROGRESS');
    assert.equal(await statusOf(b.id), 'draft');
    assert.equal((await first).status, 200);
  });

  test('不同渠道的選單同時發布：兩個請求都回 200', async () => {
    const x = await newMenu((await newChannel('x')).id);
    const y = await newMenu((await newChannel('y')).id);
    holdFirstCreate = true;

    const first = publish(x.id);
    await waitForCreateCalls(1);
    const second = await publish(y.id);
    release();

    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal((await first).status, 200);
    assert.equal(await statusOf(x.id), 'published');
    assert.equal(await statusOf(y.id), 'published');
  });

  test('重新發布中斷的選單：發布中停留 6 分鐘的選單可以重新發布', async () => {
    const menu = await newMenu((await newChannel('stale')).id, { status: 'publishing' });
    await owner.$executeRaw`UPDATE rich_menus SET "updatedAt" = now() - interval '6 minutes' WHERE id = ${menu.id}::uuid`;

    const res = await publish(menu.id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(await statusOf(menu.id), 'published');
    assert.equal(createCalls, 1);
  });

  test('發布中的選單不能重新發布：發布中停留 1 分鐘回 409，不呼叫 LINE', async () => {
    const menu = await newMenu((await newChannel('fresh')).id, { status: 'publishing' });
    await owner.$executeRaw`UPDATE rich_menus SET "updatedAt" = now() - interval '1 minute' WHERE id = ${menu.id}::uuid`;

    const res = await publish(menu.id);
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.error?.code, 'PUBLISH_IN_PROGRESS');
    assert.equal(createCalls, 0);
    assert.equal(await statusOf(menu.id), 'publishing');
  });
});

describe('認領的歸屬', () => {
  test('中斷的請求恢復後不能改到新的認領：舊認領的放掉與寫入都不生效，新認領照常完成', async () => {
    const menu = await newMenu((await newChannel('owner')).id);
    const claimOf = () => inTenant(tenantDb, T, (scope) => claimRichMenuForPublish(scope, menu.id));

    await claimOf();
    // 請求 A 中斷超過 5 分鐘：它的認領時間就是停留在資料庫上的 updatedAt
    await owner.$executeRaw`UPDATE rich_menus SET "updatedAt" = now() - interval '6 minutes' WHERE id = ${menu.id}::uuid`;
    const staleAt = (await owner.richMenu.findUniqueOrThrow({ where: { id: menu.id } })).updatedAt;

    const b = await claimOf();

    await inTenant(tenantDb, T, (scope) => releaseRichMenuPublish(scope, menu.id, staleAt, 'error'));
    assert.equal(await statusOf(menu.id), 'publishing', '舊請求把新認領改成 error');

    const lateA = await inTenant(tenantDb, T, (scope) =>
      completeRichMenuPublish(scope, menu.id, staleAt, 'rm-line-a'),
    );
    assert.equal(lateA, null);

    const done = await inTenant(tenantDb, T, (scope) =>
      completeRichMenuPublish(scope, menu.id, b.claimedAt, 'rm-line-b'),
    );
    assert.equal(done?.status, 'published');
    assert.equal(done?.lineRichMenuId, 'rm-line-b');
  });
});
