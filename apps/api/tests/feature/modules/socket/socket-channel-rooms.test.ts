/**
 * 渠道相關的 socket 推播只送給看得到該渠道的成員（issue #427，AUDIT RBAC-04 的 socket 部分；
 * 主規格 channel-scoped-visibility「與即時推播一致」、socket-room-authorization「連線時加入的房間」）。
 *
 * 走真實的 socket plugin（JWT 驗證、連線時加入房間）與真實的 socket.io-client 連線；
 * 進站訊息走 processInboundMessage，渠道外掛以 mock 取代，不連外。
 * 資料以 MARK 標記，afterAll 刪除；進站訊息在交易內寫入後 rollback。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, test, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { PrismaClient } from '@prisma/client';
import type { ParsedWebhookMessage } from '@open333crm/channel-plugins';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import socketPlugin from '#src/plugins/socket.plugin.js';
import { processInboundMessage } from '#src/modules/webhook/webhook.service.js';
import { markConversationRead } from '#src/modules/conversation/conversation.service.js';

vi.mock('@open333crm/channel-plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@open333crm/channel-plugins')>()),
  getChannelPlugin: () => ({
    sendMessage: async () => ({ success: true, channelMsgId: 'stub-msg' }),
    getProfile: async (uid: string) => ({ uid, displayName: 'Stub User' }),
  }),
}));

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const MARK = `ci-socket-channel-rooms-${Date.now()}`;

class Rollback extends Error {}

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

async function createChannel(slug: string) {
  return owner.channel.create({
    data: { tenantId: A, channelType: 'WEBCHAT', isActive: true, displayName: `${MARK}-${slug}`, credentialsEncrypted: 'x' },
  });
}

const bind = (channelId: string, agentId: string) =>
  owner.agentChannelAccess.create({ data: { channelId, agentId, accessLevel: 'full' } });

interface Received {
  event: string;
  data: Record<string, unknown>;
}

let app: FastifyInstance;
let baseUrl = '';
const clients: ClientSocket[] = [];

/** 以成員身分連上 socket，記下收到的渠道相關事件 */
async function connectAs(agent: { id: string; roleId: string | null }, onClient?: (c: ClientSocket) => void) {
  const token = app.jwt.sign({ agentId: agent.id, tenantId: A, role: 'AGENT', roleId: agent.roleId, typ: 'access' });
  const client = connectClient(baseUrl, { auth: { token }, transports: ['websocket'], forceNew: true });
  clients.push(client);
  onClient?.(client);
  const received: Received[] = [];
  for (const event of ['message.new', 'conversation.updated', 'conversation.created']) {
    client.on(event, (data: Record<string, unknown>) => received.push({ event, data }));
  }
  await new Promise<void>((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('connect_error', reject);
  });
  return received;
}

