/**
 * 聯絡人路由權限守門（路由層整合測試，走真實 requirePermission 與權限計算）。
 *
 * 背景：contact.view／contact.update 權限點早已定義，但多數 /api/v1/contacts/* 路由沒套用，
 * 只要登入即可讀寫任何聯絡人。本測試確保每一條路由都有守門，且有權限時照常放行。
 *
 * 需要 DATABASE_URL（自動讀 repo 根目錄 .env，但只接受本機資料庫；建立測試角色，結束時刪除）。
 * 執行：pnpm --filter @open333crm/api test:contact-routes-permission
 */
import './helpers/load-root-env.js';
import assert from 'node:assert/strict';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '../config/env.js';
import { tenantScopedClient } from '../lib/tenant-db.js';
import contactRoutes from '../modules/contact/contact.routes.js';

if (!process.env.DATABASE_URL) {
  console.log('SKIP contact-routes-permission：repo 根目錄 .env 與環境變數都沒有 DATABASE_URL');
  process.exit(0);
}

loadEnvConfig();
const prisma = new PrismaClient();
const T = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const SOME_ID = '00000000-0000-4000-8000-000000000abc';
const stamp = Date.now();

async function createRole(slug: string, permissions: string[]) {
  return prisma.role.create({
    data: {
      tenantId: T,
      slug: `ci-${slug}-${stamp}`,
      name: `CI 權限測試（${slug}）`,
      permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) },
    },
  });
}

async function buildApp(roleId: string, agentId = SOME_ID) {
  const app = Fastify();
  app.decorate('prisma', prisma);
  app.decorate('prismaAdmin', prisma);
  app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agentId, tenantId: T, role: 'AGENT', roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
  });
  await app.register(contactRoutes, { prefix: '/api/v1/contacts' });
  await app.ready();
  return app;
}

/** 每一條聯絡人路由（method、url、body） */
const ROUTES: Array<{ method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: object }> = [
  { method: 'GET', url: '/api/v1/contacts' },
  { method: 'GET', url: `/api/v1/contacts/merge-preview?primaryId=${SOME_ID}&secondaryId=${SOME_ID}` },
  { method: 'POST', url: '/api/v1/contacts/merge', payload: { primaryContactId: SOME_ID, secondaryContactId: SOME_ID } },
  { method: 'POST', url: `/api/v1/contacts/merge-logs/${SOME_ID}/revert` },
  { method: 'GET', url: '/api/v1/contacts/identity-binding/status' },
  { method: 'POST', url: `/api/v1/contacts/${SOME_ID}/binding-link`, payload: { conversationId: SOME_ID } },
  { method: 'GET', url: `/api/v1/contacts/${SOME_ID}/merge-logs` },
  { method: 'GET', url: `/api/v1/contacts/${SOME_ID}` },
  { method: 'PATCH', url: `/api/v1/contacts/${SOME_ID}`, payload: { displayName: 'x' } },
  { method: 'GET', url: `/api/v1/contacts/${SOME_ID}/conversations` },
  { method: 'GET', url: `/api/v1/contacts/${SOME_ID}/cases` },
  { method: 'POST', url: `/api/v1/contacts/${SOME_ID}/tags`, payload: { tagId: SOME_ID } },
  { method: 'DELETE', url: `/api/v1/contacts/${SOME_ID}/tags/${SOME_ID}` },
  { method: 'GET', url: `/api/v1/contacts/${SOME_ID}/timeline` },
];

let failed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failed++;
    console.log(`not ok - ${name}`);
    console.error(err);
  }
}

const roles: string[] = [];
const apps: Array<{ close: () => Promise<unknown> }> = [];
const cleanup: Array<() => Promise<unknown>> = [];

/** 依路徑片段找路由，不依賴陣列順序 */
const route = (fragment: string, method?: string) => {
  const r = ROUTES.find((x) => x.url.includes(fragment) && (!method || x.method === method));
  if (!r) throw new Error(`找不到路由：${method ?? ''} ${fragment}`);
  return r;
};
const call = (app: Awaited<ReturnType<typeof buildApp>>, r: (typeof ROUTES)[number]) =>
  app.inject({ method: r.method, url: r.url, payload: r.payload });

