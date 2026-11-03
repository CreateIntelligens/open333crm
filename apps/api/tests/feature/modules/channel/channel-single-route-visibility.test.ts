/**
 * 單筆渠道路由套用渠道可見範圍（issue #408，change scope-single-channel-routes-408）。
 *
 * 修正前只有 GET /:id/status 檢查可見範圍：有 channel.update／channel.delete 但沒有 channel.view_all
 * 的分店成員，知道渠道 ID 就能讀取、改名、停用、換憑證、刪除看不到的渠道。
 *
 * 屬於 feature 組：走真實路由、權限計算與 app_tenant 連線（RLS），資料加標記並在 afterAll 刪除。
 * 測試名稱以「情境名稱：說明」開頭。
 */
import assert from 'node:assert/strict';
import { afterAll, test, vi } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import channelRoutes from '#src/modules/channel/channel.routes.js';
import type { BindingStore } from '#src/modules/identity-binding/binding-code.js';

// 未加守門時 verify／setup-webhook 會打 LINE；測試不連外
vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const MARK = `ci-channel-single-${Date.now()}`;

/** 記憶體版 BindingStore：LIFF 測試紀錄不進 Redis */
function memoryStore(): BindingStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async set(key, value, _mode, _ttl, condition) {
      if (condition === 'NX' && data.has(key)) return null;
      if (condition === 'XX' && !data.has(key)) return null;
      data.set(key, value);
      return 'OK';
    },
    async getdel(key) {
      const v = data.get(key) ?? null;
      data.delete(key);
      return v;
    },
    async get(key) {
      return data.get(key) ?? null;
    },
    async incr() {
      return 1;
    },
    async pttl(key) {
      return data.has(key) ? 60_000 : -2;
    },
    async pexpire() {
      return 1;
    },
  };
}
const store = memoryStore();

const createRole = (slug: string, codes: string[]) =>
  owner.role.create({
    data: {
      tenantId: A,
      slug: `${MARK}-${slug}`,
      name: `${MARK}-${slug}`,
      permissions: { create: codes.map((permissionCode) => ({ permissionCode })) },
    },
  });
const BRANCH_CODES = ['channel.view', 'channel.create', 'channel.update', 'channel.delete', 'inbox.view', 'inbox.reply', 'agent.view'];
const branchRole = await createRole('branch', BRANCH_CODES);
const hqRole = await createRole('hq', [...BRANCH_CODES, 'channel.view_all']);
const assignerRole = await createRole('assigner', ['channel.view', 'channel.assign_team']);
const noViewRole = await createRole('no-view', ['inbox.view']);

const createAgent = (slug: string, roleId: string) =>
  owner.agent.create({ data: { tenantId: A, roleId, email: `${MARK}-${slug}@example.test`, name: MARK, passwordHash: 'x' } });
const branch = await createAgent('branch', branchRole.id);
const hq = await createAgent('hq', hqRole.id);
const assigner = await createAgent('assigner', assignerRole.id);
const noView = await createAgent('no-view', noViewRole.id);
const other = await createAgent('other', branchRole.id);

const LIFF_SETTINGS = { liffConfig: { liffId: '1234567890-AbcdEfgh', loginChannelId: '1234567890' } };
const createChannel = (slug: string, channelType: 'WEBCHAT' | 'LINE' | 'FB', settings: object = {}) =>
  owner.channel.create({
    data: {
      tenantId: A,
      channelType,
      isActive: true,
      displayName: `${MARK}-${slug}`,
      credentialsEncrypted: `${MARK}-cred`,
      settings,
      webhookUrl: `https://old.example.test/${slug}`,
    },
  });
const visibleWebchat = await createChannel('visible-webchat', 'WEBCHAT');
const readOnlyWebchat = await createChannel('read-only-webchat', 'WEBCHAT');
const hiddenWebchat = await createChannel('hidden-webchat', 'WEBCHAT');
const hiddenLine = await createChannel('hidden-line', 'LINE', LIFF_SETTINGS);
const hiddenFb = await createChannel('hidden-fb', 'FB');
const bind = (channelId: string, agentId: string, accessLevel: 'read_only' | 'reply_only' | 'full') =>
  owner.agentChannelAccess.create({ data: { channelId, agentId, accessLevel } });
await bind(visibleWebchat.id, branch.id, 'full');
await bind(readOnlyWebchat.id, branch.id, 'read_only');
await bind(visibleWebchat.id, noView.id, 'full');
for (const ch of [hiddenWebchat, hiddenLine, hiddenFb]) await bind(ch.id, other.id, 'full');

const team = await owner.team.create({ data: { tenantId: A, name: `${MARK}-team` } });

