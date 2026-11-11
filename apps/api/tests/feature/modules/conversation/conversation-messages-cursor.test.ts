/**
 * core-inbox「對話訊息以游標往前分頁」的後端情境（change fix-chat-window-load-older-468，issue #468、HC-INBOX-07）。
 *
 * 路由層整合測試：走真實的 requirePermission、渠道可見範圍與 app_tenant 連線（RLS）。
 * 測試名稱以「情境名稱：說明」開頭。屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import conversationRoutes from '#src/modules/conversation/conversation.routes.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const B = process.env.RLS_TEST_TENANT_B ?? 'b0000000-0000-0000-0000-000000000002';
const MARK = `ci-conv-msg-cursor-${Date.now()}`;

const io = { to: () => ({ emit: () => {} }), of: () => ({ to: () => ({ emit: () => {} }) }) };

async function createRole(slug: string, codes: string[]) {
  return owner.role.create({
    data: {
      tenantId: A,
      slug: `${MARK}-${slug}`,
      name: `${MARK}-${slug}`,
      permissions: { create: codes.map((permissionCode) => ({ permissionCode })) },
    },
  });
}
const inboxRole = await createRole('inbox', ['inbox.view']);
const viewAllRole = await createRole('view-all', ['inbox.view', 'channel.view_all']);
const member = await owner.agent.create({
  data: { tenantId: A, roleId: inboxRole.id, email: `${MARK}-member@example.test`, name: MARK, passwordHash: 'x' },
});
const viewAll = await owner.agent.create({
  data: { tenantId: A, roleId: viewAllRole.id, email: `${MARK}-all@example.test`, name: MARK, passwordHash: 'x' },
});

const createChannel = (tenantId: string, slug: string) =>
  owner.channel.create({
    data: { tenantId, channelType: 'WEBCHAT', displayName: `${MARK}-${slug}`, credentialsEncrypted: 'x' },
  });
const channelA = await createChannel(A, 'a');
const channelB = await createChannel(B, 'b');
await owner.agentChannelAccess.create({ data: { channelId: channelA.id, agentId: member.id, accessLevel: 'full' } });

async function createConversation(channel: { id: string; tenantId: string }) {
  const contact = await owner.contact.create({ data: { tenantId: channel.tenantId, displayName: MARK } });
  return owner.conversation.create({
    data: { tenantId: channel.tenantId, contactId: contact.id, channelId: channel.id, channelType: 'WEBCHAT' },
  });
}

async function insertMessages(conversationId: string, createdAts: Date[]) {
  for (const [i, createdAt] of createdAts.entries()) {
    await owner.message.create({
      data: {
        conversationId,
        direction: 'INBOUND',
        senderType: 'CONTACT',
        contentType: 'text',
        content: { text: `#${i + 1}` },
        createdAt,
      },
    });
  }
}

// 60 則：每則相隔 1 秒
const long = await createConversation(channelA);
const base = Date.now() - 3_600_000;
await insertMessages(long.id, Array.from({ length: 60 }, (_, i) => new Date(base + i * 1000)));

// 5 則同一毫秒
const sameTime = await createConversation(channelA);
const instant = new Date(base);
await insertMessages(sameTime.id, Array.from({ length: 5 }, () => instant));

// 租戶 B 的對話
const tenantBConversation = await createConversation(channelB);
await insertMessages(tenantBConversation.id, [new Date(base)]);

let actingAgent: { id: string; roleId: string } = member;

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', tenantDb);
app.decorate('prismaAdmin', owner);
app.decorate('io', io as never);
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: actingAgent.id, tenantId: A, role: 'AGENT', roleId: actingAgent.roleId } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, A);
});
await app.register(conversationRoutes, { prefix: '/api/v1/conversations' });
await app.ready();

afterAll(async () => {
  await app.close();
  const channels = await owner.channel.findMany({ where: { displayName: { startsWith: MARK } }, select: { id: true } });
  const channelIds = channels.map((c) => c.id);
  await owner.message.deleteMany({ where: { conversation: { channelId: { in: channelIds } } } });
  await owner.conversation.deleteMany({ where: { channelId: { in: channelIds } } });
  await owner.agentChannelAccess.deleteMany({ where: { channelId: { in: channelIds } } });
  await owner.channel.deleteMany({ where: { id: { in: channelIds } } });
  await owner.contact.deleteMany({ where: { displayName: { startsWith: MARK } } });
  await owner.agent.deleteMany({ where: { email: { startsWith: MARK } } });
  await owner.role.deleteMany({ where: { slug: { startsWith: MARK } } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

interface MessagesBody {
  data: Array<{ id: string; content: { text: string } }>;
  meta: { total: number; page?: number; totalPages?: number; hasMore: boolean; nextCursor: string | null };
}

async function get(conversationId: string, query: string) {
  return app.inject({ method: 'GET', url: `/api/v1/conversations/${conversationId}/messages?${query}` });
}

/** 依 nextCursor 一路往前取到 hasMore 為 false，回傳每次請求取得的訊息 id */
async function fetchAll(conversationId: string, limit: number) {
  const pages: string[][] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const res = await get(conversationId, `limit=${limit}${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`);
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as MessagesBody;
    pages.push(body.data.map((m) => m.id));
    if (!body.meta.hasMore) {
      assert.equal(body.meta.nextCursor, null);
      return pages;
    }
    assert.ok(body.meta.nextCursor, '還有更早的訊息時要有 nextCursor');
    cursor = body.meta.nextCursor;
  }
  throw new Error('分頁沒有結束');
}