async function waitFor(check: () => boolean, label: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`逾時：${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 200));
const eventsFor = (received: Received[], conversationId: string) =>
  received.filter((r) => r.data.conversationId === conversationId || r.data.id === conversationId);

// ── fixture ──
const inboxRole = await createRole('inbox', ['inbox.view', 'inbox.reply']);
const hqRole = await createRole('hq', ['inbox.view', 'inbox.reply', 'channel.view_all']);
const noGrant = await createAgent('no-grant', inboxRole.id);
const grantedA = await createAgent('granted-a', inboxRole.id);
const grantedB = await createAgent('granted-b', inboxRole.id);
const hq = await createAgent('hq', hqRole.id);
const chA = await createChannel('a');
const chB = await createChannel('b');
await bind(chA.id, grantedA.id);
await bind(chB.id, grantedB.id);

beforeAll(async () => {
  app = Fastify();
  await app.register(fastifyJwt, { secret: process.env.JWT_SECRET! });
  app.decorate('prismaAdmin', owner);
  await app.register(socketPlugin);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await app.close();
  const channelIds = [chA.id, chB.id];
  await owner.message.deleteMany({ where: { conversation: { channelId: { in: channelIds } } } });
  await owner.conversation.deleteMany({ where: { channelId: { in: channelIds } } });
  await owner.channelIdentity.deleteMany({ where: { channelId: { in: channelIds } } });
  await owner.agentChannelAccess.deleteMany({ where: { channelId: { in: channelIds } } });
  await owner.channel.deleteMany({ where: { id: { in: channelIds } } });
  await owner.contact.deleteMany({ where: { tenantId: A, displayName: { startsWith: MARK } } });
  await owner.agent.deleteMany({ where: { email: { startsWith: MARK } } });
  await owner.role.deleteMany({ where: { slug: { startsWith: MARK } } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

/** WebChat 訪客在 CH-B 送出一則訊息（進站流程，寫入後 rollback） */
async function inboundOnChannelB(text: string): Promise<string> {
  const parsed: ParsedWebhookMessage = {
    channelMsgId: `${MARK}-${text}`,
    contactUid: `${MARK}-visitor-${text}`,
    timestamp: new Date(),
    contentType: 'text',
    content: { text },
    rawPayload: {},
  };
  let conversationId = '';
  await owner
    .$transaction(async (tx) => {
      await processInboundMessage(tx as never, app.io, {}, { id: chB.id, channelType: 'WEBCHAT' }, A, parsed);
      const conversation = await tx.conversation.findFirst({ where: { channelId: chB.id }, orderBy: { createdAt: 'desc' } });
      assert.ok(conversation, '建立了對話');
      conversationId = conversation.id;
      throw new Rollback();
    })
    .catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });
  return conversationId;
}

test('沒有渠道授權的成員收不到其他渠道的 message.new 與 conversation.updated；有授權與 view_all 收得到', async () => {
  const noGrantRx = await connectAs(noGrant);
  const grantedARx = await connectAs(grantedA);
  const grantedBRx = await connectAs(grantedB);
  const hqRx = await connectAs(hq);

  const conversationId = await inboundOnChannelB('客人的私密訊息');

  // 有授權（CH-B）與總店（channel.view_all）照常收到
  for (const [rx, who] of [[grantedBRx, '有 CH-B 授權的成員'], [hqRx, '總店']] as const) {
    await waitFor(
      () => eventsFor(rx, conversationId).some((r) => r.event === 'message.new')
        && eventsFor(rx, conversationId).some((r) => r.event === 'conversation.updated'),
      `${who}收到 message.new 與 conversation.updated`,
    );
    const msg = eventsFor(rx, conversationId).find((r) => r.event === 'message.new');
    assert.equal((msg?.data.message as { content: { text: string } }).content.text, '客人的私密訊息');
  }

  await settle();
  // 沒有任何授權、只有 CH-A 授權的成員都收不到 CH-B 的事件
  assert.deepEqual(eventsFor(noGrantRx, conversationId).map((r) => r.event), [], '沒有授權的成員不收任何事件');
  assert.deepEqual(eventsFor(grantedARx, conversationId).map((r) => r.event), [], '只有 CH-A 授權的成員不收 CH-B 的事件');
});

test('客服操作推的 conversation.updated（標為已讀）也只送給看得到該渠道的成員', async () => {
  const contact = await owner.contact.create({ data: { tenantId: A, displayName: `${MARK}-read` } });
  const conv = await owner.conversation.create({
    data: { tenantId: A, contactId: contact.id, channelId: chB.id, channelType: 'WEBCHAT', unreadCount: 3 },
  });
  const noGrantRx = await connectAs(noGrant);
  const grantedBRx = await connectAs(grantedB);
  const hqRx = await connectAs(hq);

  await markConversationRead(tenantScopedClient(tenantDb, A), app.io, conv.id, A);

  await waitFor(() => eventsFor(grantedBRx, conv.id).length > 0, '有 CH-B 授權的成員收到');
  await waitFor(() => eventsFor(hqRx, conv.id).length > 0, '總店收到');
  await settle();
  assert.deepEqual(eventsFor(noGrantRx, conv.id), [], '沒有授權的成員不收');
});

test('授權變更後重新計算已連線 socket 的房間：新授權的渠道開始收到，撤銷後不再收到', async () => {
  const late = await createAgent('late', inboxRole.id);
  let client: ClientSocket | undefined;
  const rx = await connectAs(late, (c) => { client = c; });

  const before = await inboundOnChannelB('授權前');
  await settle();
  assert.deepEqual(eventsFor(rx, before), [], '授權前不收');

  await bind(chB.id, late.id);
  await app.syncSocketChannelRooms(A, late.id);
  const granted = await inboundOnChannelB('授權後');
  await waitFor(() => eventsFor(rx, granted).some((r) => r.event === 'message.new'), '授權後收到');

  // 授權期間訂閱的對話房間：撤銷後重新授權，連線離開這個房間
  const contact = await owner.contact.create({ data: { tenantId: A, displayName: `${MARK}-late-sub` } });
  const conv = await owner.conversation.create({ data: { tenantId: A, contactId: contact.id, channelId: chB.id, channelType: 'WEBCHAT' } });
  const ack = await client!.emitWithAck('subscribe', `conversation:${conv.id}`);
  assert.deepEqual(ack, { ok: true, room: `conversation:${conv.id}` });
  assert.equal((await app.io.in(`conversation:${conv.id}`).fetchSockets()).length, 1);

  await owner.agentChannelAccess.deleteMany({ where: { agentId: late.id } });
  await app.syncSocketChannelRooms(A, late.id);
  assert.equal((await app.io.in(`conversation:${conv.id}`).fetchSockets()).length, 0, '撤銷後離開已訂閱的對話房間');
  const revoked = await inboundOnChannelB('撤銷後');
  await settle();
  assert.deepEqual(eventsFor(rx, revoked), [], '撤銷後不收');
});

test('停用或刪除的成員：重新計算時斷開他已連線的 socket，之後重新連線被拒（PR #438 審查）', async () => {
  const leaving = await createAgent('leaving', inboxRole.id);
  await bind(chB.id, leaving.id);
  let client: ClientSocket | undefined;
  const rx = await connectAs(leaving, (c) => { client = c; });

  await owner.agent.update({ where: { id: leaving.id }, data: { isActive: false } });
  await app.syncSocketChannelRooms(A, leaving.id);
  await settle();
  assert.equal(client!.connected, false, '停用的成員被斷線');
  assert.equal((await app.io.in(`tenant:${A}:agent:${leaving.id}`).fetchSockets()).length, 0, '停用的成員沒有連線留在伺服器');

  const after = await inboundOnChannelB('停用後');
  await settle();
  assert.deepEqual(eventsFor(rx, after), [], '停用後不收');

  await assert.rejects(connectAs(leaving), '停用的成員重新連線被拒');
});

test('永久刪除的成員：重新計算時斷開他已連線的 socket（PR #438 審查）', async () => {
  const purged = await createAgent('purged', inboxRole.id);
  let client: ClientSocket | undefined;
  await connectAs(purged, (c) => { client = c; });
  await owner.agent.delete({ where: { id: purged.id } });
  await app.syncSocketChannelRooms(A, purged.id);
  await settle();
  assert.equal(client!.connected, false, '刪除的成員被斷線');
});