// 其他人產生、屬於看不到的 LINE 渠道的 LIFF 測試紀錄
const HIDDEN_TEST_ID = 'a'.repeat(43);
store.data.set(
  `channel:liff-test:${HIDDEN_TEST_ID}`,
  JSON.stringify({ tenantId: A, channelId: hiddenLine.id, liffId: LIFF_SETTINGS.liffConfig.liffId, loginChannelId: '1234567890' }),
);

const apps: Array<{ close: () => Promise<unknown> }> = [];
async function buildApp(agent: { id: string; roleId: string | null }) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', tenantDb);
  app.decorate('prismaAdmin', owner);
  app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agent.id, tenantId: A, role: 'AGENT', roleId: agent.roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, A);
  });
  await app.register(channelRoutes, { prefix: '/api/v1/channels', liffTest: { store } });
  await app.ready();
  apps.push(app);
  return app;
}
const branchApp = await buildApp(branch);
const hqApp = await buildApp(hq);
const assignerApp = await buildApp(assigner);
const noViewApp = await buildApp(noView);

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  const channels = await owner.channel.findMany({ where: { displayName: { startsWith: MARK } }, select: { id: true } });
  const channelIds = channels.map((c) => c.id);
  await owner.channelTeamAccess.deleteMany({ where: { channelId: { in: channelIds } } });
  await owner.agentChannelAccess.deleteMany({ where: { channelId: { in: channelIds } } });
  await owner.channel.deleteMany({ where: { id: { in: channelIds } } });
  await owner.team.deleteMany({ where: { name: { startsWith: MARK } } });
  await owner.agent.deleteMany({ where: { email: { startsWith: MARK } } });
  await owner.role.deleteMany({ where: { slug: { startsWith: MARK } } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
  vi.unstubAllGlobals();
});

type App = typeof branchApp;
const call = (app: App, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1/channels${url}`, ...(payload ? { payload } : {}) });

const reload = (id: string) => owner.channel.findUniqueOrThrow({ where: { id } });

test('讀取看不到的渠道被拒：GET /:id 回 404，不回憑證與驗證權杖', async () => {
  const res = await call(branchApp, 'GET', `/${hiddenFb.id}`);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().data, undefined);
});

test('讀取看不到的渠道被拒：GET /:id/embed-code 回 404', async () => {
  const res = await call(branchApp, 'GET', `/${hiddenWebchat.id}/embed-code`);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().data, undefined);
});

test('讀取看不到的渠道被拒：GET /:id/binding-handle 回 404', async () => {
  const res = await call(branchApp, 'GET', `/${hiddenLine.id}/binding-handle`);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().data, undefined);
});

test('修改看不到的渠道被拒：PATCH /:id 改名、停用、換權杖都回 404，渠道不變', async () => {
  for (const body of [{ displayName: 'x' }, { isActive: false }, { credentials: { pageAccessToken: 'stolen' } }]) {
    const res = await call(branchApp, 'PATCH', `/${hiddenFb.id}`, body);
    assert.equal(res.statusCode, 404, `${JSON.stringify(body)} → ${res.body}`);
  }
  const after = await reload(hiddenFb.id);
  assert.equal(after.displayName, `${MARK}-hidden-fb`);
  assert.equal(after.isActive, true);
  assert.equal(after.credentialsEncrypted, `${MARK}-cred`);
});

test('修改看不到的渠道被拒：DELETE /:id 回 404，渠道還在', async () => {
  const res = await call(branchApp, 'DELETE', `/${hiddenWebchat.id}`);
  assert.equal(res.statusCode, 404, res.body);
  const after = await owner.channel.findUnique({ where: { id: hiddenWebchat.id } });
  assert.ok(after, '渠道被刪除了');
  assert.equal(after.isActive, true);
});

test('修改看不到的渠道被拒：測試連線、設定 webhook、LIFF 測試回 404', async () => {
  const cases: Array<[string, 'GET' | 'POST', string]> = [
    ['verify', 'POST', `/${hiddenLine.id}/verify`],
    ['setup-webhook', 'POST', `/${hiddenLine.id}/setup-webhook`],
    ['liff-test', 'POST', `/${hiddenLine.id}/liff-test`],
    ['liff-test result', 'GET', `/${hiddenLine.id}/liff-test/${HIDDEN_TEST_ID}`],
  ];
  for (const [name, method, url] of cases) {
    const res = await call(branchApp, method, url);
    assert.equal(res.statusCode, 404, `${name} → ${res.body}`);
  }
  const after = await reload(hiddenLine.id);
  assert.equal(after.webhookUrl, `https://old.example.test/hidden-line`);
});

