/**
 * 聯絡人跨渠道訊息（GET /api/v1/contacts/:id/messages；change add-email-identity-merge，
 * spec cross-channel-conversation-view）。路由層整合測試，走真實權限計算與渠道可見性。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import contactRoutes from '#src/modules/contact/contact.routes.js';
import { TENANT_A, TENANT_B } from '#tests/setup/feature-config.js';

loadEnvConfig();
const prisma = new PrismaClient();
const T = TENANT_A;
const stamp = Date.now();

async function createRole(slug: string, permissions: string[]) {
  return prisma.role.create({
    data: {
      tenantId: T,
      slug: `ci-msg-${slug}-${stamp}`,
      name: `CI 跨渠道訊息（${slug}）`,
      permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) },
    },
  });
}

async function buildApp(roleId: string, agentId: string, tenantId = T) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', prisma);
  app.decorate('prismaAdmin', prisma);
  app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agentId, tenantId, role: 'AGENT', roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, tenantId);
  });
  await app.register(contactRoutes, { prefix: '/api/v1/contacts' });
  await app.ready();
  return app;
}

const viewer = await createRole('viewer', ['contact.view', 'inbox.view']);
const viewOnly = await createRole('view-only', ['contact.view']);
const mkChannel = (name: string, channelType: 'LINE' | 'FB') =>
  prisma.channel.create({
    data: { tenantId: T, channelType, displayName: `CI 跨渠道 ${name} ${stamp}`, credentialsEncrypted: 'x' },
  });
const lineCh = await mkChannel('LINE', 'LINE');
const fbCh = await mkChannel('FB', 'FB');
const agent = await prisma.agent.create({
  data: { tenantId: T, email: `ci-msg-${stamp}@example.test`, name: 'CI 跨渠道', passwordHash: 'x', roleId: viewer.id },
});
const branch = await prisma.agent.create({
  data: { tenantId: T, email: `ci-msg-branch-${stamp}@example.test`, name: 'CI 分店', passwordHash: 'x', roleId: viewer.id },
});
await prisma.agentChannelAccess.createMany({
  data: [
    { agentId: agent.id, channelId: lineCh.id, accessLevel: 'full' },
    { agentId: agent.id, channelId: fbCh.id, accessLevel: 'full' },
    { agentId: branch.id, channelId: lineCh.id, accessLevel: 'full' },
  ],
});
const contact = await prisma.contact.create({ data: { tenantId: T, displayName: `CI 跨渠道聯絡人 ${stamp}` } });
const lineConv = await prisma.conversation.create({ data: { tenantId: T, contactId: contact.id, channelId: lineCh.id, channelType: 'LINE' } });
const fbConv = await prisma.conversation.create({ data: { tenantId: T, contactId: contact.id, channelId: fbCh.id, channelType: 'FB' } });
const base = Date.now() - 60_000;
const msg = (conversationId: string, text: string, offset: number, direction: 'INBOUND' | 'OUTBOUND' = 'INBOUND') =>
  prisma.message.create({
    data: {
      conversationId,
      direction,
      senderType: direction === 'INBOUND' ? 'CONTACT' : 'AGENT',
      contentType: 'text',
      content: { text },
      createdAt: new Date(base + offset * 1000),
    },
  });
await msg(lineConv.id, 'LINE 第一則', 1);
await msg(fbConv.id, 'FB 第一則', 2);
await msg(lineConv.id, 'LINE 客服回覆', 3, 'OUTBOUND');
await msg(fbConv.id, 'FB 第二則', 4);

const fullApp = await buildApp(viewer.id, agent.id);
const branchApp = await buildApp(viewer.id, branch.id);
const viewOnlyApp = await buildApp(viewOnly.id, agent.id);
const otherTenantApp = await buildApp(viewer.id, agent.id, TENANT_B);

type Row = { id: string; channelType: string; direction: string; content: { text: string } };
const get = async (app: typeof fullApp, query = '') =>
  app.inject({ method: 'GET', url: `/api/v1/contacts/${contact.id}/messages${query}` });

afterAll(async () => {
  for (const app of [fullApp, branchApp, viewOnlyApp, otherTenantApp]) await app.close().catch(() => {});
  await prisma.message.deleteMany({ where: { conversationId: { in: [lineConv.id, fbConv.id] } } });
  await prisma.conversation.deleteMany({ where: { id: { in: [lineConv.id, fbConv.id] } } });
  await prisma.contact.deleteMany({ where: { id: contact.id } });
  await prisma.agentChannelAccess.deleteMany({ where: { agentId: { in: [agent.id, branch.id] } } });
  await prisma.agent.deleteMany({ where: { id: { in: [agent.id, branch.id] } } });
  await prisma.channel.deleteMany({ where: { id: { in: [lineCh.id, fbCh.id] } } });
  await prisma.role.deleteMany({ where: { id: { in: [viewer.id, viewOnly.id] } } });
  await prisma.$disconnect();
});

test('合併後的時間軸', async () => {
  const res = await get(fullApp);
  assert.equal(res.statusCode, 200, res.body);
  const rows = res.json().data.messages as Row[];
  assert.deepEqual(
    rows.map((r) => [r.channelType, r.content.text]),
    [
      ['LINE', 'LINE 第一則'],
      ['FB', 'FB 第一則'],
      ['LINE', 'LINE 客服回覆'],
      ['FB', 'FB 第二則'],
    ],
    '依時間交錯排列，最新的在最後',
  );
  assert.equal(rows[2].direction, 'OUTBOUND');
  assert.equal(res.json().data.hiddenConversationCount, 0);
});

test('載入更早的訊息', async () => {
  const first = (await get(fullApp, '?limit=3')).json().data;
  assert.deepEqual((first.messages as Row[]).map((r) => r.content.text), ['FB 第一則', 'LINE 客服回覆', 'FB 第二則']);
  assert.ok(first.nextCursor, '還有更早的訊息');
  const second = (await get(fullApp, `?limit=3&before=${encodeURIComponent(first.nextCursor)}`)).json().data;
  assert.deepEqual((second.messages as Row[]).map((r) => r.content.text), ['LINE 第一則'], '不重複已顯示的訊息');
  assert.equal(second.nextCursor, null);
});

test('分店帳號', async () => {
  const res = await get(branchApp);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual((res.json().data.messages as Row[]).map((r) => r.content.text), ['LINE 第一則', 'LINE 客服回覆']);
  assert.equal(res.json().data.hiddenConversationCount, 1);
  assert.ok(!res.body.includes('FB 第') && !res.body.includes(`CI 跨渠道 FB ${stamp}`), '不回傳看不到渠道的訊息或名稱');
});

test('其他租戶的聯絡人', async () => {
  assert.equal((await get(otherTenantApp)).statusCode, 404);
});

test('缺少權限', async () => {
  assert.equal((await get(viewOnlyApp)).statusCode, 403, '缺 inbox.view');
});
