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
  app.decorate('prisma', tenantDb);
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

// ── change extend-channel-visibility-to-contacts-and-marketing ──

const marketerRole = await createRole('marketer', ['marketing.view', 'marketing.manage', 'marketing.broadcast']);
const marketer = await createAgent('marketer', marketerRole.id);
await bind(visible.id, marketer.id, 'read_only');
const marketerApp = await buildApp(marketer.id, marketerRole.id);
const audienceTag = await owner.tag.create({ data: { tenantId: A, name: `${MARK}-audience` } });

afterAll(async () => {
  await marketerApp.close();
  // 群發本身由上方的 afterAll 依渠道刪除（後註冊的 afterAll 先執行，所以這裡先刪群發再刪活動）
  await owner.broadcast.deleteMany({ where: { tenantId: A, name: { startsWith: MARK } } });
  await owner.campaign.deleteMany({ where: { tenantId: A, name: { startsWith: MARK } } });
  await owner.segment.deleteMany({ where: { tenantId: A, name: { startsWith: MARK } } });
  await owner.contactTag.deleteMany({ where: { tagId: audienceTag.id } });
  await owner.tag.deleteMany({ where: { id: audienceTag.id, tenantId: A } });
});

/** 在可見與不可見渠道都有身份的聯絡人 */
async function crossChannelContact(slug: string) {
  const contact = await owner.contact.create({ data: { tenantId: A, displayName: `${MARK}-${slug}` } });
  for (const ch of [visible, hidden]) {
    await owner.channelIdentity.create({
      data: { contactId: contact.id, channelId: ch.id, channelType: 'WEBCHAT', uid: `${MARK}-${slug}-${ch.id}`, profileName: `${MARK}-${slug}-暱稱-${ch.id === visible.id ? 'visible' : 'hidden'}` },
    });
  }
  return contact;
}

test('對話的聯絡人身份：只含可見渠道的身份，不含不可見渠道的 uid 與暱稱', async () => {
  const contact = await crossChannelContact('conv-identity');
  const conv = await owner.conversation.create({
    data: { tenantId: A, contactId: contact.id, channelId: visible.id, channelType: 'WEBCHAT' },
  });
  const res = await memberApp.inject({ method: 'GET', url: `/api/v1/conversations/${conv.id}` });
  assert.equal(res.statusCode, 200, res.body);
  const ids = (res.json().data.contact.channelIdentities as Array<{ channelId: string }>).map((i) => i.channelId);
  assert.deepEqual(ids, [visible.id]);
  assert.ok(!res.body.includes(`${MARK}-conv-identity-${hidden.id}`), '不可出現不可見渠道的 uid');
  assert.ok(!res.body.includes('暱稱-hidden'), '不可出現不可見渠道的暱稱');
});

test('工單的聯絡人身份：只含可見渠道的身份', async () => {
  const contact = await crossChannelContact('case-identity');
  const caseRecord = await owner.case.create({
    data: { tenantId: A, contactId: contact.id, channelId: visible.id, title: `${MARK}-case-identity` },
  });
  const res = await memberApp.inject({ method: 'GET', url: `/api/v1/cases/${caseRecord.id}` });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().data.contact.channelIdentities.length, 1);
  assert.ok(!res.body.includes(`${MARK}-case-identity-${hidden.id}`), '不可出現不可見渠道的 uid');
});

const visibleBroadcast = await owner.broadcast.create({
  data: { tenantId: A, channelId: visible.id, name: `${MARK}-bc-visible`, createdById: marketer.id },
});
const hiddenBroadcast = await owner.broadcast.create({
  data: { tenantId: A, channelId: hidden.id, name: `${MARK}-bc-hidden`, createdById: other.id },
});

test('群發列表只含可見渠道：看得到 CH-A 的群發，看不到 CH-B 的群發', async () => {
  const res = await marketerApp.inject({ method: 'GET', url: '/api/v1/marketing/broadcasts?limit=100' });
  assert.equal(res.statusCode, 200, res.body);
  const ids = (res.json().data as Array<{ id: string }>).map((b) => b.id);
  assert.ok(ids.includes(visibleBroadcast.id), '應列出可見渠道的群發');
  assert.ok(!ids.includes(hiddenBroadcast.id), '不可列出不可見渠道的群發');
});