test('修改看不到的渠道被拒：WebChat 連結、背景、導流識別回 404，設定不變', async () => {
  const cases: Array<[string, 'POST' | 'PATCH', string, object | undefined]> = [
    ['chatbox-link', 'POST', `/${hiddenWebchat.id}/chatbox-link`, { domain: 'https://shop.example.test' }],
    ['chatbox-theme', 'PATCH', `/${hiddenWebchat.id}/chatbox-theme`, { accentColor: '#ff0000' }],
    ['chatbox-theme/background', 'POST', `/${hiddenWebchat.id}/chatbox-theme/background`, undefined],
    ['binding-handle', 'PATCH', `/${hiddenLine.id}/binding-handle`, { bindingHandle: '@stolen' }],
  ];
  for (const [name, method, url, body] of cases) {
    const res = await call(branchApp, method, url, body);
    assert.equal(res.statusCode, 404, `${name} → ${res.body}`);
  }
  assert.deepEqual((await reload(hiddenWebchat.id)).settings, {});
  assert.equal((await reload(hiddenWebchat.id)).publicKey, null);
  assert.deepEqual((await reload(hiddenLine.id)).settings, LIFF_SETTINGS);
});

test('唯讀層級可以讀取渠道：GET /:id 回 200', async () => {
  const res = await call(branchApp, 'GET', `/${readOnlyWebchat.id}`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().data.id, readOnlyWebchat.id);
});

test('唯讀層級不能管理渠道：PATCH、DELETE、WebChat 外觀回 403 CHANNEL_ACCESS_LEVEL_INSUFFICIENT', async () => {
  const cases: Array<[string, 'PATCH' | 'DELETE', string, object | undefined]> = [
    ['PATCH', 'PATCH', `/${readOnlyWebchat.id}`, { displayName: 'x' }],
    ['DELETE', 'DELETE', `/${readOnlyWebchat.id}`, undefined],
    ['chatbox-theme', 'PATCH', `/${readOnlyWebchat.id}/chatbox-theme`, { accentColor: '#ff0000' }],
  ];
  for (const [name, method, url, body] of cases) {
    const res = await call(branchApp, method, url, body);
    assert.equal(res.statusCode, 403, `${name} → ${res.body}`);
    assert.equal(res.json().error.code, 'CHANNEL_ACCESS_LEVEL_INSUFFICIENT');
  }
  const after = await reload(readOnlyWebchat.id);
  assert.equal(after.displayName, `${MARK}-read-only-webchat`);
  assert.deepEqual(after.settings, {});
});

test('完整層級可以管理渠道：PATCH /:id 回 200', async () => {
  const res = await call(branchApp, 'PATCH', `/${visibleWebchat.id}`, { displayName: `${MARK}-visible-webchat-renamed` });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((await reload(visibleWebchat.id)).displayName, `${MARK}-visible-webchat-renamed`);
});

test('總店不受可見範圍限制：GET 看不到的渠道回 200', async () => {
  const res = await call(hqApp, 'GET', `/${hiddenFb.id}`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().data.id, hiddenFb.id);
});

test('嵌入碼需要 channel.view：沒有 channel.view 回 403', async () => {
  const res = await call(noViewApp, 'GET', `/${visibleWebchat.id}/embed-code`);
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.details.requiredPermission, 'channel.view');
});

test('分店成員不能套用 Webhook 公開網址：沒有 channel.view_all 回 403，渠道網址不變', async () => {
  const res = await call(branchApp, 'POST', '/webhook-base-url', { baseUrl: 'https://evil.example.test' });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.details.requiredPermission, 'channel.view_all');
  assert.equal((await reload(hiddenFb.id)).webhookUrl, 'https://old.example.test/hidden-fb');
  assert.equal((await reload(visibleWebchat.id)).webhookUrl, 'https://old.example.test/visible-webchat');
});

test('團隊指派由 channel.assign_team 控管：沒有 channel.view_all 也能指派看不到的渠道', async () => {
  const grant = await call(assignerApp, 'POST', `/${hiddenFb.id}/teams`, { teamId: team.id, accessLevel: 'read_only' });
  assert.equal(grant.statusCode, 201, grant.body);
  const list = await call(assignerApp, 'GET', `/${hiddenFb.id}/teams`);
  assert.equal(list.statusCode, 200, list.body);
  assert.ok(list.json().data.some((row: { teamId: string }) => row.teamId === team.id));
  const revoke = await call(assignerApp, 'DELETE', `/${hiddenFb.id}/teams/${team.id}`);
  assert.equal(revoke.statusCode, 204, revoke.body);
});
