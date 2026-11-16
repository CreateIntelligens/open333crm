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
import { agentVisibilityResolver, getAccessibleChannelIds, resolveChannelAccessLevel } from '#src/services/channel-visibility.js';
import { redis } from '@open333crm/core';
import { createBroadcastJobRunner } from '#src/modules/marketing/broadcast-coupon.worker.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';

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

/**
 * 執行群發的佇列 job（與 index.ts 的 coupon-broadcast 佇列相同的組法）。「立即發送」回 202 後在背景發送
 * （change fix-plain-broadcast-send-362），發送結果寫在群發上，不在 HTTP 回應裡
 */
async function runSendJob(broadcastId: string) {
  await createBroadcastJobRunner({
    prisma: tenantDb, adminPrisma: owner, redis, io: io as never, store: memBindingStore(), visibilityOf: agentVisibilityResolver(owner, redis),
  })(A, broadcastId);
  return owner.broadcast.findFirst({ where: { id: broadcastId } });
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
  // 立即發送寫進 outbox 的群發 job（change fix-plain-broadcast-send-362）
  const broadcastIds = (await owner.broadcast.findMany({ where: { channelId: { in: channelIds } }, select: { id: true } })).map((b) => b.id);
  await owner.$executeRaw`DELETE FROM outbox WHERE "queueName" = 'coupon-broadcast' AND payload->>'broadcastId' = ANY(${broadcastIds}::text[])`;
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

  assert.equal(res.statusCode, 202, res.body);
  const done = await runSendJob(broadcast.id);
  assert.equal(done?.status, 'completed', done?.failureReason ?? '');
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
/**
 * 建立與送出群發用的可見渠道：群發只能用能主動推送的渠道，WebChat 會被拒（change reject-webchat-push-415）。
 * 用 LINE 而不是 FB：分群條件「有 FB 帳號」不能被這個渠道的身分本身符合
 */
const visiblePush = await createChannel('visible-push', { channelType: 'LINE' });
await bind(visiblePush.id, marketer.id, 'read_only');
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

test('總店規劃的空活動：分店看得到，並能以自己的渠道建立群發加入', async () => {
  const planned = await owner.campaign.create({ data: { tenantId: A, name: `${MARK}-campaign-planned`, createdById: other.id } });
  const list = await marketerApp.inject({ method: 'GET', url: '/api/v1/marketing/campaigns?limit=50' });
  assert.ok((list.json().data as Array<{ id: string }>).some((c) => c.id === planned.id), '空活動照常列出');

  const material = await owner.material.create({
    data: { tenantId: A, name: `${MARK}-planned-material`, channelType: 'line', contentType: 'text', body: { text: 'hi' } },
  });
  const created = await marketerApp.inject({
    method: 'POST',
    url: '/api/v1/marketing/broadcasts',
    payload: { name: `${MARK}-bc-into-planned`, channelId: visiblePush.id, materialId: material.id, targetType: 'all', campaignId: planned.id },
  });
  assert.equal(created.statusCode, 201, created.body);
});

test('修改含其他分店群發的活動被拒：修改、刪除、建立群發指定這個活動都回 403', async () => {
  const mixed = await owner.campaign.create({ data: { tenantId: A, name: `${MARK}-campaign-mixed`, createdById: other.id } });
  for (const ch of [visible, hidden]) {
    await owner.broadcast.create({
      data: { tenantId: A, channelId: ch.id, campaignId: mixed.id, name: `${MARK}-campaign-mixed-bc-${ch.id}`, createdById: other.id },
    });
  }
  const code = (res: { json: () => { error?: { code?: string } } }) => res.json().error?.code;
  const patch = await marketerApp.inject({ method: 'PATCH', url: `/api/v1/marketing/campaigns/${mixed.id}`, payload: { status: 'cancelled' } });
  assert.equal(patch.statusCode, 403, patch.body);
  assert.equal(code(patch), 'CAMPAIGN_HAS_OTHER_CHANNELS');
  const del = await marketerApp.inject({ method: 'DELETE', url: `/api/v1/marketing/campaigns/${mixed.id}` });
  assert.equal(del.statusCode, 403, del.body);
  assert.equal((await owner.campaign.findUniqueOrThrow({ where: { id: mixed.id } })).status, 'draft');

  const material = await owner.material.create({
    data: { tenantId: A, name: `${MARK}-campaign-material`, channelType: 'line', contentType: 'text', body: { text: 'hi' } },
  });
  const created = await marketerApp.inject({
    method: 'POST',
    url: '/api/v1/marketing/broadcasts',
    payload: { name: `${MARK}-bc-into-mixed`, channelId: visiblePush.id, materialId: material.id, targetType: 'all', campaignId: mixed.id },
  });
  assert.equal(created.statusCode, 403, created.body);
  assert.equal(code(created), 'CAMPAIGN_HAS_OTHER_CHANNELS');
  assert.equal(await owner.broadcast.count({ where: { name: `${MARK}-bc-into-mixed` } }), 0);
});

test('工單連結的對話：只含可見渠道的對話', async () => {
  const contact = await crossChannelContact('case-conversations');
  const caseRecord = await owner.case.create({
    data: { tenantId: A, contactId: contact.id, channelId: visible.id, title: `${MARK}-case-conversations` },
  });
  const convs = [];
  for (const ch of [visible, hidden]) {
    convs.push(
      await owner.conversation.create({
        data: { tenantId: A, contactId: contact.id, channelId: ch.id, channelType: 'WEBCHAT', caseId: caseRecord.id },
      }),
    );
  }
  const res = await memberApp.inject({ method: 'GET', url: `/api/v1/cases/${caseRecord.id}` });
  assert.equal(res.statusCode, 200, res.body);
  const ids = (res.json().data.conversations as Array<{ id: string }>).map((c) => c.id);
  assert.deepEqual(ids, [convs[0]!.id]);
});

// ── change segment-broadcast-creator-visibility：分群條件依群發建立者的可見範圍判斷 ──

const hqRole = await createRole('hq-marketer', ['marketing.view', 'marketing.manage', 'marketing.broadcast', 'channel.view_all']);
const hqMarketer = await createAgent('hq-marketer', hqRole.id);
const hqApp = await buildApp(hqMarketer.id, hqRole.id);
afterAll(() => hqApp.close());

/** 聯絡人在可見的 LINE 渠道有身分，在其他分店的 FB 渠道也有身分；分群條件是「有 FB 帳號」 */
async function crossBranchSegment(slug: string) {
  const branchFb = await createChannel(`${slug}-fb`, { channelType: 'FB' });
  await bind(branchFb.id, other.id);
  const contact = await owner.contact.create({ data: { tenantId: A, displayName: `${MARK}-${slug}` } });
  await owner.channelIdentity.create({
    data: { contactId: contact.id, channelId: visiblePush.id, channelType: 'LINE', uid: `${MARK}-${slug}-line` },
  });
  await owner.channelIdentity.create({
    data: { contactId: contact.id, channelId: branchFb.id, channelType: 'FB', uid: `${MARK}-${slug}-fb` },
  });
  const rules = { conditions: [{ field: 'channelType', operator: 'eq', value: 'FB' }], logic: 'AND' };
  const segment = await owner.segment.create({
    data: { tenantId: A, name: `${MARK}-${slug}-segment`, rules, conditions: rules.conditions, contactCount: 0 },
  });
  const material = await owner.material.create({
    data: { tenantId: A, name: `${MARK}-${slug}-material`, channelType: 'line', contentType: 'text', body: { text: 'hi' } },
  });
  return { segment, material };
}

test('分店建立的分群群發只以可見渠道判斷條件：預估與送出都不算只在其他分店渠道符合條件的人', async () => {
  const { segment, material } = await crossBranchSegment('branch-seg');
  const preview = await marketerApp.inject({
    method: 'POST',
    url: '/api/v1/marketing/broadcasts/audience-preview',
    payload: { channelId: visiblePush.id, targetType: 'segment', segmentId: segment.id },
  });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().data.matched, 0, '預估不算只在其他分店渠道符合條件的人');

  const broadcast = await owner.broadcast.create({
    data: {
      tenantId: A, channelId: visiblePush.id, name: `${MARK}-branch-seg-bc`, createdById: marketer.id,
      materialId: material.id, targetType: 'segment', segmentId: segment.id,
    },
  });
  sendMessage.mockClear();
  const res = await marketerApp.inject({ method: 'POST', url: `/api/v1/marketing/broadcasts/${broadcast.id}/send` });
  assert.equal(res.statusCode, 202, res.body);
  const done = await runSendJob(broadcast.id);
  assert.equal(done?.status, 'failed');
  assert.equal(done?.failureCode, 'BROADCAST_NO_RECIPIENTS');
  assert.equal(sendMessage.mock.calls.length, 0);
});

test('總店建立的分群群發以所有渠道判斷條件：分店成員按下送出也依建立者判斷', async () => {
  const { segment, material } = await crossBranchSegment('hq-seg');
  const preview = await hqApp.inject({
    method: 'POST',
    url: '/api/v1/marketing/broadcasts/audience-preview',
    payload: { channelId: visiblePush.id, targetType: 'segment', segmentId: segment.id },
  });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.ok(preview.json().data.matched >= 1, preview.body);

  const broadcast = await owner.broadcast.create({
    data: {
      tenantId: A, channelId: visiblePush.id, name: `${MARK}-hq-seg-bc`, createdById: hqMarketer.id,
      materialId: material.id, targetType: 'segment', segmentId: segment.id,
    },
  });
  sendMessage.mockClear();
  // 由分店成員按下送出：條件仍依建立者（總店）判斷，與排程器背景送出相同
  const res = await marketerApp.inject({ method: 'POST', url: `/api/v1/marketing/broadcasts/${broadcast.id}/send` });
  assert.equal(res.statusCode, 202, res.body);
  const done = await runSendJob(broadcast.id);
  assert.equal(done?.status, 'completed', done?.failureReason ?? '');
  assert.ok(sendMessage.mock.calls.length >= 1);
});
