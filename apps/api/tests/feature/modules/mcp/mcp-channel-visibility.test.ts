/**
 * MCP 工具的渠道級可見性（CM-173）整合測試：走正式的 requestChannelAccess 與真實資料庫。
 *
 * 背景：MCP 原本所有工具都不套分店渠道限制，持有 CLI token 的分店帳號可讀到其他分店的
 * 聯絡人、對話、案件，也能對看不到的渠道發 LINE 訊息。mcp.routes.test.ts 用注入的假解析
 * 驗證各工具有守門；本測試確認正式接線（依登入帳號查 AgentChannelAccess 與權限）真的生效。
 *
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import mcpRoutes from '#src/modules/mcp/mcp.routes.js';
import { MCP_LINE_READ_SCOPE, MCP_LINE_SEND_SCOPE, MCP_READ_SCOPE } from '#src/modules/mcp/mcp.constants.js';
import { notFound } from '#src/shared/messages/resource.js';

loadEnvConfig();
const prisma = new PrismaClient();
const T = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const stamp = Date.now();
const SCOPES = [MCP_READ_SCOPE, MCP_LINE_READ_SCOPE, MCP_LINE_SEND_SCOPE];
const MISSING_ID = '00000000-0000-4000-8000-00000000dead';

async function buildApp(agentId: string) {
  const app = Fastify();
  app.decorate('prisma', prisma);
  app.decorate('prismaAdmin', prisma);
  app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
  app.decorate('authenticateJwtOrCliSession', async (request: FastifyRequest) => {
    request.agent = {
      id: agentId,
      tenantId: T,
      role: 'AGENT',
      // 刻意不帶 roleId：正式的 CLI token 驗證（attachCliAgent）不設 roleId，
      // 權限解析要走 resolveRoleId 以 agentId 回查的路徑
      isCliSession: true,
      cliSession: {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'CI MCP',
        scopes: SCOPES,
        expiresAt: new Date(Date.now() + 60_000),
        lastUsedAt: null,
        tokenPrefix: 'cli_ci',
        tokenSuffix: 'ci',
      },
    } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
  });
  await app.register(mcpRoutes);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, address };
}

async function callTool(address: string, name: string, args: Record<string, unknown>) {
  const res = await fetch(`${address}/mcp`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer cli_ci',
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { result: { isError?: boolean; content: Array<{ text: string }> } };
  return { isError: body.result.isError === true, text: body.result.content[0]?.text ?? '' };
}

const roles: string[] = [];
const apps: Array<{ close: () => Promise<unknown> }> = [];
const cleanup: Array<() => Promise<unknown>> = [];

const mkRole = (slug: string, permissions: string[]) =>
  prisma.role.create({
    data: {
      tenantId: T,
      slug: `ci-mcp-${slug}-${stamp}`,
      name: `CI MCP 可見性（${slug}）`,
      permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) },
    },
  });
const branchRole = await mkRole('branch', ['inbox.view', 'inbox.reply']);
roles.push(branchRole.id);
const hqRole = await mkRole('hq', ['inbox.view', 'inbox.reply', 'channel.view_all']);
roles.push(hqRole.id);

const mkChannel = (name: string) =>
  prisma.channel.create({
    data: { tenantId: T, channelType: 'LINE', displayName: `CI MCP 渠道 ${name} ${stamp}`, credentialsEncrypted: 'x' },
  });
// 清理依建立順序反向執行；每建一筆就註冊，中途失敗也不留殘留資料
// （agentChannelAccess、channelIdentity、rolePermission 皆 onDelete: Cascade）
const chA = await mkChannel('A');
cleanup.unshift(() => prisma.channel.deleteMany({ where: { tenantId: T, id: chA.id } }));
const chB = await mkChannel('B');
cleanup.unshift(() => prisma.channel.deleteMany({ where: { tenantId: T, id: chB.id } }));
const mkAgent = async (slug: string, name: string, roleId?: string) => {
  const a = await prisma.agent.create({
    data: { tenantId: T, email: `ci-mcp-${slug}-${stamp}@example.test`, name, passwordHash: 'x', roleId },
  });
  cleanup.unshift(() => prisma.agent.deleteMany({ where: { id: a.id, tenantId: T } }));
  return a;
};
const branch = await mkAgent('branch', 'CI MCP 分店', branchRole.id);
const other = await mkAgent('other', 'CI MCP 另一分店');
const hq = await mkAgent('hq', 'CI MCP 總店', hqRole.id);
// 分店只唯讀渠道 A；渠道 B 綁給另一分店（未綁任何人的渠道依 CM-173 相容規則是全租戶可見）
await prisma.agentChannelAccess.create({ data: { agentId: branch.id, channelId: chA.id, accessLevel: 'read_only' } });
await prisma.agentChannelAccess.create({ data: { agentId: other.id, channelId: chB.id, accessLevel: 'full' } });

const contact = await prisma.contact.create({ data: { tenantId: T, displayName: `CI MCP 聯絡人 ${stamp}` } });
cleanup.unshift(async () => {
  await prisma.case.deleteMany({ where: { tenantId: T, contactId: contact.id } });
  await prisma.conversation.deleteMany({ where: { tenantId: T, contactId: contact.id } });
  await prisma.contact.deleteMany({ where: { id: contact.id, tenantId: T } });
});
const conv = new Map<string, string>();
const caseId = new Map<string, string>();
for (const [label, ch] of [['A', chA], ['B', chB]] as const) {
  const c = await prisma.conversation.create({
    data: { tenantId: T, contactId: contact.id, channelId: ch.id, channelType: 'LINE', lastMessageAt: new Date() },
  });
  conv.set(label, c.id);
  const k = await prisma.case.create({ data: { tenantId: T, contactId: contact.id, channelId: ch.id, title: `CI MCP 案件 ${label} ${stamp}` } });
  caseId.set(label, k.id);
  await prisma.channelIdentity.create({
    data: { contactId: contact.id, channelId: ch.id, channelType: 'LINE', uid: `ci-mcp-uid-${ch.id}`, profileName: `CI MCP 暱稱 ${label}` },
  });
}
const { app, address } = await buildApp(branch.id);
apps.push(app);
const hqApp = await buildApp(hq.id);
apps.push(hqApp.app);

test('分店讀單筆對話／案件：他店與不存在的回應完全相同，自己的渠道可讀', async () => {
  const b = await callTool(address, 'crm_line_get_conversation', { id: conv.get('B') });
  const missing = await callTool(address, 'crm_line_get_conversation', { id: MISSING_ID });
  assert.equal(b.isError, true);
  assert.deepEqual(b, missing, '他店對話與不存在的對話回應要一致');
  assert.equal(b.text, notFound('conversation'));

  const caseB = await callTool(address, 'crm_get_case', { id: caseId.get('B') });
  const caseMissing = await callTool(address, 'crm_get_case', { id: MISSING_ID });
  assert.deepEqual(caseB, caseMissing, '他店案件與不存在的案件回應要一致');
  assert.equal(caseB.text, notFound('case'));
  const caseA = await callTool(address, 'crm_get_case', { id: caseId.get('A') });
  assert.equal(caseA.isError, false, caseA.text);

  const a = await callTool(address, 'crm_line_get_conversation', { id: conv.get('A') });
  assert.equal(a.isError, false, a.text);
  assert.match(a.text, new RegExp(conv.get('A')!));
});

test('分店列對話：不含看不到的渠道', async () => {
  const r = await callTool(address, 'crm_line_list_conversations', { page: 1, limit: 50 });
  assert.equal(r.isError, false, r.text);
  assert.ok(!r.text.includes(conv.get('B')!), '不可列出渠道 B 的對話');
  assert.ok(r.text.includes(conv.get('A')!), '應列出渠道 A 的對話');
});

test('分店讀聯絡人：渠道身份只列可見渠道', async () => {
  const r = await callTool(address, 'crm_get_contact', { id: contact.id });
  assert.equal(r.isError, false, r.text);
  assert.ok(r.text.includes(`ci-mcp-uid-${chA.id}`), '應保留渠道 A 的身份');
  assert.ok(!r.text.includes(`ci-mcp-uid-${chB.id}`), '不可出現渠道 B 的 uid');
  assert.ok(!r.text.includes('CI MCP 暱稱 B'), '不可出現渠道 B 的暱稱');
});

test('分店發 LINE：唯讀渠道 403 層級不足，看不到的渠道與不存在的回應相同', async () => {
  const payload = { contentType: 'text', content: { text: 'hi' } };
  const a = await callTool(address, 'crm_line_direct_send', { ...payload, conversationId: conv.get('A') });
  assert.equal(a.isError, true);
  assert.match(a.text, /CHANNEL_ACCESS_LEVEL_INSUFFICIENT/);
  const b = await callTool(address, 'crm_line_direct_send', { ...payload, conversationId: conv.get('B') });
  const missing = await callTool(address, 'crm_line_direct_send', { ...payload, conversationId: MISSING_ID });
  assert.equal(b.isError, true);
  assert.deepEqual(b, missing, '他店對話與不存在的對話回應要一致');

  // 用渠道＋聯絡人找對話：不可藉此探測他店是否有這位顧客的對話
  const byPair = await callTool(address, 'crm_line_direct_send', { ...payload, channelId: chB.id, contactId: contact.id });
  const byPairMissing = await callTool(address, 'crm_line_direct_send', { ...payload, channelId: chB.id, contactId: MISSING_ID });
  assert.equal(byPair.isError, true);
  assert.deepEqual(byPair, byPairMissing, '渠道＋聯絡人查詢：他店有對話與沒有對話的回應要一致');
});

test('總店（channel.view_all）：看得到所有渠道的對話、案件與身份', async () => {
  const b = await callTool(hqApp.address, 'crm_line_get_conversation', { id: conv.get('B') });
  assert.equal(b.isError, false, b.text);
  const caseB = await callTool(hqApp.address, 'crm_get_case', { id: caseId.get('B') });
  assert.equal(caseB.isError, false, caseB.text);
  const contactRes = await callTool(hqApp.address, 'crm_get_contact', { id: contact.id });
  assert.ok(contactRes.text.includes(`ci-mcp-uid-${chB.id}`), '總店應看得到渠道 B 的身份');
});

afterAll(async () => {
  for (const app of apps) await app.close().catch(() => {});
  for (const fn of cleanup) await fn().catch((err) => console.error('清理失敗', err));
  if (roles.length) await prisma.role.deleteMany({ where: { id: { in: roles } } });
  await prisma.$disconnect();
});