test('送出不可見渠道的群發被拒：讀取、收件人、送出、取消都回 404，狀態不變，不送出訊息', async () => {
  sendMessage.mockClear();
  for (const [method, path] of [
    ['GET', ''],
    ['GET', '/recipients'],
    ['POST', '/send'],
    ['POST', '/cancel'],
  ] as const) {
    const res = await marketerApp.inject({ method, url: `/api/v1/marketing/broadcasts/${hiddenBroadcast.id}${path}` });
    assert.equal(res.statusCode, 404, `${method} ${path} 應回 404，實際 ${res.statusCode} ${res.body}`);
    assert.ok(!res.body.includes(`${MARK}-bc-hidden`), `${method} ${path} 不可回傳群發內容`);
  }
  const after = await owner.broadcast.findUniqueOrThrow({ where: { id: hiddenBroadcast.id } });
  assert.equal(after.status, 'draft');
  assert.equal(sendMessage.mock.calls.length, 0);
});

test('用不可見渠道建立群發被拒：回 404「找不到渠道」，不建立群發', async () => {
  const material = await owner.material.create({
    data: { tenantId: A, name: `${MARK}-create-material`, channelType: 'WEBCHAT', contentType: 'text', body: { text: 'hi' } },
  });
  const res = await marketerApp.inject({
    method: 'POST',
    url: '/api/v1/marketing/broadcasts',
    payload: { name: `${MARK}-bc-create-hidden`, channelId: hidden.id, materialId: material.id, targetType: 'all' },
  });
  assert.equal(res.statusCode, 404, res.body);
  assert.match(res.json().error.message, /渠道/);
  assert.equal(await owner.broadcast.count({ where: { name: `${MARK}-bc-create-hidden` } }), 0);
});

test('預估不可見渠道的受眾被拒：回 404，不回傳人數', async () => {
  const res = await marketerApp.inject({
    method: 'POST',
    url: '/api/v1/marketing/broadcasts/audience-preview',
    payload: { channelId: hidden.id, targetType: 'all' },
  });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().data, undefined);
});

