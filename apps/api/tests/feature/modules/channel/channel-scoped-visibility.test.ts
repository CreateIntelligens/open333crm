/**
 * 主規格 channel-scoped-visibility 與 channel-visibility-defaults 的情境
 * （change restore-channel-scoped-visibility-spec）。
 *
 * 路由層整合測試：走真實的 requirePermission、渠道可見範圍與 app_tenant 連線（RLS）。
 * 渠道外掛與憑證解密以 mock 取代，不連外。測試名稱以「情境名稱：說明」開頭。
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test, vi } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import type { ParsedWebhookMessage } from '@open333crm/channel-plugins';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import conversationRoutes from '#src/modules/conversation/conversation.routes.js';
import caseRoutes from '#src/modules/case/case.routes.js';
import marketingRoutes from '#src/modules/marketing/marketing.routes.js';
import { processInboundMessage } from '#src/modules/webhook/webhook.service.js';
import { getAccessibleChannelIds, resolveChannelAccessLevel } from '#src/services/channel-visibility.js';

const sendMessage = vi.fn(async () => ({ success: true, channelMsgId: 'stub-msg' }));

vi.mock('@open333crm/channel-plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@open333crm/channel-plugins')>()),
  getChannelPlugin: () => ({
    sendMessage,
    getProfile: async (uid: string) => ({ uid, displayName: 'Stub User' }),
  }),
}));
vi.mock('#src/modules/channel/channel.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#src/modules/channel/channel.service.js')>()),
  decryptCredentials: () => ({ channelAccessToken: 'test-token' }),
}));

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const MARK = `ci-scoped-visibility-${Date.now()}`;

const io = {
  to: () => ({ emit: () => {} }),
  of: () => ({ to: () => ({ emit: () => {} }) }),
};

async function createRole(slug: string, permissions: string[]) {
  return owner.role.create({
    data: {
      tenantId: A,
      slug: `${MARK}-${slug}`,
      name: `${MARK}-${slug}`,
      permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) },
    },
  });
}

async function createAgent(slug: string, roleId: string) {
  return owner.agent.create({
    data: { tenantId: A, roleId, email: `${MARK}-${slug}@example.test`, name: MARK, passwordHash: 'x' },
  });
}

async function createChannel(slug: string, { channelType = 'WEBCHAT', isActive = true }: { channelType?: 'WEBCHAT' | 'FB' | 'LINE'; isActive?: boolean } = {}) {
  return owner.channel.create({
    data: { tenantId: A, channelType, isActive, displayName: `${MARK}-${slug}`, credentialsEncrypted: 'x' },
  });
}

async function createConversation(
  channel: { id: string; channelType: string },
  slug: string,
  extra: { teamId?: string; assignedToId?: string } = {},
) {
  const contact = await owner.contact.create({ data: { tenantId: A, displayName: `${MARK}-${slug}` } });
  return owner.conversation.create({
    data: { tenantId: A, contactId: contact.id, channelId: channel.id, channelType: channel.channelType as never, ...extra },
  });
}

const bind = (channelId: string, agentId: string, accessLevel: 'read_only' | 'reply_only' | 'full' = 'full') =>
  owner.agentChannelAccess.create({ data: { channelId, agentId, accessLevel } });

async function buildApp(agentId: string, roleId: string) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', owner);
  app.decorate('prismaAdmin', owner);
  app.decorate('io', io as never);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agentId, tenantId: A, role: 'AGENT', roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, A);
  });
  await app.register(conversationRoutes, { prefix: '/api/v1/conversations' });
  await app.register(caseRoutes, { prefix: '/api/v1/cases' });
  await app.register(marketingRoutes, { prefix: '/api/v1/marketing' });
  await app.ready();
  return app;
}

// ── fixture ──
const inboxRole = await createRole('inbox', ['inbox.view', 'inbox.reply', 'inbox.manage', 'case.view']);
const broadcastRole = await createRole('broadcast', ['marketing.view', 'marketing.broadcast']);
const member = await createAgent('member', inboxRole.id);
const other = await createAgent('other', inboxRole.id);
const broadcaster = await createAgent('broadcaster', broadcastRole.id);

const visible = await createChannel('visible');
const hidden = await createChannel('hidden');
const readOnly = await createChannel('read-only');
const replyOnly = await createChannel('reply-only');
const teamChannel = await createChannel('team');
await bind(visible.id, member.id);
await bind(hidden.id, other.id);
await bind(readOnly.id, member.id, 'read_only');
await bind(replyOnly.id, member.id, 'reply_only');
await bind(teamChannel.id, member.id);

const team = await owner.team.create({ data: { tenantId: A, name: `${MARK}-team` } });
await owner.agentTeamMember.create({ data: { teamId: team.id, agentId: other.id } });

const hiddenConv = await createConversation(hidden, 'hidden');
const hiddenCase = await owner.case.create({
  data: { tenantId: A, contactId: hiddenConv.contactId, channelId: hidden.id, title: `${MARK}-hidden-case` },
});
const readOnlyConv = await createConversation(readOnly, 'read-only');
const replyOnlyConv = await createConversation(replyOnly, 'reply-only');
const teamConv = await createConversation(teamChannel, 'team', { teamId: team.id });
const assignedTeamConv = await createConversation(teamChannel, 'team-assigned', { teamId: team.id, assignedToId: member.id });

const memberApp = await buildApp(member.id, inboxRole.id);
const broadcasterApp = await buildApp(broadcaster.id, broadcastRole.id);

afterAll(async () => {
  await memberApp.close();
  await broadcasterApp.close();
  const channels = await owner.channel.findMany({ where: { displayName: { startsWith: MARK } }, select: { id: true } });
  const channelIds = channels.map((c) => c.id);
  await owner.broadcast.deleteMany({ where: { channelId: { in: channelIds } } });
  await owner.material.deleteMany({ where: { name: { startsWith: MARK } } });
  await owner.case.deleteMany({ where: { channelId: { in: channelIds } } });
  await owner.message.deleteMany({ where: { conversation: { channelId: { in: channelIds } } } });
  await owner.conversation.deleteMany({ where: { channelId: { in: channelIds } } });
  await owner.channelIdentity.deleteMany({ where: { channelId: { in: channelIds } } });
  await owner.channel.deleteMany({ where: { id: { in: channelIds } } });
  await owner.contact.deleteMany({ where: { displayName: { startsWith: MARK } } });
  await owner.team.deleteMany({ where: { name: { startsWith: MARK } } });
  await owner.agent.deleteMany({ where: { email: { startsWith: MARK } } });
  await owner.role.deleteMany({ where: { slug: { startsWith: MARK } } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

const reply = (conversationId: string) =>
  memberApp.inject({
    method: 'POST',
    url: `/api/v1/conversations/${conversationId}/messages`,
    payload: { contentType: 'text', content: { text: 'hello' } },
  });
const close = (conversationId: string) =>
  memberApp.inject({ method: 'POST', url: `/api/v1/conversations/${conversationId}/close` });
const outboundCount = (conversationId: string) =>
  owner.message.count({ where: { conversationId, direction: 'OUTBOUND' } });
const statusOf = async (conversationId: string) =>
  (await owner.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status;

// ── channel-scoped-visibility：單筆讀取與操作的存取檢查 ──

test('讀取不可見渠道的對話被拒：回 404，不回傳對話內容', async () => {
  const res = await memberApp.inject({ method: 'GET', url: `/api/v1/conversations/${hiddenConv.id}` });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().data, undefined);
});

test('讀取不可見渠道的工單被拒：回 404，不回傳工單內容', async () => {
  const res = await memberApp.inject({ method: 'GET', url: `/api/v1/cases/${hiddenCase.id}` });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().data, undefined);
});

test('操作不可見渠道的對話被拒：回覆與關閉都回 404，不送出訊息，狀態不變', async () => {
  const statusBefore = await statusOf(hiddenConv.id);

  const replied = await reply(hiddenConv.id);
  assert.equal(replied.statusCode, 404, replied.body);
  assert.equal(await outboundCount(hiddenConv.id), 0);

  const closed = await close(hiddenConv.id);
  assert.equal(closed.statusCode, 404, closed.body);
  assert.equal(await statusOf(hiddenConv.id), statusBefore);
});

// ── channel-scoped-visibility：存取層級 ──

test('唯讀成員不能回覆：回 403 CHANNEL_ACCESS_LEVEL_INSUFFICIENT，不送出訊息', async () => {
  const res = await reply(readOnlyConv.id);
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.code, 'CHANNEL_ACCESS_LEVEL_INSUFFICIENT');
  assert.equal(await outboundCount(readOnlyConv.id), 0);
});

test('回覆層級不能關閉對話：回 403 CHANNEL_ACCESS_LEVEL_INSUFFICIENT，狀態不變', async () => {
  const statusBefore = await statusOf(replyOnlyConv.id);
  const res = await close(replyOnlyConv.id);
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.code, 'CHANNEL_ACCESS_LEVEL_INSUFFICIENT');
  assert.equal(await statusOf(replyOnlyConv.id), statusBefore);
});

test('群發不檢查渠道層級：唯讀渠道的成員有 marketing.broadcast 時照常送出', async () => {
  const fb = await createChannel('broadcast', { channelType: 'FB' });
  await bind(fb.id, broadcaster.id, 'read_only');
  const contact = await owner.contact.create({ data: { tenantId: A, displayName: `${MARK}-recipient` } });
  await owner.channelIdentity.create({
    data: { contactId: contact.id, channelId: fb.id, channelType: 'FB', uid: `${MARK}-psid` },
  });
  const material = await owner.material.create({
    data: { tenantId: A, name: `${MARK}-material`, channelType: 'FB', contentType: 'text', body: { text: 'hi' } },
  });
  const broadcast = await owner.broadcast.create({
    data: { tenantId: A, channelId: fb.id, name: `${MARK}-broadcast`, createdById: broadcaster.id, materialId: material.id },
  });
  sendMessage.mockClear();

  const res = await broadcasterApp.inject({ method: 'POST', url: `/api/v1/marketing/broadcasts/${broadcast.id}/send` });

  assert.equal(res.statusCode, 200, res.body);
  assert.equal(sendMessage.mock.calls.length, 1, '送給唯一的收件人');
});

// ── channel-scoped-visibility：團隊對話只限團隊成員操作 ──

test('非團隊成員操作團隊對話被拒：可見渠道但不是團隊成員或被指派人 → 403，不送出訊息', async () => {
  const res = await reply(teamConv.id);
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.code, 'FORBIDDEN');
  assert.equal(await outboundCount(teamConv.id), 0);
});

test('被指派人可以操作：不是團隊成員，但是被指派人，可以回覆', async () => {
  const res = await reply(assignedTeamConv.id);
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(await outboundCount(assignedTeamConv.id), 1);
});

// ── channel-scoped-visibility：進站訊息分派不受成員可見範圍限制 ──

class Rollback extends Error {}

test('進站訊息正常建立：沒有成員可見的渠道，訊息照常寫入並建立對話', async () => {
  const unbound = await createChannel('inbound-unbound', { channelType: 'FB' });
  assert.equal(await owner.agentChannelAccess.count({ where: { channelId: unbound.id } }), 0);
  assert.equal(await owner.channelTeamAccess.count({ where: { channelId: unbound.id } }), 0);

  const parsed: ParsedWebhookMessage = {
    channelMsgId: `${MARK}-mid`,
    contactUid: `${MARK}-inbound-psid`,
    timestamp: new Date(),
    contentType: 'text',
    content: { text: '你好' },
    rawPayload: {},
  };
  await owner
    .$transaction(async (tx) => {
      await processInboundMessage(tx as never, io as never, {}, { id: unbound.id, channelType: 'FB' }, A, parsed);
      const conversation = await tx.conversation.findFirst({ where: { channelId: unbound.id } });
      assert.ok(conversation, '建立了對話');
      const messages = await tx.message.findMany({ where: { conversationId: conversation.id, direction: 'INBOUND' } });
      assert.deepEqual(messages.map((m) => (m.content as { text?: string }).text), ['你好']);
      throw new Rollback();
    })
    .catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });
});

// ── channel-visibility-defaults：Unbound Channel Is Not Visible ──

const asSet = (accessible: Awaited<ReturnType<typeof getAccessibleChannelIds>>) => {
  assert.ok(accessible instanceof Set, '沒有 channel.view_all 時回傳集合');
  return accessible as Set<string>;
};

test('Inactive channel hidden：直接綁定的渠道停用後，不在可見集合內', async () => {
  const role = await createRole('inactive', ['inbox.view']);
  const agent = await createAgent('inactive', role.id);
  const active = await createChannel('bound-active');
  const inactive = await createChannel('bound-inactive', { isActive: false });
  await bind(active.id, agent.id);
  await bind(inactive.id, agent.id);
  const ctx = { tenantId: A, agentId: agent.id, hasViewAll: false };
  const db = tenantScopedClient(tenantDb, A);

  const set = asSet(await getAccessibleChannelIds(db, ctx));
  assert.ok(set.has(active.id));
  assert.ok(!set.has(inactive.id));
  assert.equal(await resolveChannelAccessLevel(db, ctx, inactive.id), null);
});

test('Direct and team bindings combined：直接綁定與團隊授權取聯集', async () => {
  const role = await createRole('combined', ['inbox.view']);
  const agent = await createAgent('combined', role.id);
  const direct = await createChannel('direct');
  const viaTeam = await createChannel('via-team');
  const unrelated = await createChannel('unrelated');
  await bind(direct.id, agent.id);
  await bind(unrelated.id, other.id);
  const combinedTeam = await owner.team.create({ data: { tenantId: A, name: `${MARK}-combined` } });
  await owner.agentTeamMember.create({ data: { teamId: combinedTeam.id, agentId: agent.id } });
  await owner.channelTeamAccess.create({ data: { channelId: viaTeam.id, teamId: combinedTeam.id, accessLevel: 'full' } });

  const set = asSet(
    await getAccessibleChannelIds(tenantScopedClient(tenantDb, A), { tenantId: A, agentId: agent.id, hasViewAll: false }),
  );
  const mine = [direct.id, viaTeam.id, unrelated.id].filter((id) => set.has(id)).sort();
  assert.deepEqual(mine, [direct.id, viaTeam.id].sort());
});
