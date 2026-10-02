/**
 * 重抓 LINE 個人資料的端點（AUDIT RLS-05）。
 *
 * 背景：PATCH /channels/:channelId/contacts/:lineUid/sync-profile 原本只驗登入，
 * 以 prismaAdmin（BYPASSRLS）查渠道與身分、條件不帶 tenantId，
 * 任一租戶的成員可以用其他租戶渠道的憑證呼叫 LINE，並改寫對方的 ChannelIdentity。
 *
 * 路由層整合測試：走真實的 requirePermission、渠道可見範圍與 app_tenant 連線（RLS）。
 * LINE 的 getProfile 與憑證解密以 mock 取代，不連外。
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, test, vi } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import lineProfileRoutes from '#src/modules/line/line-profile.routes.js';

const getProfile = vi.fn();

vi.mock('@open333crm/channel-plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@open333crm/channel-plugins')>()),
  getChannelPlugin: () => ({ getProfile }),
}));
vi.mock('#src/modules/channel/channel.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#src/modules/channel/channel.service.js')>()),
  decryptCredentials: () => ({ channelAccessToken: 'test-token' }),
}));

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const B = process.env.RLS_TEST_TENANT_B ?? 'b0000000-0000-0000-0000-000000000002';
const stamp = Date.now();
const MARK = `ci-line-profile-${stamp}`;

async function createRole(tenantId: string, slug: string, permissions: string[]) {
  return owner.role.create({
    data: {
      tenantId,
      slug: `${MARK}-${slug}`,
      name: `CI LINE 個人資料測試（${slug}）`,
      permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) },
    },
  });
}

async function createAgent(tenantId: string, roleId: string, slug: string) {
  return owner.agent.create({
    data: { tenantId, roleId, email: `${MARK}-${slug}@example.test`, name: MARK, passwordHash: 'x' },
  });
}

/** 建立一個 LINE 渠道，以及一位聯絡人在該渠道的身分 */
async function createLineIdentity(tenantId: string, slug: string, channelType: 'LINE' | 'WEBCHAT' = 'LINE') {
  const channel = await owner.channel.create({
    data: { tenantId, channelType, displayName: `${MARK}-${slug}`, credentialsEncrypted: 'x' },
  });
  const contact = await owner.contact.create({ data: { tenantId, displayName: `${MARK}-${slug}` } });
  const uid = `U${MARK}-${slug}`;
  await owner.channelIdentity.create({
    data: { contactId: contact.id, channelId: channel.id, channelType, uid, profileName: 'original', profilePic: null },
  });
  return { channel, contact, uid };
}

async function buildApp(tenantId: string, agentId: string, roleId: string) {
  const app = Fastify();
  app.decorate('prisma', owner);
  app.decorate('prismaAdmin', owner);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agentId, tenantId, role: 'AGENT', roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, tenantId);
  });
  await app.register(lineProfileRoutes, { prefix: '/api/v1' });
  await app.ready();
  return app;
}

const sync = (app: Awaited<ReturnType<typeof buildApp>>, channelId: string, uid: string) =>
  app.inject({ method: 'PATCH', url: `/api/v1/channels/${channelId}/contacts/${encodeURIComponent(uid)}/sync-profile` });

const identityOf = (channelId: string, uid: string) =>
  owner.channelIdentity.findUniqueOrThrow({ where: { channelId_uid: { channelId, uid } } });

const updater = await createRole(A, 'update', ['contact.view', 'contact.update']);
const viewer = await createRole(A, 'view', ['contact.view']);
const agentA = await createAgent(A, updater.id, 'a');
const otherAgentA = await createAgent(A, updater.id, 'other');

const own = await createLineIdentity(A, 'own');
const foreign = await createLineIdentity(B, 'foreign');
const hidden = await createLineIdentity(A, 'hidden');
// 渠道只綁給另一位成員：agentA 看不到這個渠道
await owner.agentChannelAccess.create({ data: { channelId: hidden.channel.id, agentId: otherAgentA.id } });
const webchat = await createLineIdentity(A, 'webchat', 'WEBCHAT');

const appA = await buildApp(A, agentA.id, updater.id);
const viewerApp = await buildApp(A, agentA.id, viewer.id);

beforeEach(() => {
  getProfile.mockReset();
  getProfile.mockResolvedValue({ uid: 'x', displayName: 'Synced Name', avatarUrl: 'https://example.test/a.png' });
});

afterAll(async () => {
  await appA.close();
  await viewerApp.close();
  await owner.channel.deleteMany({ where: { displayName: { startsWith: MARK } } });
  await owner.contact.deleteMany({ where: { displayName: { startsWith: MARK } } });
  await owner.agent.deleteMany({ where: { name: MARK } });
  await owner.role.deleteMany({ where: { slug: { startsWith: MARK } } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

test('其他租戶的渠道：回 404，不呼叫 LINE，也不改寫對方的 ChannelIdentity', async () => {
  const res = await sync(appA, foreign.channel.id, foreign.uid);

  assert.equal(res.statusCode, 404);
  assert.equal(getProfile.mock.calls.length, 0);
  assert.equal((await identityOf(foreign.channel.id, foreign.uid)).profileName, 'original');
});

test('自己租戶的渠道：寫入 ChannelIdentity 的名稱與頭像，不改 Contact', async () => {
  const res = await sync(appA, own.channel.id, own.uid);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().data, { uid: own.uid, profileName: 'Synced Name', profilePic: 'https://example.test/a.png' });
  const contact = await owner.contact.findUniqueOrThrow({ where: { id: own.contact.id } });
  assert.equal(contact.displayName, `${MARK}-own`);
});

test('沒有 contact.update：回 403，不呼叫 LINE', async () => {
  const res = await sync(viewerApp, own.channel.id, own.uid);

  assert.equal(res.statusCode, 403);
  assert.equal(getProfile.mock.calls.length, 0);
});

test('渠道不在成員的可見範圍：回 404，不呼叫 LINE', async () => {
  const res = await sync(appA, hidden.channel.id, hidden.uid);

  assert.equal(res.statusCode, 404);
  assert.equal(getProfile.mock.calls.length, 0);
  assert.equal((await identityOf(hidden.channel.id, hidden.uid)).profileName, 'original');
});

test('非 LINE 渠道：回 404，不呼叫 LINE', async () => {
  const res = await sync(appA, webchat.channel.id, webchat.uid);

  assert.equal(res.statusCode, 404);
  assert.equal(getProfile.mock.calls.length, 0);
});
