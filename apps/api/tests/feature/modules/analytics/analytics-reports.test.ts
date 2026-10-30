/**
 * 分析報表的數字（#337 階段 3 第七批 analytics 搬遷前的回歸測試）。
 *
 * 搬遷前後都要通過：報表頁、CLI、MCP 與每日彙總用同一份資料算出同樣的數字。
 * 租戶路由走真實的 requirePermission 與 app_tenant 連線（RLS）。
 * 每次執行建立兩個專用租戶，結束時整個刪除。主要資料放在 2001-03-11、2001-03-12（UTC），
 * 不受其他測試的資料影響。
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
import { runDailyAggregation } from '#src/modules/analytics/analytics.aggregator.js';
import { inTenant } from '#src/lib/tenant-ctx.js';
import { CLI_ANALYTICS_READ_SCOPE } from '#src/modules/auth/cli-session.service.js';
import { MCP_READ_SCOPE } from '#src/modules/mcp/mcp.constants.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-analytics-${Date.now()}`;

const at = (iso: string) => new Date(iso);
const minutesAfter = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
const D11 = at('2001-03-11T06:00:00.000Z');
const D12 = at('2001-03-12T06:00:00.000Z');
const RANGE = 'from=2001-03-10T00:00:00.000Z&to=2001-03-12T23:59:59.999Z';
const RANGE_BODY = { from: '2001-03-10T00:00:00.000Z', to: '2001-03-12T23:59:59.999Z' };

const tenantA = await owner.tenant.create({ data: { name: `${MARK}-a` } });
const tenantB = await owner.tenant.create({ data: { name: `${MARK}-b` } });
const A = tenantA.id;
const B = tenantB.id;

async function makeRole(tenantId: string) {
  return owner.role.create({
    data: {
      tenantId,
      slug: `${MARK}-analyst`,
      name: 'analyst',
      permissions: {
        create: ['analytics.view', 'analytics.view.self', 'analytics.export'].map((permissionCode) => ({ permissionCode })),
      },
    },
  });
}
const roleA = await makeRole(A);
const roleB = await makeRole(B);
const makeAgent = (tenantId: string, roleId: string, name: string, isActive = true) =>
  owner.agent.create({
    data: { tenantId, roleId, name, isActive, email: `${MARK}-${name}@example.test`, passwordHash: 'x' },
  });
const mgr = await makeAgent(A, roleA.id, '主管甲');
const agent2 = await makeAgent(A, roleA.id, '客服乙');
await makeAgent(A, roleA.id, '離職丙', false);
const agentB = await makeAgent(B, roleB.id, '他租戶客服');

const makeChannel = (tenantId: string, channelType: 'LINE' | 'FB', key: string) =>
  owner.channel.create({
    data: { tenantId, channelType, displayName: `${MARK}-${key}`, credentialsEncrypted: 'x', externalAccountId: `${MARK}-${key}` },
  });
const lineA = await makeChannel(A, 'LINE', 'a-line');
const fbA = await makeChannel(A, 'FB', 'a-fb');
const lineB = await makeChannel(B, 'LINE', 'b-line');

// ── 租戶 A ──
const c1 = await owner.contact.create({ data: { tenantId: A, displayName: '客人一', createdAt: D11 } });
const c2 = await owner.contact.create({ data: { tenantId: A, displayName: '客人二', createdAt: D12 } });
await owner.contact.create({ data: { tenantId: A, displayName: '客人三（區間外）' } });
await owner.channelIdentity.create({ data: { contactId: c1.id, channelId: lineA.id, channelType: 'LINE', uid: `${MARK}-u1`, linkedAt: D11 } });
await owner.channelIdentity.create({ data: { contactId: c2.id, channelId: fbA.id, channelType: 'FB', uid: `${MARK}-u2`, linkedAt: D12 } });
const vip = await owner.tag.create({ data: { tenantId: A, name: 'VIP' } });
const fresh = await owner.tag.create({ data: { tenantId: A, name: '新客' } });
await owner.contactTag.createMany({
  data: [
    { contactId: c1.id, tagId: vip.id },
    { contactId: c2.id, tagId: vip.id },
    { contactId: c1.id, tagId: fresh.id },
  ],
});

const conv1 = await owner.conversation.create({
  data: { tenantId: A, contactId: c1.id, channelId: lineA.id, channelType: 'LINE', status: 'AGENT_HANDLED', createdAt: D11 },
});
const conv2 = await owner.conversation.create({
  data: { tenantId: A, contactId: c2.id, channelId: fbA.id, channelType: 'FB', status: 'BOT_HANDLED', createdAt: D12 },
});
const conv3 = await owner.conversation.create({
  data: { tenantId: A, contactId: c1.id, channelId: lineA.id, channelType: 'LINE', createdAt: minutesAfter(D11, 60) },
});
const message = (conversationId: string, direction: 'INBOUND' | 'OUTBOUND', createdAt: Date) => ({
  conversationId,
  direction,
  createdAt,
  senderType: direction === 'INBOUND' ? ('CONTACT' as const) : ('AGENT' as const),
  contentType: 'text',
  content: { text: 'hi' },
});
await owner.message.createMany({
  data: [
    message(conv1.id, 'INBOUND', minutesAfter(D11, 1)),
    message(conv1.id, 'INBOUND', minutesAfter(D11, 2)),
    message(conv1.id, 'OUTBOUND', minutesAfter(D11, 3)),
    message(conv3.id, 'OUTBOUND', minutesAfter(D11, 61)),
    message(conv2.id, 'INBOUND', minutesAfter(D12, 1)),
    message(conv2.id, 'INBOUND', at('2001-03-20T06:00:00.000Z')), // 區間外
  ],
});

const caseBase = { tenantId: A, contactId: c1.id, channelId: lineA.id };
const k1 = await owner.case.create({
  data: {
    ...caseBase,
    title: '退款 "急件"',
    assigneeId: mgr.id,
    status: 'RESOLVED',
    priority: 'HIGH',
    category: '帳務',
    createdAt: D11,
    firstResponseAt: minutesAfter(D11, 10),
    resolvedAt: minutesAfter(D11, 60),
    slaDueAt: minutesAfter(D11, 120),
    csatSentAt: minutesAfter(D11, 120),
    csatScore: 5,
  },
});
const k2 = await owner.case.create({
  data: {
    ...caseBase,
    title: '帳單錯誤',
    assigneeId: mgr.id,
    status: 'CLOSED',
    priority: 'MEDIUM',
    category: '帳務',
    createdAt: minutesAfter(D11, 10),
    firstResponseAt: minutesAfter(D11, 40),
    resolvedAt: minutesAfter(D11, 250),
    slaDueAt: minutesAfter(D11, 130),
    csatSentAt: minutesAfter(D11, 300),
    csatScore: 2,
  },
});
const k3 = await owner.case.create({
  data: {
    ...caseBase,
    contactId: c2.id,
    channelId: fbA.id,
    title: '升級處理',
    assigneeId: agent2.id,
    status: 'ESCALATED',
    priority: 'URGENT',
    createdAt: D12,
    csatSentAt: minutesAfter(D12, 120),
  },
});
const k4 = await owner.case.create({
  data: {
    ...caseBase,
    contactId: c2.id,
    title: '未指派',
    status: 'OPEN',
    priority: 'LOW',
    createdAt: minutesAfter(D12, 30),
    slaDueAt: at('2001-03-13T00:00:00.000Z'),
  },
});
// 本月的工單：個人數據只看本月。SLA 在 10 分鐘後到期，算「即將逾期」
const now = new Date();
await owner.case.create({
  data: { ...caseBase, title: '本月處理中', assigneeId: mgr.id, status: 'IN_PROGRESS', createdAt: now, slaDueAt: minutesAfter(now, 10) },
});

// ── 租戶 B：同一段期間也有資料，A 的報表不能算進來 ──
const cb = await owner.contact.create({ data: { tenantId: B, displayName: '他租戶客人', createdAt: D11 } });
const tagB = await owner.tag.create({ data: { tenantId: B, name: 'VIP' } });
await owner.contactTag.create({ data: { contactId: cb.id, tagId: tagB.id } });
const convB = await owner.conversation.create({
  data: { tenantId: B, contactId: cb.id, channelId: lineB.id, channelType: 'LINE', status: 'AGENT_HANDLED', createdAt: D11 },
});
await owner.message.createMany({
  data: [message(convB.id, 'INBOUND', minutesAfter(D11, 5)), message(convB.id, 'OUTBOUND', minutesAfter(D11, 6))],
});
await owner.case.create({
  data: { tenantId: B, contactId: cb.id, channelId: lineB.id, title: '他租戶工單', assigneeId: agentB.id, status: 'OPEN', createdAt: D11, csatSentAt: D11, csatScore: 1 },
});

type AgentFixture = { id: string; tenantId: string; roleId: string };
const cliSession = (scopes: string[]) => ({
  id: '33333333-3333-4333-8333-333333333333',
  name: 'CI analytics',
  scopes,
  expiresAt: new Date(Date.now() + 60_000),
  lastUsedAt: null,
  tokenPrefix: 'cli_ci',
  tokenSuffix: 'ci',
});

async function buildApp(agent: AgentFixture) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', tenantDb);
  app.decorate('prismaAdmin', owner);
  app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
  const setAgent = (request: FastifyRequest, scopes?: string[]) => {
    request.agent = {
      id: agent.id,
      tenantId: agent.tenantId,
      role: 'ADMIN',
      roleId: agent.roleId,
      ...(scopes ? { isCliSession: true, cliSession: cliSession(scopes) } : {}),
    } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, agent.tenantId);
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

const appA = await buildApp({ id: mgr.id, tenantId: A, roleId: roleA.id });
const appB = await buildApp({ id: agentB.id, tenantId: B, roleId: roleB.id });
type App = typeof appA;

afterAll(async () => {
  await Promise.all([appA.close(), appB.close()]);
  for (const tenantId of [A, B]) {
    await owner.dailyStat.deleteMany({ where: { tenantId } });
    await owner.case.deleteMany({ where: { tenantId } });
    await owner.message.deleteMany({ where: { conversation: { tenantId } } });
    await owner.conversation.deleteMany({ where: { tenantId } });
    await owner.contactTag.deleteMany({ where: { tag: { tenantId } } });
    await owner.tag.deleteMany({ where: { tenantId } });
    await owner.channelIdentity.deleteMany({ where: { contact: { tenantId } } });
    await owner.contact.deleteMany({ where: { tenantId } });
    await owner.channel.deleteMany({ where: { tenantId } });
    await owner.agent.deleteMany({ where: { tenantId } });
    await owner.role.deleteMany({ where: { tenantId } });
    await owner.tenant.delete({ where: { id: tenantId } });
  }
  await Promise.all([owner.$disconnect(), tenantDb.$disconnect()]);
});

async function get(app: App, url: string) {
  const res = await app.inject({ method: 'GET', url });
  assert.equal(res.statusCode, 200, `${url}：${res.body}`);
  return res.json().data;
}
const report = (app: App, path: string, query = RANGE) => get(app, `/api/v1/analytics/${path}${path.includes('?') ? '&' : '?'}${query}`);
const byName = (rows: Array<{ name: string; value: number }>) => Object.fromEntries(rows.map((r) => [r.name, r.value]));

async function exportCsv(app: App, reportType: string) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/analytics/export', payload: { reportType, ...RANGE_BODY } });
  assert.equal(res.statusCode, 200, res.body);
  assert.match(String(res.headers['content-type']), /^text\/csv/);
  assert.equal(res.headers['content-disposition'], `attachment; filename="${reportType}_report.csv"`);
  assert.ok(res.body.startsWith('﻿'), 'CSV 以 BOM 開頭');
  return res.body.slice(1).split('\n');
}

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

const OVERVIEW_A = {
  totalMessages: 5,
  inboundMessages: 3,
  outboundMessages: 2,
  openCases: 3,
  newCases: 4,
  resolvedCases: 2,
  slaAchievementRate: 50,
  avgFirstResponseMinutes: 20,
  avgResolutionMinutes: 150,
  csatAvg: 3.5,
  csatPositiveRate: 50,
};

test('總覽：只算本租戶，訊息與新工單依區間，未結工單不看區間', async () => {
  assert.deepEqual(await report(appA, 'overview'), OVERVIEW_A);
  const b = await report(appB, 'overview');
  assert.equal(b.totalMessages, 2);
  assert.equal(b.openCases, 1);
});

test('訊息趨勢：依日期與渠道分組；週分組合併成一筆', async () => {
  assert.deepEqual(await report(appA, 'message-trend'), [
    { date: '2001-03-11', LINE: 4, FB: 0, WEBCHAT: 0, WHATSAPP: 0, total: 4 },
    { date: '2001-03-12', LINE: 0, FB: 1, WEBCHAT: 0, WHATSAPP: 0, total: 1 },
  ]);
  const weekly = await report(appA, 'message-trend?groupBy=week');
  assert.equal(weekly.length, 2, '2001-03-11 是星期日，與 03-12 分屬兩週');
  assert.deepEqual(weekly.map((w: { total: number }) => w.total), [4, 1]);
});

test('工單統計：趨勢、分類、優先、狀態、升級率；SLA 逾期清單不看區間', async () => {
  const data = await report(appA, 'cases');
  assert.deepEqual(data.trend, [
    { date: '2001-03-11', opened: 2, closed: 2 },
    { date: '2001-03-12', opened: 2, closed: 0 },
  ]);
  assert.deepEqual(byName(data.categoryDistribution), { 帳務: 2, 未分類: 2 });
  assert.deepEqual(byName(data.priorityDistribution), { HIGH: 1, MEDIUM: 1, URGENT: 1, LOW: 1 });
  assert.deepEqual(byName(data.statusDistribution), { RESOLVED: 1, CLOSED: 1, ESCALATED: 1, OPEN: 1 });
  assert.equal(data.escalationRate, 25);
  assert.deepEqual(data.slaViolations.map((c: { id: string }) => c.id), [k4.id]);
  assert.equal(data.slaViolations[0].contact.displayName, '客人二');
});

test('客服績效：列出啟用中的客服，依處理數排序；可指定單一客服', async () => {
  const rows = await report(appA, 'agents');
  assert.deepEqual(rows, [
    {
      agentId: mgr.id,
      name: '主管甲',
      role: 'AGENT',
      casesHandled: 2,
      casesResolved: 2,
      avgFirstResponseMinutes: 20,
      avgResolutionMinutes: 150,
      csatAvg: 3.5,
      slaAchievementRate: 50,
    },
    {
      agentId: agent2.id,
      name: '客服乙',
      role: 'AGENT',
      casesHandled: 1,
      casesResolved: 0,
      avgFirstResponseMinutes: null,
      avgResolutionMinutes: null,
      csatAvg: null,
      slaAchievementRate: null,
    },
  ]);
  const one = await report(appA, `agents?agentId=${agent2.id}`);
  assert.deepEqual(one.map((r: { agentId: string }) => r.agentId), [agent2.id]);
});

test('渠道分析：訊息、對話、Bot 與人工、新聯絡人依渠道分組', async () => {
  const data = await report(appA, 'channels');
  assert.deepEqual(byName(data.messagesByChannel), { LINE: 4, FB: 1 });
  assert.deepEqual(byName(data.conversationsByChannel), { LINE: 2, FB: 1 });
  assert.deepEqual(byName(data.botVsHuman), { 人工處理: 1, 'Bot 處理': 1 });
  assert.deepEqual(byName(data.newContactsByChannel), { LINE: 1, FB: 1 });
});

test('聯絡人分析：新聯絡人依區間；熱門標籤不看區間，只算本租戶', async () => {
  const data = await report(appA, 'contacts');
  assert.deepEqual(data.newContactsTrend, [
    { date: '2001-03-11', count: 1 },
    { date: '2001-03-12', count: 1 },
  ]);
  assert.equal(data.activeContacts, 2);
  assert.equal(data.totalNewContacts, 2);
  assert.deepEqual(data.topTags, [
    { name: 'VIP', value: 2 },
    { name: '新客', value: 1 },
  ]);
});

test('個人數據：本月處理的工單、待處理數與 30 分鐘內到期的 SLA', async () => {
  const data = await get(appA, '/api/v1/analytics/my');
  assert.equal(data.agentId, mgr.id);
  assert.equal(data.casesHandled, 1);
  assert.equal(data.casesResolved, 0);
  assert.equal(data.pendingCases, 1);
  assert.equal(data.slaSoonExpiring, 1);
});

test('CSAT 報表：依送出問卷的時間；回覆率、平均分數、滿意率與低分工單', async () => {
  assert.deepEqual(await report(appA, 'csat'), {
    totalSent: 3,
    totalResponded: 2,
    responseRate: 0.67,
    avgScore: 3.5,
    csatRate: 0.5,
    lowScoreCount: 1,
    lowScoreCases: [{ id: k2.id, title: '帳單錯誤', score: 2 }],
  });
});

test('匯出 CSV：總覽、工單、客服與渠道', async () => {
  assert.deepEqual(await exportCsv(appA, 'overview'), [Object.keys(OVERVIEW_A).join(','), Object.values(OVERVIEW_A).join(',')]);

  const cases = await exportCsv(appA, 'cases');
  assert.equal(cases[0], 'ID,標題,狀態,優先級,分類,指派客服,聯絡人,建立時間,解決時間,CSAT');
  assert.deepEqual(cases.slice(1).map((line) => line.split(',')[0]), [k4.id, k3.id, k2.id, k1.id], '依建立時間由新到舊');
  assert.equal(
    cases[4],
    [k1.id, '"退款 ""急件"""', 'RESOLVED', 'HIGH', '帳務', '主管甲', '客人一', D11.toISOString(), minutesAfter(D11, 60).toISOString(), 5].join(','),
  );

  const agents = await exportCsv(appA, 'agents');
  assert.deepEqual(agents.slice(1), [`${mgr.id},主管甲,AGENT,2,2,20,150,3.5,50`, `${agent2.id},客服乙,AGENT,1,0,,,,`]);

  const channels = await exportCsv(appA, 'channels');
  assert.equal(channels[0], '渠道,訊息數,對話數');
  assert.deepEqual(channels.slice(1).sort(), ['FB,1,1', 'LINE,4,2']);
});

test('CLI 報表：與報表頁同一份計算，只限本租戶；工單統計只回逾期數', async () => {
  assert.deepEqual(await get(appA, `/api/v1/cli/analytics/overview?${RANGE}`), OVERVIEW_A);
  assert.deepEqual(await get(appA, `/api/v1/cli/analytics/message-trend?${RANGE}`), await report(appA, 'message-trend'));
  assert.deepEqual(await get(appA, `/api/v1/cli/analytics/channels?${RANGE}`), await report(appA, 'channels'));

  const cases = await get(appA, `/api/v1/cli/analytics/cases?${RANGE}`);
  const { slaViolations, ...rest } = await report(appA, 'cases');
  assert.deepEqual(cases, { ...rest, slaViolationCount: slaViolations.length });

  const my = await get(appA, '/api/v1/cli/analytics/my');
  assert.equal(my.casesHandled, 1);
  assert.equal(my.pendingCases, 1);

  assert.equal((await get(appB, `/api/v1/cli/analytics/overview?${RANGE}`)).totalMessages, 2);
});

test('CLI 報表的日期區間：from 晚於 to 回 400 並指出 from（主規格 analytics-reports）', async () => {
  for (const path of ['overview', 'message-trend', 'cases', 'channels']) {
    const res = await appA.inject({ method: 'GET', url: `/api/v1/cli/analytics/${path}?from=2026-12-31&to=2020-01-01` });
    assert.equal(res.statusCode, 400, `${path}：${res.body}`);
    const paths = (res.json().error?.details?.issues ?? []).map((i: { path: string }) => i.path);
    assert.ok(paths.includes('from'), `${path} 應指出 from`);
  }
});

test('MCP 工具：總覽與工單統計，只限本租戶', async () => {
  assert.deepEqual(await callTool(appA, 'crm_get_analytics_overview', RANGE_BODY), OVERVIEW_A);
  const cases = await callTool(appA, 'crm_get_case_statistics', RANGE_BODY);
  assert.deepEqual(cases.trend, [
    { date: '2001-03-11', opened: 2, closed: 2 },
    { date: '2001-03-12', opened: 2, closed: 0 },
  ]);
  assert.equal(cases.escalationRate, 25);
  assert.equal((await callTool(appB, 'crm_get_analytics_overview', RANGE_BODY)).totalMessages, 2);
});

test('每日彙總：把一天的總覽、工單、客服、渠道與聯絡人寫入 DailyStat，只算本租戶', async () => {
  // 以行程時區的 2001-03-11 中午為準：UTC 與台灣時間的這一天都涵蓋 03-11 06:00～07:01Z 的資料，不涵蓋 03-12
  await inTenant(tenantDb, A, (scope) => runDailyAggregation(scope, new Date(2001, 2, 11, 12)));

  const rows = await owner.dailyStat.findMany({ where: { tenantId: A } });
  const data = (statType: string, dimensionId = '') =>
    rows.find((r) => r.statType === statType && r.dimensionId === dimensionId)?.data as Record<string, unknown>;
  assert.deepEqual(rows.map((r) => `${r.statType}:${r.dimensionId}`).sort(), [
    `agent:${agent2.id}`,
    `agent:${mgr.id}`,
    'case:',
    'channel:',
    'contact:',
    'overview:',
  ].sort());

  const overview = data('overview');
  assert.equal(overview.totalMessages, 4);
  assert.equal(overview.newCases, 2);
  assert.equal(overview.openCases, 3);
  assert.equal(data('agent', mgr.id).casesHandled, 2);
  assert.equal(data('agent', agent2.id).casesHandled, 0);
  assert.equal(data('contact').totalNewContacts, 1);
  // 他租戶也有 VIP 標籤：每日彙總若不限租戶，VIP 會變成 3
  assert.deepEqual(data('contact').topTags, [
    { name: 'VIP', value: 2 },
    { name: '新客', value: 1 },
  ]);
  assert.deepEqual(data('case').trend, [{ date: '2001-03-11', opened: 2, closed: 2 }]);

  assert.equal(await owner.dailyStat.count({ where: { tenantId: B } }), 0);
});