try {
  const none = await createRole('none', []);
  const viewOnly = await createRole('view-only', ['contact.view']);
  // contact.update 依權限註冊表 dependsOn contact.view，正式流程不會出現只有 update 的角色
  const viewUpdate = await createRole('view-update', ['contact.view', 'contact.update']);
  const replyOnly = await createRole('reply', ['inbox.view', 'inbox.reply']);
  roles.push(none.id, viewOnly.id, viewUpdate.id, replyOnly.id);

  const noPermApp = await buildApp(none.id);
  const viewApp = await buildApp(viewOnly.id);
  const updateApp = await buildApp(viewUpdate.id);
  const replyApp = await buildApp(replyOnly.id);
  apps.push(noPermApp, viewApp, updateApp, replyApp);

  await check('沒有任何權限的角色：每一條聯絡人路由都回 403', async () => {
    const leaks: string[] = [];
    for (const r of ROUTES) {
      const res = await call(noPermApp, r);
      if (res.statusCode !== 403) leaks.push(`${r.method} ${r.url} → ${res.statusCode}`);
    }
    assert.deepEqual(leaks, [], `以下路由沒擋：\n${leaks.join('\n')}`);
  });

  await check('只有 contact.view：可讀聯絡人列表與詳情（不回 403）', async () => {
    const list = await viewApp.inject({ method: 'GET', url: '/api/v1/contacts?limit=1' });
    assert.equal(list.statusCode, 200);
    const detail = await call(viewApp, route(`/contacts/${SOME_ID}`, 'GET'));
    assert.notEqual(detail.statusCode, 403, '有 contact.view 應通過守門（查無此人回 404）');
  });

  await check('只有 contact.view：修改、貼標、移除標籤、合併、合併預覽、代發連結皆回 403', async () => {
    for (const r of [
      route(`/contacts/${SOME_ID}`, 'PATCH'),
      route('/tags', 'POST'),
      route('/tags/', 'DELETE'),
      route('/contacts/merge', 'POST'),
      route('merge-preview'),
      route('/revert'),
      route('/binding-link'),
    ]) {
      assert.equal((await call(viewApp, r)).statusCode, 403, `${r.method} ${r.url}`);
    }
  });

  await check('只有 contact.view：看聯絡人的對話需 inbox.view、看案件需 case.view', async () => {
    assert.equal((await call(viewApp, route('/conversations'))).statusCode, 403);
    assert.equal((await call(viewApp, route('/cases'))).statusCode, 403);
  });

  await check('contact.view + contact.update：修改、貼標、移除標籤都通過守門，合併仍 403', async () => {
    for (const r of [route(`/contacts/${SOME_ID}`, 'PATCH'), route('/tags', 'POST'), route('/tags/', 'DELETE')]) {
      assert.notEqual((await call(updateApp, r)).statusCode, 403, `${r.method} ${r.url}`);
    }
    assert.equal((await call(updateApp, route('/contacts/merge', 'POST'))).statusCode, 403);
    assert.equal((await call(updateApp, route('merge-preview'))).statusCode, 403);
  });

  await check('代發綁定連結屬回覆層級：有 inbox.reply 通過守門，只有 contact.update 被擋', async () => {
    assert.notEqual((await call(replyApp, route('/identity-binding/status'))).statusCode, 403);
    assert.notEqual((await call(replyApp, route('/binding-link'))).statusCode, 403);
    assert.equal((await call(updateApp, route('/binding-link'))).statusCode, 403);
  });

  // ── CM-173 渠道可見性：分店帳號只綁渠道 A，看不到同一位聯絡人在渠道 B 的對話與案件 ──
  // 含 inbox.reply：代發綁定連結要先通過權限守門，才測得到後面的渠道層級檢查
  const branchRole = await createRole('branch', ['contact.view', 'inbox.view', 'inbox.reply', 'case.view']);
  roles.push(branchRole.id);
  const mkChannel = (name: string) =>
    prisma.channel.create({
      data: { tenantId: T, channelType: 'WEBCHAT', displayName: `CI 渠道可見性 ${name} ${stamp}`, credentialsEncrypted: 'x' },
    });
  const chA = await mkChannel('A');
  const chB = await mkChannel('B');
  const agent = await prisma.agent.create({
    data: { tenantId: T, email: `ci-branch-${stamp}@example.test`, name: 'CI 分店帳號', passwordHash: 'x', roleId: branchRole.id },
  });
  await prisma.agentChannelAccess.create({ data: { agentId: agent.id, channelId: chA.id, accessLevel: 'read_only' } });
  // 渠道 B 綁給另一位分店帳號：沒有任何授權的渠道依 CM-173 向後相容規則是「全租戶可見」，
  // 必須有人被授權，B 才是受限渠道
  const otherAgent = await prisma.agent.create({
    data: { tenantId: T, email: `ci-branch-other-${stamp}@example.test`, name: 'CI 另一分店', passwordHash: 'x' },
  });
  await prisma.agentChannelAccess.create({ data: { agentId: otherAgent.id, channelId: chB.id, accessLevel: 'full' } });
  const contact = await prisma.contact.create({ data: { tenantId: T, displayName: `CI 可見性聯絡人 ${stamp}` } });
  const convByChannel = new Map<string, string>();
  for (const ch of [chA, chB]) {
    const conv = await prisma.conversation.create({ data: { tenantId: T, contactId: contact.id, channelId: ch.id, channelType: 'WEBCHAT' } });
    convByChannel.set(ch.id, conv.id);
    await prisma.channelIdentity.create({
      data: { contactId: contact.id, channelId: ch.id, channelType: 'WEBCHAT', uid: `ci-uid-${ch.id}`, profileName: `CI 暱稱 ${ch.id === chA.id ? 'A' : 'B'}` },
    });
    await prisma.case.create({ data: { tenantId: T, contactId: contact.id, channelId: ch.id, title: `CI 案件 ${ch.id === chA.id ? 'A' : 'B'}` } });
  }
  cleanup.push(async () => {
    await prisma.case.deleteMany({ where: { tenantId: T, contactId: contact.id } });
    await prisma.conversation.deleteMany({ where: { tenantId: T, contactId: contact.id } });
    await prisma.contact.deleteMany({ where: { id: contact.id, tenantId: T } });
    await prisma.agent.deleteMany({ where: { id: { in: [agent.id, otherAgent.id] }, tenantId: T } });
    await prisma.channel.deleteMany({ where: { tenantId: T, id: { in: [chA.id, chB.id] } } });
  });
  const branchApp = await buildApp(branchRole.id, agent.id);
  apps.push(branchApp);

  await check('CM-173：分店帳號看聯絡人的對話、案件、時間軸，只看得到自己渠道的資料', async () => {
    const convs = await branchApp.inject({ method: 'GET', url: `/api/v1/contacts/${contact.id}/conversations` });
    assert.equal(convs.statusCode, 200);
    const convChannels = (convs.json().data as Array<{ channelId: string }>).map((c) => c.channelId);
    assert.deepEqual(convChannels, [chA.id], '不可看到渠道 B 的對話');

    const cases = await branchApp.inject({ method: 'GET', url: `/api/v1/contacts/${contact.id}/cases` });
    assert.equal(cases.statusCode, 200);
    const caseTitles = (cases.json().data as Array<{ title: string }>).map((c) => c.title);
    assert.deepEqual(caseTitles, ['CI 案件 A'], '不可看到渠道 B 的案件');

    const timeline = await branchApp.inject({ method: 'GET', url: `/api/v1/contacts/${contact.id}/timeline` });
    assert.equal(timeline.statusCode, 200);
    const text = JSON.stringify(timeline.json());
    assert.ok(!text.includes('CI 案件 B'), '時間軸不可出現渠道 B 的案件');
    assert.ok(!text.includes(`CI 渠道可見性 B ${stamp}`), '時間軸不可出現渠道 B 的對話');
  });

  await check('CM-173：聯絡人詳情與列表的渠道身份只列出可見渠道（不洩漏其他渠道名稱、uid）', async () => {
    const detail = await branchApp.inject({ method: 'GET', url: `/api/v1/contacts/${contact.id}` });
    assert.equal(detail.statusCode, 200);
    const detailIds = (detail.json().data.channelIdentities as Array<{ channelId: string }>).map((i) => i.channelId);
    assert.deepEqual(detailIds, [chA.id], '詳情不可列出渠道 B 的身份');
    const detailJson = JSON.stringify(detail.json());
    assert.ok(!detailJson.includes(`CI 渠道可見性 B ${stamp}`), '詳情不可出現渠道 B 的名稱');
    assert.ok(!detailJson.includes(`ci-uid-${chB.id}`), '詳情不可出現渠道 B 的顧客 uid');
    assert.ok(!detailJson.includes('CI 暱稱 B'), '詳情不可出現渠道 B 的暱稱');
    // 正向：可見渠道的身份仍完整回傳，不是整包被濾掉
    const visible = detail.json().data.channelIdentities[0] as { uid: string; profileName: string };
    assert.equal(visible.uid, `ci-uid-${chA.id}`);
    assert.equal(visible.profileName, 'CI 暱稱 A');

    const list = await branchApp.inject({
      method: 'GET',
      url: `/api/v1/contacts?q=${encodeURIComponent(`CI 可見性聯絡人 ${stamp}`)}`,
    });
    assert.equal(list.statusCode, 200);
    const rows = list.json().data as Array<{ id: string; channelIdentities: Array<{ channel: { id: string } }> }>;
    const row = rows.find((r) => r.id === contact.id);
    assert.ok(row, '列表應找得到這位聯絡人');
    assert.deepEqual(row.channelIdentities.map((i) => i.channel.id), [chA.id], '列表不可列出渠道 B 的身份');
    const listJson = JSON.stringify(list.json());
    assert.ok(!listJson.includes(`CI 渠道可見性 B ${stamp}`), '列表不可出現渠道 B 的名稱');
    assert.ok(!listJson.includes(`ci-uid-${chB.id}`), '列表不可出現渠道 B 的顧客 uid');
    assert.ok(!listJson.includes('CI 暱稱 B'), '列表不可出現渠道 B 的暱稱');
    // 正向：對解析後的欄位斷言，確認 uid／暱稱就在這位聯絡人的渠道 A 身份上
    const listVisible = row.channelIdentities[0] as unknown as { uid: string; profileName: string };
    assert.equal(listVisible.uid, `ci-uid-${chA.id}`, '列表應保留可見渠道的 uid');
    assert.equal(listVisible.profileName, 'CI 暱稱 A', '列表應保留可見渠道的暱稱');
  });

  await check('CM-173：代發綁定連結檢查渠道層級（看不到的渠道 404、唯讀渠道 403）', async () => {
    const toB = await branchApp.inject({
      method: 'POST',
      url: `/api/v1/contacts/${contact.id}/binding-link`,
      payload: { conversationId: convByChannel.get(chB.id) },
    });
    assert.equal(toB.statusCode, 404, `看不到的渠道應回 404，實際 ${toB.statusCode} ${toB.body}`);

    const toA = await branchApp.inject({
      method: 'POST',
      url: `/api/v1/contacts/${contact.id}/binding-link`,
      payload: { conversationId: convByChannel.get(chA.id) },
    });
    assert.equal(toA.statusCode, 403, `唯讀渠道應回 403，實際 ${toA.statusCode} ${toA.body}`);
    assert.equal(toA.json().error?.code ?? toA.json().code, 'CHANNEL_ACCESS_LEVEL_INSUFFICIENT');
  });
} finally {
  for (const app of apps) await app.close().catch(() => {});
  for (const fn of cleanup) await fn().catch((err) => console.error('清理失敗', err));
  if (roles.length) await prisma.role.deleteMany({ where: { id: { in: roles } } });
  await prisma.$disconnect();
}

console.log(`# fail ${failed}`);
process.exit(failed === 0 ? 0 : 1);