test('分眾預覽只算看得到的聯絡人：可見渠道 2 位、只在不可見渠道 3 位 → 2', async () => {
  for (const [ch, n] of [[visible, 2], [hidden, 3]] as const) {
    for (let i = 0; i < n; i += 1) {
      const contact = await owner.contact.create({ data: { tenantId: A, displayName: `${MARK}-audience-${ch.id}-${i}` } });
      await owner.channelIdentity.create({
        data: { contactId: contact.id, channelId: ch.id, channelType: 'WEBCHAT', uid: `${MARK}-audience-${ch.id}-${i}` },
      });
      await owner.contactTag.create({ data: { contactId: contact.id, tagId: audienceTag.id } });
    }
  }
  const res = await marketerApp.inject({
    method: 'POST',
    url: '/api/v1/marketing/segments/preview',
    payload: { conditions: [{ field: 'tag', operator: 'eq', value: audienceTag.id }] },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().data.count, 2);
});

test('分眾預覽只算看得到的聯絡人：分眾列表與單筆的 contactCount 也只算看得到的聯絡人', async () => {
  // 儲存的 contactCount 是全租戶的 5（建立時以 ALL_CHANNELS 計算）
  const segment = await owner.segment.create({
    data: {
      tenantId: A,
      name: `${MARK}-segment`,
      rules: { conditions: [{ field: 'tag', operator: 'eq', value: audienceTag.id }], logic: 'AND' },
      conditions: [{ field: 'tag', operator: 'eq', value: audienceTag.id }],
      contactCount: 5,
    },
  });

  const list = await marketerApp.inject({ method: 'GET', url: '/api/v1/marketing/segments?limit=50' });
  assert.equal(list.statusCode, 200, list.body);
  const row = (list.json().data as Array<{ id: string; contactCount: number }>).find((s) => s.id === segment.id);
  assert.equal(row?.contactCount, 2);
  const one = await marketerApp.inject({ method: 'GET', url: `/api/v1/marketing/segments/${segment.id}` });
  assert.equal(one.statusCode, 200, one.body);
  assert.equal(one.json().data.contactCount, 2);
});

test('行銷活動只含可見渠道的群發：活動列表的群發數是 1，詳情只列 CH-A 的群發', async () => {
  const campaign = await owner.campaign.create({ data: { tenantId: A, name: `${MARK}-campaign`, createdById: marketer.id } });
  const inCampaign = await Promise.all(
    [visible, hidden].map((ch) =>
      owner.broadcast.create({
        data: { tenantId: A, channelId: ch.id, campaignId: campaign.id, name: `${MARK}-campaign-bc-${ch.id}`, createdById: marketer.id, totalCount: 7 },
      }),
    ),
  );

  const list = await marketerApp.inject({ method: 'GET', url: '/api/v1/marketing/campaigns?limit=50' });
  assert.equal(list.statusCode, 200, list.body);
  const row = (list.json().data as Array<{ id: string; _count: { broadcasts: number } }>).find((c) => c.id === campaign.id);
  assert.equal(row?._count.broadcasts, 1);

  const detail = await marketerApp.inject({ method: 'GET', url: `/api/v1/marketing/campaigns/${campaign.id}` });
  assert.equal(detail.statusCode, 200, detail.body);
  const ids = (detail.json().data.broadcasts as Array<{ id: string }>).map((b) => b.id);
  assert.deepEqual(ids, [inCampaign[0]!.id]);
  assert.ok(!detail.body.includes(`${MARK}-campaign-bc-${hidden.id}`), '不可出現不可見渠道的群發');
});

test('分眾預覽只算看得到的聯絡人：舊資料 rules 為空的分眾不讓列表變成 500，人數是 0', async () => {
  const legacy = await owner.segment.create({
    data: { tenantId: A, name: `${MARK}-segment-legacy`, rules: undefined, conditions: [], contactCount: 9 },
  });
  const list = await marketerApp.inject({ method: 'GET', url: '/api/v1/marketing/segments?limit=50' });
  assert.equal(list.statusCode, 200, list.body);
  const row = (list.json().data as Array<{ id: string; contactCount: number }>).find((s) => s.id === legacy.id);
  assert.equal(row?.contactCount, 0);
});

test('只有其他分店群發的行銷活動：列表不含、以 ID 讀取回 404；沒有群發的活動照常看得到', async () => {
  const hiddenOnly = await owner.campaign.create({ data: { tenantId: A, name: `${MARK}-campaign-hidden`, createdById: other.id } });
  await owner.broadcast.create({
    data: { tenantId: A, channelId: hidden.id, campaignId: hiddenOnly.id, name: `${MARK}-campaign-hidden-bc`, createdById: other.id },
  });
  const empty = await owner.campaign.create({ data: { tenantId: A, name: `${MARK}-campaign-empty`, createdById: other.id } });

  const list = await marketerApp.inject({ method: 'GET', url: '/api/v1/marketing/campaigns?limit=50' });
  assert.equal(list.statusCode, 200, list.body);
  const ids = (list.json().data as Array<{ id: string }>).map((c) => c.id);
  assert.ok(!ids.includes(hiddenOnly.id), '不可列出只有其他分店群發的活動');
  assert.ok(ids.includes(empty.id), '沒有群發的活動照常列出');

  const detail = await marketerApp.inject({ method: 'GET', url: `/api/v1/marketing/campaigns/${hiddenOnly.id}` });
  assert.equal(detail.statusCode, 404, detail.body);
  assert.ok(!detail.body.includes(`${MARK}-campaign-hidden`), '不可回傳活動名稱');
  const patch = await marketerApp.inject({ method: 'PATCH', url: `/api/v1/marketing/campaigns/${hiddenOnly.id}`, payload: { name: '改名' } });
  assert.equal(patch.statusCode, 404, patch.body);
  const del = await marketerApp.inject({ method: 'DELETE', url: `/api/v1/marketing/campaigns/${hiddenOnly.id}` });
  assert.equal(del.statusCode, 404, del.body);
  assert.equal((await owner.campaign.findUniqueOrThrow({ where: { id: hiddenOnly.id } })).name, `${MARK}-campaign-hidden`);
});
