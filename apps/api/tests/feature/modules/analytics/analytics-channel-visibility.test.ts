/**
 * 報表只統計可見渠道（change extend-channel-visibility-to-contacts-and-marketing，
 * 規格 channel-scoped-visibility「報表只統計可見渠道」）。
 *
 * 專用租戶：CH-A（LINE）3 則訊息、2 張新工單；CH-B（FB）5 則訊息、4 張新工單。
 * 分店只綁 CH-A；總店有 channel.view_all。報表頁、CLI 與 MCP 都要得到同樣的數字。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import analyticsRoutes from '#src/modules/analytics/analytics.routes.js';
import cliRoutes from '#src/modules/cli/cli.routes.js';
import mcpRoutes from '#src/modules/mcp/mcp.routes.js';
import { CLI_ANALYTICS_READ_SCOPE } from '#src/modules/auth/cli-session.service.js';
import { MCP_READ_SCOPE } from '#src/modules/mcp/mcp.constants.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-analytics-vis-${Date.now()}`;
const DAY = new Date('2002-05-11T06:00:00.000Z');
const RANGE = 'from=2002-05-10T00:00:00.000Z&to=2002-05-12T23:59:59.999Z';
const RANGE_BODY = { from: '2002-05-10T00:00:00.000Z', to: '2002-05-12T23:59:59.999Z' };

const tenant = await owner.tenant.create({ data: { name: MARK } });
const T = tenant.id;
const REPORT_PERMISSIONS = ['analytics.view', 'analytics.view.self', 'analytics.export'];
const mkRole = (slug: string, permissions: string[]) =>
  owner.role.create({
    data: { tenantId: T, slug: `${MARK}-${slug}`, name: slug, permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) } },
  });
const branchRole = await mkRole('branch', REPORT_PERMISSIONS);
const hqRole = await mkRole('hq', [...REPORT_PERMISSIONS, 'channel.view_all']);
const mkAgent = (slug: string, roleId: string) =>
  owner.agent.create({ data: { tenantId: T, roleId, name: slug, email: `${MARK}-${slug}@example.test`, passwordHash: 'x' } });
const branch = await mkAgent('branch', branchRole.id);
const other = await mkAgent('other', branchRole.id);
const hq = await mkAgent('hq', hqRole.id);

const mkChannel = (channelType: 'LINE' | 'FB', key: string) =>
  owner.channel.create({ data: { tenantId: T, channelType, displayName: `${MARK}-${key}`, credentialsEncrypted: 'x' } });
const chA = await mkChannel('LINE', 'a');
const chB = await mkChannel('FB', 'b');
await owner.agentChannelAccess.create({ data: { agentId: branch.id, channelId: chA.id, accessLevel: 'full' } });
await owner.agentChannelAccess.create({ data: { agentId: other.id, channelId: chB.id, accessLevel: 'full' } });
// 同分店、期間內沒有工單的客服
const idle = await mkAgent('idle', branchRole.id);
await owner.agentChannelAccess.create({ data: { agentId: idle.id, channelId: chA.id, accessLevel: 'full' } });

const contactByChannel = new Map<string, string>();
for (const [ch, messages, cases] of [[chA, 3, 2], [chB, 5, 4]] as const) {
  const contact = await owner.contact.create({ data: { tenantId: T, displayName: `${MARK}-${ch.channelType}`, createdAt: DAY } });
  await owner.channelIdentity.create({
    data: { contactId: contact.id, channelId: ch.id, channelType: ch.channelType, uid: `${MARK}-${ch.id}`, linkedAt: DAY },
  });
  contactByChannel.set(ch.id, contact.id);
  const conv = await owner.conversation.create({
    data: { tenantId: T, contactId: contact.id, channelId: ch.id, channelType: ch.channelType, createdAt: DAY },
  });
  for (let i = 0; i < messages; i += 1) {
    await owner.message.create({
      data: { conversationId: conv.id, direction: 'INBOUND', senderType: 'CONTACT', contentType: 'text', content: { text: `${i}` }, createdAt: DAY },
    });
  }
  for (let i = 0; i < cases; i += 1) {
    await owner.case.create({
      data: { tenantId: T, contactId: contact.id, channelId: ch.id, title: `${MARK}-${ch.channelType}-${i}`, createdAt: DAY, assigneeId: ch.id === chA.id ? branch.id : other.id },
    });
  }
}

// 期間內建立、後來併入 CH-A 聯絡人的 SA，與併入 CH-B 聯絡人的 SB：依保留方判斷（與單筆讀取一致）
for (const [label, ch] of [['SA', chA], ['SB', chB]] as const) {
  await owner.contact.create({
    data: { tenantId: T, displayName: `${MARK}-${label}`, createdAt: DAY, isArchived: true, mergedIntoId: contactByChannel.get(ch.id) },
  });
}

const cliSession = (scopes: string[]) => ({
  id: '44444444-4444-4444-8444-444444444444',
  name: 'CI analytics visibility',
  scopes,
  expiresAt: new Date(Date.now() + 60_000),
  lastUsedAt: null,
  tokenPrefix: 'cli_ci',
  tokenSuffix: 'ci',
});

async function buildApp(agent: { id: string; roleId: string }) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', tenantDb);
  app.decorate('prismaAdmin', owner);
  app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
  const setAgent = (request: FastifyRequest, scopes?: string[]) => {
    request.agent = {
      id: agent.id,
      tenantId: T,
      role: 'AGENT',
      roleId: agent.roleId,
      ...(scopes ? { isCliSession: true, cliSession: cliSession(scopes) } : {}),
    } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, T);
  };
  app.decorate('authenticate', async (request: FastifyRequest) => setAgent(request));
  app.decorate('authenticateCliSession', async (request: FastifyRequest) => setAgent(request, [CLI_ANALYTICS_READ_SCOPE]));
  app.decorate('authenticateJwtOrCliSession', async (request: FastifyRequest) => setAgent(request, [MCP_READ_SCOPE]));
  await app.register(analyticsRoutes, { prefix: '/api/v1/analytics' });
  await app.register(cliRoutes, { prefix: '/api/v1/cli' });
  await app.register(mcpRoutes);
  await app.listen({ host: '127.0.0.1', port: 0 });
  return app;
}
const branchApp = await buildApp({ id: branch.id, roleId: branchRole.id });
const hqApp = await buildApp({ id: hq.id, roleId: hqRole.id });
type App = typeof branchApp;

afterAll(async () => {
  await Promise.all([branchApp.close(), hqApp.close()]);
  await owner.case.deleteMany({ where: { tenantId: T } });
  await owner.message.deleteMany({ where: { conversation: { tenantId: T } } });
  await owner.conversation.deleteMany({ where: { tenantId: T } });
  await owner.channelIdentity.deleteMany({ where: { contact: { tenantId: T } } });
  await owner.contact.deleteMany({ where: { tenantId: T } });
  await owner.agentChannelAccess.deleteMany({ where: { agent: { tenantId: T } } });
  await owner.channel.deleteMany({ where: { tenantId: T } });
  await owner.agent.deleteMany({ where: { tenantId: T } });
  await owner.role.deleteMany({ where: { tenantId: T } });
  await owner.tenant.delete({ where: { id: T } });
  await Promise.all([owner.$disconnect(), tenantDb.$disconnect()]);
});

async function get(app: App, url: string) {
  const res = await app.inject({ method: 'GET', url });
  assert.equal(res.statusCode, 200, `${url}：${res.body}`);
  return res.json().data;
}
const report = (app: App, path: string) => get(app, `/api/v1/analytics/${path}?${RANGE}`);

async function callTool(app: App, name: string, args: Record<string, unknown>) {
  const address = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const res = await fetch(`${address}/mcp`, {
    method: 'POST',
    headers: { authorization: 'Bearer cli_ci', accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { result: { isError?: boolean; content: Array<{ text: string }> } };
  assert.equal(body.result.isError ?? false, false, body.result.content[0]?.text);
  return JSON.parse(body.result.content[0].text);
}

test('總覽只算可見渠道：分店的訊息數 3、新工單 2；CLI 與 MCP 相同', async () => {
  const overview = await report(branchApp, 'overview');
  assert.equal(overview.totalMessages, 3);
  assert.equal(overview.newCases, 2);
  assert.deepEqual(await get(branchApp, `/api/v1/cli/analytics/overview?${RANGE}`), overview);
  assert.deepEqual(await callTool(branchApp, 'crm_get_analytics_overview', RANGE_BODY), overview);
});

test('渠道報表不列出不可見渠道：分店的訊息、對話、新聯絡人分布都不含 FB', async () => {
  const channels = await report(branchApp, 'channels');
  for (const key of ['messagesByChannel', 'conversationsByChannel', 'newContactsByChannel'] as const) {
    const names = (channels[key] as Array<{ name: string }>).map((r) => r.name);
    assert.deepEqual(names, ['LINE'], `${key} 只含 LINE`);
  }
  const trend = await report(branchApp, 'message-trend');
  assert.equal(trend.reduce((sum: number, r: { FB: number }) => sum + r.FB, 0), 0, '訊息趨勢不含 FB');
});

test('渠道報表不列出不可見渠道：工單、聯絡人、客服績效與匯出只算可見渠道', async () => {
  const cases = await report(branchApp, 'cases');
  assert.equal(cases.trend.reduce((sum: number, r: { opened: number }) => sum + r.opened, 0), 2);
  const contacts = await report(branchApp, 'contacts');
  assert.equal(contacts.totalNewContacts, 2, 'CH-A 的聯絡人與併入它的 SA');
  assert.equal(contacts.newContactsTrend.reduce((sum: number, r: { count: number }) => sum + r.count, 0), 2);
  assert.equal(contacts.activeContacts, 1);
  const agents = (await report(branchApp, 'agents')) as Array<{ agentId: string; casesHandled: number }>;
  assert.equal(agents.find((a) => a.agentId === branch.id)?.casesHandled, 2);

  const res = await branchApp.inject({ method: 'POST', url: '/api/v1/analytics/export', payload: { reportType: 'cases', ...RANGE_BODY } });
  assert.equal(res.statusCode, 200, res.body);
  const lines = res.body.slice(1).split('\n');
  assert.equal(lines.length, 1 + 2, '標題列加 2 張可見渠道的工單');
  assert.ok(!res.body.includes(`${MARK}-FB`), '匯出不可含不可見渠道的工單');
});

test('總店看全部：訊息數 8、新工單 6，渠道分布含 LINE 與 FB', async () => {
  const overview = await report(hqApp, 'overview');
  assert.equal(overview.totalMessages, 8);
  assert.equal(overview.newCases, 6);
  const names = ((await report(hqApp, 'channels')).messagesByChannel as Array<{ name: string }>).map((r) => r.name).sort();
  assert.deepEqual(names, ['FB', 'LINE']);
});

test('客服績效不列出其他分店的客服：只處理 CH-B 工單的客服不在報表與匯出中', async () => {
  const agents = (await report(branchApp, 'agents')) as Array<{ agentId: string; casesHandled: number }>;
  assert.deepEqual(agents.map((a) => a.agentId).sort(), [branch.id, idle.id].sort());
  const res = await branchApp.inject({ method: 'POST', url: '/api/v1/analytics/export', payload: { reportType: 'agents', ...RANGE_BODY } });
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(!res.body.includes(other.id), '匯出不可含其他分店的客服');

  const hqAgents = (await report(hqApp, 'agents')) as Array<{ agentId: string }>;
  assert.ok(hqAgents.some((a) => a.agentId === other.id), '總店看得到所有客服');
});

test('同分店沒有工單的客服照常列出：處理數是 0，指定 agentId 也查得到', async () => {
  const agents = (await report(branchApp, 'agents')) as Array<{ agentId: string; casesHandled: number }>;
  assert.equal(agents.find((a) => a.agentId === idle.id)?.casesHandled, 0);
  const one = (await get(branchApp, `/api/v1/analytics/agents?${RANGE}&agentId=${idle.id}`)) as Array<{ agentId: string }>;
  assert.deepEqual(one.map((a) => a.agentId), [idle.id]);
});