test('60 則訊息分頁取完：依游標三次取完，不重複不遺漏', async () => {
  const pages = await fetchAll(long.id, 25);
  assert.deepEqual(pages.map((p) => p.length), [25, 25, 10]);
  const ids = pages.flat();
  assert.equal(new Set(ids).size, 60);
  const all = await owner.message.findMany({ where: { conversationId: long.id }, select: { id: true } });
  assert.deepEqual([...ids].sort(), all.map((m) => m.id).sort());
});

test('60 則訊息分頁取完：第一頁是最新的 25 則，由新到舊', async () => {
  const res = await get(long.id, 'limit=25');
  const body = res.json() as MessagesBody;
  assert.equal(body.data[0]?.content.text, '#60');
  assert.equal(body.data[24]?.content.text, '#36');
});

test('同一時間的多則訊息：limit=2 依游標取完 5 則，每則一次', async () => {
  const pages = await fetchAll(sameTime.id, 2);
  const ids = pages.flat();
  assert.equal(ids.length, 5);
  assert.equal(new Set(ids).size, 5);
});

test('其他租戶的對話：有 channel.view_all 的成員也拿不到租戶 B 的訊息', async () => {
  actingAgent = viewAll;
  try {
    const res = await get(tenantBConversation.id, 'limit=50');
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as MessagesBody;
    assert.deepEqual(body.data, []);
    assert.equal(body.meta.total, 0);
  } finally {
    actingAgent = member;
  }
});

test('游標格式錯誤：回 400 VALIDATION_ERROR', async () => {
  const res = await get(long.id, 'before=not-a-cursor');
  assert.equal(res.statusCode, 400, res.body.slice(0, 300));
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');
});

test('游標搭配 page 或升冪：回 400 VALIDATION_ERROR', async () => {
  const first = (await get(long.id, 'limit=25')).json() as MessagesBody;
  const cursor = encodeURIComponent(first.meta.nextCursor ?? '');
  for (const extra of ['page=2', 'order=asc']) {
    const res = await get(long.id, `limit=25&before=${cursor}&${extra}`);
    assert.equal(res.statusCode, 400, `${extra}: ${res.body.slice(0, 300)}`);
    assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  }
});

test('不帶 before 的舊呼叫：page=2 回第 26 到 50 新的訊息', async () => {
  const res = await get(long.id, 'page=2&limit=25&order=desc');
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as MessagesBody;
  assert.equal(body.data.length, 25);
  assert.equal(body.data[0]?.content.text, '#35');
  assert.equal(body.data[24]?.content.text, '#11');
  assert.equal(body.meta.total, 60);
  assert.equal(body.meta.page, 2);
  assert.equal(body.meta.totalPages, 3);
});
