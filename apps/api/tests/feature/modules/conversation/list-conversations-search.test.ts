/**
 * core-inbox「對話列表依關鍵字搜尋」與「收件匣的未讀與我的篩選由後端執行」的後端情境
 * （change fix-inbox-conversation-pagination，issue #422、AUDIT CONV-04）。
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
const MARK = `ci-conv-search-${Date.now()}`;

const io = { to: () => ({ emit: () => {} }), of: () => ({ to: () => ({ emit: () => {} }) }) };

const role = await owner.role.create({
  data: {
    tenantId: A,
    slug: `${MARK}-inbox`,
    name: `${MARK}-inbox`,
    permissions: { create: [{ permissionCode: 'inbox.view' }] },
  },
});
const member = await owner.agent.create({
  data: { tenantId: A, roleId: role.id, email: `${MARK}-member@example.test`, name: MARK, passwordHash: 'x' },
});
const other = await owner.agent.create({
  data: { tenantId: A, roleId: role.id, email: `${MARK}-other@example.test`, name: MARK, passwordHash: 'x' },
});

const createChannel = (tenantId: string, slug: string) =>
  owner.channel.create({
    data: { tenantId, channelType: 'WEBCHAT', displayName: `${MARK}-${slug}`, credentialsEncrypted: 'x' },
  });

const visible = await createChannel(A, 'visible');
const hidden = await createChannel(A, 'hidden');
const tenantBChannel = await createChannel(B, 'tenant-b');
await owner.agentChannelAccess.create({ data: { channelId: visible.id, agentId: member.id, accessLevel: 'full' } });
await owner.agentChannelAccess.create({ data: { channelId: hidden.id, agentId: other.id, accessLevel: 'full' } });

async function createConversation(
  channel: { id: string; tenantId: string },
  name: string,
  extra: { updatedAt?: Date; unreadCount?: number; assignedToId?: string; text?: string } = {},
) {
  const contact = await owner.contact.create({ data: { tenantId: channel.tenantId, displayName: name } });
  const conversation = await owner.conversation.create({
    data: {
      tenantId: channel.tenantId,
      contactId: contact.id,
      channelId: channel.id,
      channelType: 'WEBCHAT',
      unreadCount: extra.unreadCount ?? 0,
      assignedToId: extra.assignedToId,
    },
  });
  if (extra.text) {
    await owner.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        senderType: 'CONTACT',
        contentType: 'text',
        content: { text: extra.text },
      },
    });
  }
  if (extra.updatedAt) {
    // 建立訊息不會動 updatedAt；這裡明確設定，讓目標排在最舊
    await owner.conversation.update({ where: { id: conversation.id }, data: { updatedAt: extra.updatedAt } });
  }
  return conversation;
}

// 第 51 段以後：55 段可見渠道的對話，名稱比對的目標排在最舊
const TOKEN = `RT${Date.now()}`;
const oldest = new Date(Date.now() - 86_400_000);
const target = await createConversation(visible, `${MARK}-王小明`, { updatedAt: oldest });
for (let i = 0; i < 54; i++) {
  await createConversation(visible, `${MARK}-filler-${i}`);
}
const withMessage = await createConversation(visible, `${MARK}-msg`, { text: `我想退貨${TOKEN}` });
const alice = await createConversation(visible, `${MARK}-alice`);
await createConversation(hidden, `${MARK}-hidden-${TOKEN}`);
await createConversation(tenantBChannel, `${MARK}-tenantb-${TOKEN}`);
await createConversation(visible, `${MARK}-u0`, { unreadCount: 0, assignedToId: member.id });
const unread3 = await createConversation(visible, `${MARK}-u3`, { unreadCount: 3, assignedToId: member.id });

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', tenantDb);
app.decorate('prismaAdmin', owner);
app.decorate('io', io as never);
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: member.id, tenantId: A, role: 'AGENT', roleId: role.id } as never;
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

async function list(query: string) {
  const res = await app.inject({ method: 'GET', url: `/api/v1/conversations?${query}` });
  return res;
}
const ids = (res: { json: () => { data: Array<{ id: string }> } }) => res.json().data.map((c) => c.id);

test('依聯絡人名稱搜尋：排在第 51 段以後的對話也找得到', async () => {
  const all = await list(`search=${encodeURIComponent(MARK)}&limit=50`);
  assert.equal(all.statusCode, 200, all.body);
  assert.ok(!ids(all).includes(target.id), '前提：不搜尋名稱時目標不在第 1 頁');

  const res = await list(`search=${encodeURIComponent(`${MARK}-王小明`)}&limit=50`);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(ids(res), [target.id]);
  assert.equal(res.json().meta.total, 1);
});

test('依訊息內容搜尋：只回訊息含關鍵字的對話', async () => {
  const res = await list(`search=${encodeURIComponent(`退貨${TOKEN}`)}`);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(ids(res), [withMessage.id]);
});

test('不分大小寫：大寫關鍵字找得到小寫名稱', async () => {
  const res = await list(`search=${encodeURIComponent(`${MARK}-ALICE`.toUpperCase())}`);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(ids(res), [alice.id]);
});

test('看不到的渠道：關鍵字也符合看不到的渠道與租戶 B 的對話，只回可見渠道的那段', async () => {
  const res = await list(`search=${encodeURIComponent(TOKEN)}`);
  assert.equal(res.statusCode, 200, res.body);
  // 只有可見渠道裡訊息含 TOKEN 的那段；hidden 渠道與租戶 B 的名稱也含 TOKEN，都不能出現
  assert.deepEqual(ids(res), [withMessage.id]);
});

test('其他租戶的資料：只符合租戶 B 的關鍵字回空', async () => {
  const res = await list(`search=${encodeURIComponent(`${MARK}-tenantb`)}`);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(ids(res), []);
  assert.equal(res.json().meta.total, 0);
});

test('關鍵字太長：101 字回 400 VALIDATION_ERROR', async () => {
  const res = await list(`search=${'a'.repeat(101)}`);
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');
});

test('只有空白：與不帶 search 相同', async () => {
  const blank = await list(`assigneeId=${member.id}&search=%20%20`);
  const none = await list(`assigneeId=${member.id}`);
  assert.equal(blank.statusCode, 200, blank.body);
  assert.deepEqual(ids(blank).sort(), ids(none).sort());
  assert.equal(blank.json().meta.total, 2);
});

test('後端只回未讀的對話：unread=true 只回未讀數大於 0 的', async () => {
  const res = await list(`unread=true&search=${encodeURIComponent(`${MARK}-u`)}`);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(ids(res), [unread3.id]);
  assert.equal(res.json().meta.total, 1);
});

test('關鍵字裡的 % 與 _ 當成一般文字（PR #449 審查）', async () => {
  // 未跳脫時 `-u_` 會把 `_` 當成任一字元，比對到 u0、u3；`退貨%<TOKEN>` 會把 `%` 當成任意字串，比對到訊息「我想退貨<TOKEN>」
  for (const keyword of [`${MARK}-u_`, `${MARK}-u%`, `退貨%${TOKEN}`, `退_${TOKEN}`]) {
    const res = await list(`search=${encodeURIComponent(keyword)}`);
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(ids(res), [], `關鍵字 ${keyword} 不應比對到任何對話`);
  }
});

test('名稱含 %、_ 與反斜線時照樣找得到（PR #449 審查）', async () => {
  const special = await createConversation(visible, `${MARK}-折扣50%_A\\B`);
  for (const keyword of ['50%_A', '%_A\\B', `${MARK}-折扣50%`]) {
    const res = await list(`search=${encodeURIComponent(keyword)}`);
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(ids(res), [special.id], `關鍵字 ${keyword}`);
  }
});
